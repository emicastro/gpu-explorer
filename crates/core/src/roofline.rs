//! FLOPs, HBM bytes and the lower-bound time of each kernel (design §4.2;
//! brief §7.1; ADR 0012).
//!
//! Each op declares the tensors it reads and writes. Standalone, an op moves
//! all of them through HBM. Fused, a kernel moves only what crosses its
//! boundary: tensors its ops read that it did not write itself, and tensors
//! it writes that another kernel reads or that outlive the step (the KV
//! cache, the sampled tokens). The gap between the two is the fusion saving.
//!
//! Index and metadata tensors (token ids, positions, slot mappings, block
//! tables) are left out: a few bytes per token, not per element. So is
//! RoPE's cos/sin table.

use std::collections::{HashMap, HashSet};
use std::ops::Add;

use crate::error::CoreError;
use crate::fusion::{FusedStep, Impl, Kernel};
use crate::hardware::{HwNode, TensorPrecision};
use crate::model::{Fp8Scheme, ModelConfig, ScaleGranularity};
use crate::ops::{Op, OpId, OpKind, Shape};
use crate::quantity::{Confidence, Provenance};
use crate::scenario::{GRAPH_PADDING_SOURCE, Phase, Scenario, Weights};
use crate::units::{Bytes, Flops, Intensity, Seconds};

const SOURCE_FORMULAS: &str = "brief §7.1: roofline formulas (GEMM 2·M·N·K; attention 4·B·T·n_q·d·S_ef; elementwise = read + write)";
const SOURCE_ELEMENTWISE: &str = "design §4.2: FLOPs per element of norms, RoPE, SiLU·mul and quantization are approximate counts";
const SOURCE_PARTIALS: &str = "vllm-project/flash-attention 9cd61de: hopper/flash_api.cpp allocates out_accum fp32 [splits, heads, total_q, d] and softmax_lse_accum fp32 [splits, heads, total_q]; hopper/epilogue_fwd.hpp writes them only for a request with more than one dynamic split, and O directly otherwise; hopper/flash_fwd_combine_kernel.h returns early for a request with one split. The final LSE (4 B per query head and token) is not counted";
const SOURCE_SAMPLING: &str =
    "sampling: one read of the logits; the sampler's internal passes are not modeled";

/// Bytes of a BF16 element: activations, norm weights, the embedding table
/// and the LM head in every weight format.
const BF16: f64 = 2.0;
/// Bytes of an FP32 element: quantization scales and attention partials.
const FP32: f64 = 4.0;
/// Bytes of a sampled token id (int64).
const TOKEN_ID: f64 = 8.0;

/// What a byte of traffic is, for the HBM breakdown.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Class {
    /// Weights, norm weights, embedding rows and their quantization scales.
    Weights,
    Kv,
    Activations,
}

/// HBM bytes by class.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Traffic {
    pub weights: Bytes,
    pub kv: Bytes,
    pub activations: Bytes,
}

impl Traffic {
    pub fn total(&self) -> Bytes {
        self.weights + self.kv + self.activations
    }

    fn record(&mut self, class: Class, bytes: Bytes) {
        let slot = match class {
            Class::Weights => &mut self.weights,
            Class::Kv => &mut self.kv,
            Class::Activations => &mut self.activations,
        };
        *slot = *slot + bytes;
    }
}

impl Add for Traffic {
    type Output = Traffic;
    fn add(self, rhs: Traffic) -> Traffic {
        Traffic {
            weights: self.weights + rhs.weights,
            kv: self.kv + rhs.kv,
            activations: self.activations + rhs.activations,
        }
    }
}

/// FLOPs and HBM traffic of an op or a kernel.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Cost {
    pub flops: Flops,
    pub read: Traffic,
    pub write: Traffic,
}

impl Cost {
    pub fn bytes(&self) -> Bytes {
        self.read.total() + self.write.total()
    }

    /// FLOPs per HBM byte; zero for a kernel that moves no modeled bytes.
    pub fn intensity(&self) -> Intensity {
        let bytes = self.bytes();
        if bytes.0 > 0.0 {
            self.flops / bytes
        } else {
            Intensity(0.0)
        }
    }
}

impl Add for Cost {
    type Output = Cost;
    fn add(self, rhs: Cost) -> Cost {
        Cost {
            flops: self.flops + rhs.flops,
            read: self.read + rhs.read,
            write: self.write + rhs.write,
        }
    }
}

/// Which roof limits a kernel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Limit {
    Memory,
    Compute,
}

#[derive(Debug, Clone, PartialEq)]
pub struct KernelRoofline {
    /// What crosses the kernel's boundary.
    pub cost: Cost,
    /// The sum of its ops run one by one. `unfused.bytes() - cost.bytes()`
    /// is the fusion saving; negative for FA3's `combine`, which exists only
    /// because attention is split.
    pub unfused: Cost,
    /// Of the cost: the kernel's FLOPs and bytes.
    pub provenance: Provenance,
    /// The tensor-core peak the kernel is held to: FP8 only when both GEMM
    /// operands are FP8 (design §4.2).
    pub precision: TensorPrecision,
    pub limit: Limit,
    /// `max(FLOPs / peak, bytes / bandwidth)`.
    pub lower_bound: Seconds,
    /// Of the lower bound: the cost's, joined with the peak's and the
    /// bandwidth's.
    pub time_provenance: Provenance,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StepRoofline {
    /// One per kernel of the fused step, in the same order.
    pub kernels: Vec<KernelRoofline>,
}

impl StepRoofline {
    /// Kernels run one after another: the step's bound is their sum.
    pub fn lower_bound(&self) -> Seconds {
        self.kernels.iter().map(|k| k.lower_bound).sum()
    }

