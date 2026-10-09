//! The logical ops of one Qwen3 step, with their shapes (brief §6.5; design
//! §4.1).
//!
//! These are the ops a transformer description names (RMSNorm, the QKV
//! projection, RoPE, …), before any fusion. The fusion profile maps them to
//! the kernels vLLM launches. FLOPs and bytes per op come from the shapes
//! (task 3.2).

use serde::{Deserialize, Serialize};

use crate::model::ModelConfig;
use crate::scenario::Scenario;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OpKind {
    // Once per step, before the layers.
    /// The engine's input bookkeeping: positions, block tables, slot mappings.
    PrepareInputs,
    /// FA3's split-KV schedule, computed once and reused by every layer.
    AttentionSchedule,
    Embedding,

    // Once per layer, in order.
    InputNorm,
    /// FP8 quantization of the QKV GEMM's input (W8A8 only).
    QkvQuant,
    QkvProj,
    /// RMSNorm per head over Q and K.
    QkNorm,
    Rope,
    KvWrite,
    Attention,
    OQuant,
    OProj,
    AttnResidual,
    PostAttnNorm,
    GateUpQuant,
    GateUpProj,
    SiluMul,
    DownQuant,
    DownProj,
    MlpResidual,

    // Once per step, after the layers.
    FinalNorm,
    /// Picks the last token of each request: only those reach the LM head.
    GatherLast,
    LmHead,
    Sampling,
}

impl OpKind {
    /// Whether the op repeats in every layer.
    pub fn in_layer(self) -> bool {
        use OpKind::*;
        !matches!(
            self,
            PrepareInputs
                | AttentionSchedule
                | Embedding
                | FinalNorm
                | GatherLast
                | LmHead
                | Sampling
        )
    }
}

/// One op instance in a step: its kind and, for layer ops, its layer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct OpId {
    pub layer: Option<u32>,
    pub kind: OpKind,
}

/// What an op works on. `M` is the token count of the step (`B · T`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Shape {
    /// `[m, k]` activations times a `[k, n]` weight.
    Gemm { m: u64, n: u64, k: u64 },
    /// An activation of `rows` vectors of `cols` elements, each reduced or
    /// transformed on its own. For SiLU·mul, `cols` is the output width.
    Rows { rows: u64, cols: u64 },
    /// K and V of `tokens` new tokens.
    KvWrite {
        tokens: u64,
        kv_heads: u64,
        head_dim: u64,
    },
    /// Per request, `new_tokens` queries over `contexts[i]` keys.
    Attention {
        contexts: Vec<u32>,
        new_tokens: u32,
        q_heads: u64,
        kv_heads: u64,
        head_dim: u64,
    },
    /// Engine bookkeeping with no modeled tensor.
    Bookkeeping,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Op {
    pub id: OpId,
    pub shape: Shape,
}