    /// Tokens the step processes (`M`) per second of lower-bound time: the
    /// throughput ceiling. In decode, `M` is the batch.
    pub fn tokens_per_second(&self, scenario: &Scenario) -> f64 {
        scenario.tokens() as f64 / self.lower_bound().0
    }

    /// HBM bytes of the whole step, by class.
    pub fn traffic(&self) -> Traffic {
        self.kernels
            .iter()
            .fold(Traffic::default(), |t, k| t + k.cost.read + k.cost.write)
    }

    pub fn provenance(&self) -> Provenance {
        self.kernels
            .iter()
            .map(|k| &k.time_provenance)
            .fold(Provenance::new(Confidence::Documented, [""; 0]), |a, b| {
                a.join(b)
            })
    }
}

/// The roofline of every kernel in `step`.
///
/// `kv_splits` holds, per request, the splits FA3's prepare kernel gives it
/// (`tiling::fa3`), not the cap the host sees. When the step has a
/// `combine` kernel, a request with more than one sends fp32 partials from
/// FA3 to `combine`; a request with one has FA3 write its output directly.
pub fn roofline(
    step: &FusedStep,
    model: &ModelConfig,
    scenario: &Scenario,
    hw: &HwNode,
    kv_splits: &[u32],
) -> Result<StepRoofline, CoreError> {
    if kv_splits.len() as u64 != scenario.batch() {
        return Err(CoreError::InvalidScenario(format!(
            "{} split counts for {} requests",
            kv_splits.len(),
            scenario.batch()
        )));
    }
    let cx = Cx::new(model, scenario);
    let (split_kv, split_prov) = cx.split_kv(kv_splits);
    let ops: HashMap<OpId, &Op> = step.ops.iter().map(|op| (op.id, op)).collect();
    let op = |id: &OpId| {
        ops.get(id).copied().ok_or_else(|| {
            CoreError::InvalidData(format!("roofline: kernel op {id:?} not in step"))
        })
    };
    let flows: HashMap<OpId, Flow> = step.ops.iter().map(|o| (o.id, cx.flow(o))).collect();

    // The kernels that read each tensor.
    let mut readers: HashMap<Tensor, HashSet<usize>> = HashMap::new();
    for (i, k) in step.kernels.iter().enumerate() {
        for id in &k.ops {
            for a in &flows[id].reads {
                readers.entry(a.tensor).or_default().insert(i);
            }
        }
    }
    let combined: HashSet<OpId> = step
        .kernels
        .iter()
        .filter(|k| k.imp == Impl::Fa3Combine)
        .flat_map(|k| k.ops.iter().copied())
        .collect();

    let (bw, bw_prov) = hw.hbm_bandwidth()?;
    let mut out = Vec::with_capacity(step.kernels.len());
    for (i, k) in step.kernels.iter().enumerate() {
        let mut cost = Cost::default();
        let mut unfused = Cost::default();
        let mut prov = k.provenance.join(&model.provenance());
        let mut written = HashSet::new();
        for id in &k.ops {
            op(id)?;
            let flow = &flows[id];
            if k.imp == Impl::Fa3Combine {
                // The op is counted in the FA3 kernel; this one only merges
                // the partials.
                cost = cost + cx.combine(&split_kv);
                prov = prov.join(&split_prov).join(&cx.elementwise());
                continue;
            }
            unfused = unfused + flow.standalone();
            prov = prov.join(&flow.provenance);
            cost.flops = cost.flops + flow.flops;
            for a in &flow.reads {
                if !written.contains(&a.tensor) {
                    cost.read.record(a.class, a.bytes);
                }
            }
            let split = combined.contains(id);
            for a in &flow.writes {
                written.insert(a.tensor);
                if split && matches!(a.tensor, Tensor::Out(_, Part::Whole)) {
                    cost.write.record(Class::Activations, split_kv.partials);
                    cost.write.record(a.class, split_kv.direct);
                    prov = prov.join(&split_prov);
                    continue;
                }
                let read_elsewhere = readers
                    .get(&a.tensor)
                    .is_some_and(|ks| ks.iter().any(|&r| r != i));
                if a.tensor.outlives_step() || read_elsewhere {
                    cost.write.record(a.class, a.bytes);
                }
            }
        }

        let precision = precision(k);
        let (peak, peak_prov) = hw.peak_tensor(precision)?;
        let t_compute = cost.flops / peak;
        let t_memory = cost.bytes() / bw;
        let (limit, lower_bound) = if t_compute > t_memory {
            (Limit::Compute, t_compute)
        } else {
            (Limit::Memory, t_memory)
        };
        let time_provenance = prov.join(&peak_prov).join(&bw_prov);
        out.push(KernelRoofline {
            cost,
            unfused,
            provenance: prov,
            precision,
            limit,
            lower_bound,
            time_provenance,
        });
    }
    Ok(StepRoofline { kernels: out })
}

/// An op's cost run on its own: every tensor it touches goes through HBM.
pub fn op_cost(op: &Op, model: &ModelConfig, scenario: &Scenario) -> (Cost, Provenance) {
    let flow = Cx::new(model, scenario).flow(op);
    (flow.standalone(), flow.provenance)
}

fn precision(k: &Kernel) -> TensorPrecision {
    match k.imp {
        Impl::CutlassFp8Tensor | Impl::FlashinferSwapab | Impl::DeepgemmSm90 => {
            TensorPrecision::Fp8
        }
        _ => TensorPrecision::Bf16,
    }
}

/// One tensor of a step, for telling a kernel's intermediates from its
/// inputs and outputs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Tensor {
    /// A weight, table or scale an op reads. Nothing writes it.
    Param(OpId),
    /// The KV cache of a layer: this step writes its tokens, attention reads
    /// all of it, and it outlives the step.
    KvCache(u32),
    /// What an op writes, by part where it writes several tensors.
    Out(OpId, Part),
    /// The step's result.
    Sampled,
}

impl Tensor {
    fn outlives_step(self) -> bool {
        matches!(self, Tensor::KvCache(_) | Tensor::Sampled)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Part {
    Whole,
    /// Q and K out of the QKV GEMM, or out of QK-norm.
    Qk,
    V,
    Q,
    K,
}

#[derive(Debug, Clone, Copy)]
struct Access {
    tensor: Tensor,
    bytes: Bytes,
    class: Class,
}

/// What an op computes, reads and writes.
struct Flow {
    flops: Flops,
    reads: Vec<Access>,
    writes: Vec<Access>,
    /// Of the formulas behind this op's numbers.
    provenance: Provenance,
}

impl Flow {
    fn standalone(&self) -> Cost {
        let mut c = Cost {
            flops: self.flops,
            ..Cost::default()
        };
        for a in &self.reads {
            c.read.record(a.class, a.bytes);
        }
        for a in &self.writes {
            c.write.record(a.class, a.bytes);
        }
        c
    }
}

/// The scenario facts every op's flow needs.
struct Cx<'a> {
    model: &'a ModelConfig,
    scenario: &'a Scenario,
    layers: u32,
}

impl<'a> Cx<'a> {
    fn new(model: &'a ModelConfig, scenario: &'a Scenario) -> Self {
        Cx {
            model,
            scenario,
            layers: model.config.num_hidden_layers as u32,
        }
    }

    /// The FP8 scheme of the weights, if they are FP8. W8A16 runs the same
    /// block-scaled checkpoint through Marlin.
    fn fp8(&self) -> Option<&'a Fp8Scheme> {
        let v = &self.model.quantization_variants;
        match self.scenario.weights {
            Weights::Bf16 => None,
            Weights::Fp8Block | Weights::Fp8W8a16 => Some(&v.block),
            Weights::Fp8Tensor => Some(&v.per_tensor),
        }
    }

    fn fp8_provenance(&self) -> Provenance {
        let mut p = self.fp8().map_or_else(
            || self.formulas(),
            |s| {
                self.formulas()
                    .join(&Provenance::new(s.confidence, &s.sources))
            },
        );
        if self.scenario.weights == Weights::Fp8W8a16 {
            p = p.join(&Provenance::new(
                Confidence::Simplified,
                ["design §4.1: W8A16 runs the block-scaled FP8 checkpoint through Marlin"],
            ));
        }
        p
    }

    fn formulas(&self) -> Provenance {
        Provenance::new(Confidence::Documented, [SOURCE_FORMULAS])
    }

    fn elementwise(&self) -> Provenance {
        Provenance::new(
            Confidence::Simplified,
            [SOURCE_FORMULAS, SOURCE_ELEMENTWISE],
        )
    }