/// Every op of one step in execution order: the prologue, each layer's ops,
/// then the epilogue. Quantization ops exist only for W8A8 weights.
pub fn step_ops(model: &ModelConfig, scenario: &Scenario) -> Vec<Op> {
    let c = &model.config;
    let (h, d, i) = (c.hidden_size, c.head_dim, c.intermediate_size);
    let (n_q, n_kv) = (c.num_attention_heads, c.num_key_value_heads);
    let (b, m) = (scenario.batch(), scenario.tokens());
    let rows = |rows, cols| Shape::Rows { rows, cols };
    let gemm = |m, n, k| Shape::Gemm { m, n, k };

    let step = |kind, shape| Op {
        id: OpId { layer: None, kind },
        shape,
    };
    let mut ops = vec![
        step(OpKind::PrepareInputs, Shape::Bookkeeping),
        step(OpKind::AttentionSchedule, Shape::Bookkeeping),
        step(OpKind::Embedding, rows(m, h)),
    ];

    let quant = scenario.weights.is_w8a8();
    for layer in 0..c.num_hidden_layers as u32 {
        let layer_ops = [
            Some((OpKind::InputNorm, rows(m, h))),
            quant.then(|| (OpKind::QkvQuant, rows(m, h))),
            Some((OpKind::QkvProj, gemm(m, (n_q + 2 * n_kv) * d, h))),
            Some((OpKind::QkNorm, rows(m * (n_q + n_kv), d))),
            Some((OpKind::Rope, rows(m * (n_q + n_kv), d))),
            Some((
                OpKind::KvWrite,
                Shape::KvWrite {
                    tokens: m,
                    kv_heads: n_kv,
                    head_dim: d,
                },
            )),
            Some((
                OpKind::Attention,
                Shape::Attention {
                    contexts: scenario.contexts.clone(),
                    new_tokens: scenario.new_tokens,
                    q_heads: n_q,
                    kv_heads: n_kv,
                    head_dim: d,
                },
            )),
            quant.then(|| (OpKind::OQuant, rows(m, n_q * d))),
            Some((OpKind::OProj, gemm(m, h, n_q * d))),
            Some((OpKind::AttnResidual, rows(m, h))),
            Some((OpKind::PostAttnNorm, rows(m, h))),
            quant.then(|| (OpKind::GateUpQuant, rows(m, h))),
            Some((OpKind::GateUpProj, gemm(m, 2 * i, h))),
            Some((OpKind::SiluMul, rows(m, i))),
            quant.then(|| (OpKind::DownQuant, rows(m, i))),
            Some((OpKind::DownProj, gemm(m, h, i))),
            Some((OpKind::MlpResidual, rows(m, h))),
        ];
        ops.extend(layer_ops.into_iter().flatten().map(|(kind, shape)| Op {
            id: OpId {
                layer: Some(layer),
                kind,
            },
            shape,
        }));
    }

    // vLLM normalizes every token, then keeps one per request for the head.
    ops.extend([
        step(OpKind::FinalNorm, rows(m, h)),
        step(OpKind::GatherLast, rows(b, h)),
        step(OpKind::LmHead, gemm(b, c.vocab_size, h)),
        step(OpKind::Sampling, rows(b, c.vocab_size)),
    ]);
    ops
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{KvDtype, model};
    use crate::scenario::{Phase, Weights};

    fn scenario(phase: Phase, batch: usize, new_tokens: u32, weights: Weights) -> Scenario {
        Scenario {
            phase,
            contexts: vec![8192; batch],
            new_tokens,
            weights,
            kv: KvDtype::Bf16,
        }
    }

    fn ops_of(s: &Scenario) -> Vec<Op> {
        step_ops(&model("qwen3-8b").expect("valid preset"), s)
    }

    fn shape(ops: &[Op], layer: Option<u32>, kind: OpKind) -> &Shape {
        &ops.iter()
            .find(|op| op.id == OpId { layer, kind })
            .unwrap_or_else(|| panic!("{kind:?} in layer {layer:?}"))
            .shape
    }

    #[test]
    fn ops_per_layer_and_out_of_loop() {
        let bf16 = ops_of(&scenario(Phase::Decode, 1, 1, Weights::Bf16));
        let fp8 = ops_of(&scenario(Phase::Decode, 1, 1, Weights::Fp8Block));
        let w8a16 = ops_of(&scenario(Phase::Decode, 1, 1, Weights::Fp8W8a16));
        // 3 before, 4 after, 13 per layer plus 4 quantizations with W8A8.
        assert_eq!(bf16.len(), 3 + 36 * 13 + 4);
        assert_eq!(fp8.len(), 3 + 36 * 17 + 4);
        assert_eq!(w8a16.len(), bf16.len());
        assert!(
            bf16.iter()
                .all(|op| op.id.kind.in_layer() == op.id.layer.is_some())
        );
        assert_eq!(
            bf16[3].id,
            OpId {
                layer: Some(0),
                kind: OpKind::InputNorm
            }
        );
        assert_eq!(bf16.last().map(|op| op.id.kind), Some(OpKind::Sampling));
    }

    #[test]
    fn ops_gemm_shapes_of_qwen3_8b() {
        let ops = ops_of(&scenario(Phase::Decode, 4, 1, Weights::Bf16));
        let l = Some(35);
        assert_eq!(
            *shape(&ops, l, OpKind::QkvProj),
            Shape::Gemm {
                m: 4,
                n: 6144,
                k: 4096
            }
        );
        assert_eq!(
            *shape(&ops, l, OpKind::OProj),
            Shape::Gemm {
                m: 4,
                n: 4096,
                k: 4096
            }
        );
        assert_eq!(
            *shape(&ops, l, OpKind::GateUpProj),
            Shape::Gemm {
                m: 4,
                n: 24576,
                k: 4096
            }
        );
        assert_eq!(
            *shape(&ops, l, OpKind::DownProj),
            Shape::Gemm {
                m: 4,
                n: 4096,
                k: 12288
            }
        );
        assert_eq!(
            *shape(&ops, l, OpKind::QkNorm),
            Shape::Rows {
                rows: 4 * 40,
                cols: 128
            }
        );
    }

    #[test]
    fn ops_lm_head_sees_one_token_per_request() {
        let ops = ops_of(&scenario(Phase::Prefill, 2, 512, Weights::Bf16));
        assert_eq!(
            *shape(&ops, None, OpKind::FinalNorm),
            Shape::Rows {
                rows: 1024,
                cols: 4096
            }
        );
        assert_eq!(
            *shape(&ops, None, OpKind::LmHead),
            Shape::Gemm {
                m: 2,
                n: 151_936,
                k: 4096
            }
        );
    }
}