    fn flow(&self, op: &Op) -> Flow {
        use OpKind::*;
        let id = op.id;
        let at = |kind| OpId {
            layer: id.layer,
            kind,
        };
        let out = |id: OpId| Tensor::Out(id, Part::Whole);
        let act = |tensor, elements: u64| Access {
            tensor,
            bytes: Bytes(elements as f64 * BF16),
            class: Class::Activations,
        };
        let norm_weight = |elements: u64| Access {
            tensor: Tensor::Param(id),
            bytes: Bytes(elements as f64 * BF16),
            class: Class::Weights,
        };
        let flow = |flops: f64, reads, writes, provenance| Flow {
            flops: Flops(flops),
            reads,
            writes,
            provenance,
        };
        let w8a8 = self.scenario.weights.is_w8a8();

        let mut f = match (id.kind, &op.shape) {
            (PrepareInputs | AttentionSchedule, _) => flow(0.0, vec![], vec![], self.formulas()),
            (Embedding, &Shape::Rows { rows, cols }) => {
                // One table row per token.
                let table = Access {
                    tensor: Tensor::Param(id),
                    bytes: Bytes((rows * cols) as f64 * BF16),
                    class: Class::Weights,
                };
                flow(
                    0.0,
                    vec![table],
                    vec![act(out(id), rows * cols)],
                    self.formulas(),
                )
            }
            (InputNorm | PostAttnNorm | FinalNorm, &Shape::Rows { rows, cols }) => {
                let input = match id.kind {
                    InputNorm => self.stream(id.layer),
                    PostAttnNorm => out(at(AttnResidual)),
                    _ => self.stream(Some(self.layers)),
                };
                let n = rows * cols;
                flow(
                    4.0 * n as f64,
                    vec![act(input, n), norm_weight(cols)],
                    vec![act(out(id), n)],
                    self.elementwise(),
                )
            }
            (AttnResidual | MlpResidual, &Shape::Rows { rows, cols }) => {
                let branch = if id.kind == AttnResidual {
                    out(at(OProj))
                } else {
                    out(at(DownProj))
                };
                let residual = if id.kind == AttnResidual {
                    self.stream(id.layer)
                } else {
                    out(at(AttnResidual))
                };
                let n = rows * cols;
                flow(
                    n as f64,
                    vec![act(branch, n), act(residual, n)],
                    vec![act(out(id), n)],
                    self.elementwise(),
                )
            }
            (QkvQuant | OQuant | GateUpQuant | DownQuant, &Shape::Rows { rows, cols }) => {
                let input = match id.kind {
                    QkvQuant => out(at(InputNorm)),
                    OQuant => out(at(Attention)),
                    GateUpQuant => out(at(PostAttnNorm)),
                    _ => out(at(SiluMul)),
                };
                let n = rows * cols;
                let quantized = Access {
                    tensor: out(id),
                    bytes: self.fp8_activation(rows, cols),
                    class: Class::Activations,
                };
                flow(
                    2.0 * n as f64,
                    vec![act(input, n)],
                    vec![quantized],
                    self.elementwise().join(&self.fp8_provenance()),
                )
            }
            (QkvProj | OProj | GateUpProj | DownProj | LmHead, &Shape::Gemm { m, n, k }) => {
                let (input, quant) = match id.kind {
                    QkvProj => (out(at(InputNorm)), out(at(QkvQuant))),
                    OProj => (out(at(Attention)), out(at(OQuant))),
                    GateUpProj => (out(at(PostAttnNorm)), out(at(GateUpQuant))),
                    DownProj => (out(at(SiluMul)), out(at(DownQuant))),
                    _ => (out(at(GatherLast)), out(at(GatherLast))),
                };
                let lm_head = id.kind == LmHead;
                let a = if w8a8 && !lm_head {
                    Access {
                        tensor: quant,
                        bytes: self.fp8_activation(m, k),
                        class: Class::Activations,
                    }
                } else {
                    act(input, m * k)
                };
                let (w_bytes, mut prov) = if lm_head {
                    (Bytes((n * k) as f64 * BF16), self.formulas())
                } else {
                    (self.weight_bytes(n, k), self.fp8_provenance())
                };
                let w = Access {
                    tensor: Tensor::Param(id),
                    bytes: w_bytes,
                    class: Class::Weights,
                };
                let writes = if id.kind == QkvProj {
                    let c = &self.model.config;
                    let d = c.head_dim;
                    vec![
                        act(
                            Tensor::Out(id, Part::Qk),
                            m * (c.num_attention_heads + c.num_key_value_heads) * d,
                        ),
                        act(Tensor::Out(id, Part::V), m * c.num_key_value_heads * d),
                    ]
                } else {
                    vec![act(out(id), m * n)]
                };
                if lm_head {
                    prov = prov.join(&self.formulas());
                }
                flow(2.0 * (m * n * k) as f64, vec![a, w], writes, prov)
            }
            (QkNorm, &Shape::Rows { rows, cols }) => {
                let n = rows * cols;
                let qk = Tensor::Out(at(QkvProj), Part::Qk);
                // q_norm and k_norm, one weight of `head_dim` each.
                flow(
                    4.0 * n as f64,
                    vec![act(qk, n), norm_weight(2 * cols)],
                    vec![act(Tensor::Out(id, Part::Qk), n)],
                    self.elementwise(),
                )
            }
            (Rope, &Shape::Rows { rows, cols }) => {
                let c = &self.model.config;
                let n = rows * cols;
                let m = self.scenario.padded_tokens();
                let (q, k) = (
                    m * c.num_attention_heads * c.head_dim,
                    m * c.num_key_value_heads * c.head_dim,
                );
                flow(
                    3.0 * n as f64,
                    vec![act(Tensor::Out(at(QkNorm), Part::Qk), n)],
                    vec![
                        act(Tensor::Out(id, Part::Q), q),
                        act(Tensor::Out(id, Part::K), k),
                    ],
                    self.elementwise(),
                )
            }
            (
                KvWrite,
                &Shape::KvWrite {
                    tokens,
                    kv_heads,
                    head_dim,
                },
            ) => {
                let n = tokens * kv_heads * head_dim;
                let layer = id.layer.unwrap_or_default();
                let cache = Access {
                    tensor: Tensor::KvCache(layer),
                    bytes: 2.0 * Bytes(n as f64) * self.scenario.kv.element_bytes().0,
                    class: Class::Kv,
                };
                flow(
                    0.0,
                    vec![
                        act(Tensor::Out(at(Rope), Part::K), n),
                        act(Tensor::Out(at(QkvProj), Part::V), n),
                    ],
                    vec![cache],
                    self.formulas(),
                )
            }
            (
                Attention,
                Shape::Attention {
                    contexts,
                    new_tokens,
                    q_heads,
                    kv_heads,
                    head_dim,
                },
            ) => {
                let t = f64::from(*new_tokens);
                // Causal mask: query j of the T new ones sees prefix + j
                // keys, so the mean is S − (T − 1)/2. In decode, S.
                let s_eff: f64 = contexts
                    .iter()
                    .map(|&s| f64::from(s) - (t - 1.0) / 2.0)
                    .sum();
                let flops = 4.0 * t * (q_heads * head_dim) as f64 * s_eff;
                let keys: u64 = contexts.iter().map(|&s| u64::from(s)).sum();
                let layer = id.layer.unwrap_or_default();
                let kv = Access {
                    tensor: Tensor::KvCache(layer),
                    bytes: Bytes((2 * keys * kv_heads * head_dim) as f64)
                        * self.scenario.kv.element_bytes().0,
                    class: Class::Kv,
                };
                let m = self.scenario.tokens();
                let q = m * q_heads * head_dim;
                let mut prov = self.formulas();
                if self.scenario.phase == Phase::Prefill {
                    // FA3 skips masked tiles, not masked elements.
                    prov = prov.join(&Provenance::new(
                        Confidence::Simplified,
                        ["brief §7.1: prefill attention FLOPs count the causal mask exactly; FA3 computes whole tiles on the diagonal"],
                    ));
                }
                flow(
                    flops,
                    vec![act(Tensor::Out(at(Rope), Part::Q), q), kv],
                    vec![act(out(id), q)],
                    prov,
                )
            }
            (SiluMul, &Shape::Rows { rows, cols }) => {
                // `cols` is the output width; the input is gate and up.
                let n = rows * cols;
                flow(
                    5.0 * n as f64,
                    vec![act(out(at(GateUpProj)), 2 * n)],
                    vec![act(out(id), n)],
                    self.elementwise(),
                )
            }
            (GatherLast, &Shape::Rows { rows, cols }) => {
                let n = rows * cols;
                flow(
                    0.0,
                    vec![act(out(at(FinalNorm)), n)],
                    vec![act(out(id), n)],
                    self.formulas(),
                )
            }
            (Sampling, &Shape::Rows { rows, cols }) => {
                let n = rows * cols;
                let tokens = Access {
                    tensor: Tensor::Sampled,
                    bytes: Bytes(rows as f64 * TOKEN_ID),
                    class: Class::Activations,
                };
                flow(
                    5.0 * n as f64,
                    vec![act(out(at(LmHead)), n)],
                    vec![tokens],
                    Provenance::new(Confidence::Estimated, [SOURCE_SAMPLING]),
                )
            }
            (kind, shape) => unreachable!("step_ops never builds {kind:?} with {shape:?}"),
        };
        if id.kind.graph_padded() && self.scenario.padded_tokens() > self.scenario.tokens() {
            f.provenance = f.provenance.join(&Provenance::new(
                Confidence::Documented,
                [GRAPH_PADDING_SOURCE],
            ));
        }
        f
    }

    /// The residual stream entering `layer`: the embedding's output for the
    /// first, the previous layer's MLP residual after that. `Some(layers)`
    /// is the stream after the last layer.
    fn stream(&self, layer: Option<u32>) -> Tensor {
        let id = match layer {
            Some(0) | None => OpId {
                layer: None,
                kind: OpKind::Embedding,
            },
            Some(l) => OpId {
                layer: Some(l - 1),
                kind: OpKind::MlpResidual,
            },
        };
        Tensor::Out(id, Part::Whole)
    }

    /// An `[n, k]` weight in the scenario's format, with its scales.
    fn weight_bytes(&self, n: u64, k: u64) -> Bytes {
        match self.fp8() {
            None => Bytes((n * k) as f64 * BF16),
            Some(s) => Bytes((n * k) as f64 + scales(s.weight_scale, n, k) as f64 * FP32),
        }
    }

    /// An `[m, k]` activation quantized to FP8, with its scales.
    fn fp8_activation(&self, m: u64, k: u64) -> Bytes {
        let scale = self
            .fp8()
            .map_or(ScaleGranularity::Token, |s| s.activation_scale);
        Bytes((m * k) as f64 + scales(scale, m, k) as f64 * FP32)
    }

    /// Where the attention output goes when FA3 runs with `combine`, given
    /// each request's splits.
    fn split_kv(&self, kv_splits: &[u32]) -> (SplitKv, Provenance) {
        let c = &self.model.config;
        let rows = u64::from(self.scenario.new_tokens) * c.num_attention_heads;
        let mut s = SplitKv::default();
        for &n in kv_splits {
            let out = rows * c.head_dim;
            if n > 1 {
                let n = u64::from(n);
                // An fp32 output row and its LSE per split and query head.
                s.partials = s.partials + Bytes((n * rows * (c.head_dim + 1)) as f64 * FP32);
                s.merged = s.merged + Bytes(out as f64 * BF16);
                s.merged_elements += n * out;
            } else {
                s.direct = s.direct + Bytes(out as f64 * BF16);
            }
        }
        (
            s,
            Provenance::new(Confidence::Documented, [SOURCE_PARTIALS]),
        )
    }

    /// FA3's `combine`: reads the partials and writes the output of the
    /// requests that have them. With none it has nothing to merge.
    fn combine(&self, s: &SplitKv) -> Cost {
        let mut cost = Cost::default();
        if s.merged_elements == 0 {
            return cost;
        }
        cost.read.record(Class::Activations, s.partials);
        cost.write.record(Class::Activations, s.merged);
        // Rescale and add each split's output.
        cost.flops = Flops(3.0 * s.merged_elements as f64);
        cost
    }
}

/// FA3's output under split-KV.
#[derive(Debug, Default)]
struct SplitKv {
    /// fp32 partials of the requests with more than one split.
    partials: Bytes,
    /// Output of those requests, which `combine` writes.
    merged: Bytes,
    /// Output of the requests with one split, which FA3 writes itself.
    direct: Bytes,
    /// Σ splits · output elements over the merged requests.
    merged_elements: u64,
}

/// How many scales a `[rows, cols]` tensor carries.
fn scales(g: ScaleGranularity, rows: u64, cols: u64) -> u64 {
    match g {
        ScaleGranularity::Tensor => 1,
        ScaleGranularity::Token => rows,
        ScaleGranularity::Block { size: [r, c] } | ScaleGranularity::Group { size: [r, c] } => {
            rows.div_ceil(r) * cols.div_ceil(c)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fusion::fusion_profile;
    use crate::hardware::hardware;
    use crate::model::{KvDtype, model};
    use crate::scenario::graph_size;
    use crate::units::Count;

    /// vLLM's split cap under CUDA graphs: what the host sees in decode.
    const GRAPH_SPLITS: u32 = 32;

    struct Run {
        model: ModelConfig,
        scenario: Scenario,
        step: FusedStep,
        roofline: StepRoofline,
    }

    fn run(scenario: Scenario, kv_splits: u32) -> Run {
        let m = model("qwen3-8b").expect("valid preset");
        let hw = hardware("h100-sxm").expect("valid preset");
        let host_splits = match scenario.phase {
            Phase::Decode => GRAPH_SPLITS,
            Phase::Prefill => kv_splits,
        };
        let step = fusion_profile("vllm-0.31.0-h100")
            .expect("valid profile")
            .fuse(&m, &scenario, host_splits)
            .expect("fuses");
        let splits = vec![kv_splits; scenario.contexts.len()];
        let roofline = roofline(&step, &m, &scenario, &hw, &splits).expect("roofline");
        Run {
            model: m,
            scenario,
            step,
            roofline,
        }
    }

    fn decode(batch: usize, context: u32, weights: Weights) -> Scenario {
        Scenario {
            phase: Phase::Decode,
            contexts: vec![context; batch],
            new_tokens: 1,
            weights,
            kv: KvDtype::Bf16,
        }
    }

    impl Run {
        /// The roofline of the kernel of `layer` that fuses `kind` (the
        /// main FA3 kernel for attention).
        fn kernel(&self, layer: u32, kind: OpKind) -> (&Kernel, &KernelRoofline) {
            let id = OpId {
                layer: Some(layer),
                kind,
            };
            let i = self
                .step
                .kernels
                .iter()
                .position(|k| k.ops.contains(&id) && k.imp != Impl::Fa3Combine)
                .unwrap_or_else(|| panic!("no kernel runs {id:?}"));
            (&self.step.kernels[i], &self.roofline.kernels[i])
        }

        fn op(&self, layer: u32, kind: OpKind) -> (Cost, Provenance) {
            let id = OpId {
                layer: Some(layer),
                kind,
            };
            let op = self
                .step
                .ops
                .iter()
                .find(|o| o.id == id)
                .expect("op in step");
            op_cost(op, &self.model, &self.scenario)
        }
    }

    fn close(got: f64, want: f64, tol: f64) -> bool {
        (got / want - 1.0).abs() < tol
    }

    const H: f64 = 4096.0;

    #[test]
    fn roofline_decode_ceiling_8b_bf16_batch_1() {
        // A short context, as in the GPUStack benchmark (brief §8).
        let r = run(decode(1, 350, Weights::Bf16), 1);
        let tps = r.roofline.tokens_per_second(&r.scenario);
        assert!(close(tps, 221.0, 0.015), "{tps} tok/s");
        // Everything at batch 1 waits on memory.
        assert!(r.roofline.kernels.iter().all(|k| k.limit == Limit::Memory));

        // The weights the step reads are exactly the parameters a decode
        // step touches (model.rs), at 2 bytes each: ≈ 15.1 GB.
        let (params, _) = r.model.decode_parameters_read(Count(1));
        let weights = r.roofline.traffic().weights;
        assert_eq!(weights, Bytes(params.as_f64() * BF16));
        assert!(close(weights.0, 15.1e9, 0.01), "{weights:?}");
    }

    #[test]
    fn roofline_decode_attention_intensity_is_the_gqa_ratio() {
        for batch in [1, 8, 64] {
            let r = run(decode(batch, 8192, Weights::Bf16), 13);
            // n_q / n_kv = 32 / 8, whatever the batch: each request reads
            // its own KV.
            let (cost, _) = r.op(0, OpKind::Attention);
            let i = cost.intensity().0;
            assert!(close(i, 4.0, 0.002), "batch {batch}: op intensity {i}");
            // The kernel also writes the split partials: still ≈ 4.
            let (_, k) = r.kernel(0, OpKind::Attention);
            let i = k.cost.intensity().0;
            assert!(close(i, 4.0, 0.01), "batch {batch}: kernel intensity {i}");
            assert_eq!(k.limit, Limit::Memory);
        }
    }

    const GEMMS: [OpKind; 4] = [
        OpKind::QkvProj,
        OpKind::OProj,
        OpKind::GateUpProj,
        OpKind::DownProj,
    ];

    #[test]
    fn roofline_decode_gemm_intensity_tracks_m() {
        for batch in [1, 8, 32, 64] {
            let r = run(decode(batch, 1024, Weights::Bf16), 1);
            for kind in GEMMS {
                let (_, k) = r.kernel(0, kind);
                let i = k.cost.intensity().0;
                // Below M: the activations add bytes, ~3 % at M = 64.
                assert!(i < batch as f64, "{kind:?} at M = {batch}: {i}");
                assert!(close(i, batch as f64, 0.05), "{kind:?} at M = {batch}: {i}");
            }
        }
    }

    /// The weights alone put the crossing at the ridge, M ≈ 295. The
    /// activations add `M · (N + K)` elements, which moves it to
    /// `M* = r · NK / (NK − r · (N + K))`: 322–345 for Qwen3-8B's shapes.
    #[test]
    fn graph_padding_grows_activation_bytes_not_weights() {
        // Batch 25 replays the graph captured for 32.
        let padded = run(decode(25, 1024, Weights::Bf16), 1);
        let one = run(decode(1, 1024, Weights::Bf16), 1);
        let pads = |k: &KernelRoofline| k.provenance.sources().any(|s| s == GRAPH_PADDING_SOURCE);
        for kind in GEMMS {
            let (_, k) = padded.kernel(0, kind);
            let (_, k1) = one.kernel(0, kind);
            assert_eq!(k.cost.read.weights, k1.cost.read.weights, "{kind:?}");
            assert_eq!(
                k.cost.read.activations,
                32.0 * k1.cost.read.activations,
                "{kind:?}"
            );
            assert!(pads(k) && !pads(k1), "{kind:?}");
        }
        // The KV write and attention skip the padded rows.
        let (_, kv) = padded.kernel(0, OpKind::KvWrite);
        let (_, kv1) = one.kernel(0, OpKind::KvWrite);
        assert_eq!(kv.cost.write.kv, 25.0 * kv1.cost.write.kv);
        let (attn, _) = padded.op(0, OpKind::Attention);
        let (attn1, _) = one.op(0, OpKind::Attention);
        assert_eq!(attn.flops, 25.0 * attn1.flops);
        // The throughput ceiling counts real tokens.
        let bound = padded.roofline.lower_bound().0;
        assert_eq!(
            padded.roofline.tokens_per_second(&padded.scenario),
            25.0 / bound
        );
    }

    #[test]
    fn graph_padding_pads_a_small_prefill_but_not_its_attention() {
        // 300 tokens run in the PIECEWISE graph captured for 304.
        let r = run(
            Scenario {
                phase: Phase::Prefill,
                contexts: vec![300],
                new_tokens: 300,
                weights: Weights::Bf16,
                kv: KvDtype::Bf16,
            },
            1,
        );
        let (_, qkv) = r.kernel(0, OpKind::QkvProj);
        assert_eq!(qkv.cost.read.activations, Bytes(304.0 * H * BF16));
        let (_, attn) = r.kernel(0, OpKind::Attention);
        let q = 300.0 * 32.0 * 128.0 * BF16;
        assert_eq!(attn.cost.write.activations, Bytes(q));
    }

    #[test]
    fn graph_padding_stops_over_512_tokens() {
        let r = run(decode(600, 1024, Weights::Bf16), 1);
        let (_, qkv) = r.kernel(0, OpKind::QkvProj);
        assert_eq!(qkv.cost.read.activations, Bytes(600.0 * H * BF16));
        assert!(qkv.provenance.sources().all(|s| s != GRAPH_PADDING_SOURCE));
    }

    #[test]
    fn roofline_decode_gemms_cross_the_ridge_near_295() {
        let hw = hardware("h100-sxm").expect("valid preset");
        let (ridge, _) = hw.ridge(TensorPrecision::Bf16).expect("ridge");
        let limit = |batch: usize, kind| {
            let r = run(decode(batch, 1024, Weights::Bf16), 1);
            r.kernel(0, kind).1.limit
        };
        let shapes = [(6144.0, H), (H, H), (24576.0, H), (H, 12288.0)];
        for (kind, (n, k)) in GEMMS.into_iter().zip(shapes) {
            let r = ridge.0;
            let want = r * n * k / (n * k - r * (n + k));
            assert!((295.0..350.0).contains(&want), "{kind:?}: {want}");
            // The smallest batch that is compute-bound. Its GEMMs run at
            // the padded M, so `M*` falls between its captured size and
            // the previous batch's.
            let (mut lo, mut hi) = (1, 1024);
            assert_eq!(limit(hi, kind), Limit::Compute, "{kind:?}");
            while hi - lo > 1 {
                let mid = (lo + hi) / 2;
                match limit(mid, kind) {
                    Limit::Compute => hi = mid,
                    Limit::Memory => lo = mid,
                }
            }
            let m = |b: usize| graph_size(b as u64).expect("a captured size");
            let want = want.ceil() as u64;
            assert!(
                m(hi - 1) < want && want <= m(hi),
                "{kind:?}: batch {hi} crosses, M* = {want}"
            );
        }
    }

    #[test]
    fn roofline_kv_equals_weights_near_102k() {
        let kv = |s| run(decode(1, s, Weights::Bf16), 1).roofline.traffic();
        let (a, b) = (kv(1000), kv(2000));
        let per_token = (b.kv - a.kv) / 1000.0;
        assert_eq!(per_token, Bytes(147_456.0));
        let s = a.weights / per_token;
        assert!(close(s, 102_400.0, 0.01), "KV equals weights at S = {s}");
    }

    #[test]
    fn roofline_residual_norm_keeps_the_residual() {
        let r = run(decode(4, 1024, Weights::Bf16), 1);
        let m = 4.0;
        let (_, k) = r.kernel(1, OpKind::InputNorm);
        // Reads the MLP output, the residual and the norm weight; writes
        // the normed activation and the new residual, which the next
        // residual add reads.
        assert_eq!(k.cost.read.total(), Bytes((2.0 * m * H + H) * BF16));
        assert_eq!(k.cost.write.total(), Bytes(2.0 * m * H * BF16));
        // Unfused, the new residual is also written and read back.
        let saving = k.unfused.bytes() - k.cost.bytes();
        assert_eq!(saving, Bytes(m * H * BF16));

        // The last one feeds only the final norm: nothing to keep.
        let fin = r.roofline.kernels.len() - 4;
        assert_eq!(
            r.step.kernels[fin].name,
            "triton_red_fused_fused_add_rms_norm"
        );
        assert_eq!(
            r.roofline.kernels[fin].cost.write.total(),
            Bytes(m * H * BF16)
        );
    }

    #[test]
    fn roofline_qk_norm_and_rope_skip_their_intermediate() {
        let r = run(decode(1, 1024, Weights::Bf16), 1);
        let (_, k) = r.kernel(0, OpKind::Rope);
        let qk = (32.0 + 8.0) * 128.0;
        assert_eq!(k.cost.read.activations, Bytes(qk * BF16));
        assert_eq!(k.cost.write.activations, Bytes(qk * BF16));
        assert_eq!(k.unfused.bytes() - k.cost.bytes(), Bytes(2.0 * qk * BF16));
    }

    #[test]
    fn roofline_fp8_tensor_quantizes_inside_the_norm() {
        let r = run(decode(4, 1024, Weights::Fp8Tensor), 1);
        let m = 4.0;
        let (k, roof) = r.kernel(1, OpKind::QkvQuant);
        assert_eq!(k.name, "triton_red_fused");
        // The BF16 normed activation never leaves the kernel: the residual
        // in BF16 and the FP8 activation with one scale per token do.
        let fp8 = m * H + m * FP32;
        assert_eq!(roof.cost.write.total(), Bytes(m * H * BF16 + fp8));
        let (_, gemm) = r.kernel(1, OpKind::QkvProj);
        assert_eq!(gemm.precision, TensorPrecision::Fp8);
        assert_eq!(gemm.cost.read.activations, Bytes(fp8));
    }

    #[test]
    fn roofline_fp8_halves_weight_bytes() {
        let bf16 = run(decode(1, 1024, Weights::Bf16), 1);
        for w in [Weights::Fp8Block, Weights::Fp8Tensor, Weights::Fp8W8a16] {
            let fp8 = run(decode(1, 1024, w), 1);
            let (_, a) = bf16.kernel(0, OpKind::GateUpProj);
            let (_, b) = fp8.kernel(0, OpKind::GateUpProj);
            let ratio = b.cost.read.weights / a.cost.read.weights;
            assert!(close(ratio, 0.5, 0.001), "{w:?}: {ratio}");
            let want = if w.is_w8a8() {
                TensorPrecision::Fp8
            } else {
                TensorPrecision::Bf16
            };
            assert_eq!(b.precision, want, "{w:?}");
        }
        // The LM head stays in BF16.
        let fp8 = run(decode(1, 1024, Weights::Fp8Block), 1);
        let head = |r: &Run| {
            r.roofline.kernels[r.roofline.kernels.len() - 2]
                .cost
                .read
                .weights
        };
        assert_eq!(head(&fp8), head(&bf16));
    }

    #[test]
    fn roofline_split_partials_cross_to_combine() {
        let combine = |r: &Run| {
            let i = r
                .step
                .kernels
                .iter()
                .position(|k| k.imp == Impl::Fa3Combine)
                .expect("combine runs in decode");
            r.roofline.kernels[i].clone()
        };
        let one = run(decode(1, 8192, Weights::Bf16), 1);
        assert_eq!(combine(&one).cost, Cost::default());

        let r = run(decode(1, 8192, Weights::Bf16), 13);
        let partials = Bytes(13.0 * 32.0 * 129.0 * FP32);
        let c = combine(&r);
        assert_eq!(c.cost.read.total(), partials);
        assert_eq!(c.cost.write.total(), Bytes(32.0 * 128.0 * BF16));
        assert_eq!(c.unfused, Cost::default());
        let (_, fa3) = r.kernel(0, OpKind::Attention);
        assert_eq!(fa3.cost.write.total(), partials);
        // Same FLOPs and reads with or without the split.
        let (_, fa3_one) = one.kernel(0, OpKind::Attention);
        assert_eq!(fa3.cost.flops, fa3_one.cost.flops);
        assert_eq!(fa3.cost.read, fa3_one.cost.read);
    }

    #[test]
    fn roofline_request_with_one_split_skips_combine() {
        // FA3's schedule for 64 + 2 KV blocks: ⌈66 · 1.1 · 8 / 132⌉ = 5 per
        // SM, so 13 splits for the long request and 1 for the short one.
        let s = Scenario {
            contexts: vec![8192, 256],
            ..decode(1, 8192, Weights::Bf16)
        };
        let m = model("qwen3-8b").expect("valid preset");
        let hw = hardware("h100-sxm").expect("valid preset");
        let f = crate::tiling::fa3::fa3(&m, &s, &hw).expect("schedules");
        assert_eq!(f.splits, vec![13, 1]);
        let step = fusion_profile("vllm-0.31.0-h100")
            .expect("valid profile")
            .fuse(&m, &s, f.host_splits)
            .expect("fuses");
        let roof = roofline(&step, &m, &s, &hw, &f.splits).expect("roofline");
        let kernel = |imp| {
            let i = step
                .kernels
                .iter()
                .position(|k| k.imp == imp)
                .expect("kernel runs");
            &roof.kernels[i]
        };
        let partials = Bytes(13.0 * 32.0 * 129.0 * FP32);
        let row = Bytes(32.0 * 128.0 * BF16);
        assert_eq!(kernel(Impl::Fa3).cost.write.total(), partials + row);
        let combine = kernel(Impl::Fa3Combine);
        assert_eq!(combine.cost.read.total(), partials);
        assert_eq!(combine.cost.write.total(), row);
        assert!(combine.provenance.sources().any(|s| s == SOURCE_PARTIALS));

        let err =
            roofline(&step, &m, &s, &hw, &[13]).expect_err("one split count for two requests");
        assert!(matches!(err, CoreError::InvalidScenario(_)), "{err:?}");
    }

    #[test]
    fn roofline_prefill_attention_counts_half_the_new_tokens() {
        // 512 new tokens over a 1024-token context: S_ef = 512 + 256.5.
        let s = Scenario {
            phase: Phase::Prefill,
            contexts: vec![1024; 2],
            new_tokens: 512,
            weights: Weights::Bf16,
            kv: KvDtype::Bf16,
        };
        let r = run(s, 1);
        let (cost, prov) = r.op(0, OpKind::Attention);
        let want = 2.0 * 4.0 * 512.0 * 32.0 * 128.0 * (1024.0 - 255.5);
        assert_eq!(cost.flops, Flops(want));
        assert_eq!(prov.confidence(), Confidence::Simplified);
        // Prefill GEMMs at M = 1024 are compute-bound.
        let (_, k) = r.kernel(0, OpKind::GateUpProj);
        assert_eq!(k.limit, Limit::Compute);
    }

    #[test]
    fn roofline_every_kernel_has_a_provenance_with_sources() {
        for w in [
            Weights::Bf16,
            Weights::Fp8Block,
            Weights::Fp8Tensor,
            Weights::Fp8W8a16,
        ] {
            let r = run(decode(2, 1024, w), 4);
            for (k, roof) in r.step.kernels.iter().zip(&r.roofline.kernels) {
                assert!(
                    roof.time_provenance.sources().next().is_some(),
                    "{}",
                    k.name
                );
                assert!(roof.time_provenance.confidence() >= roof.provenance.confidence());
            }
            // The tensor peak's clock is inferred (hardware.rs).
            assert!(r.roofline.provenance().confidence() >= Confidence::Simplified);
        }
    }
}
