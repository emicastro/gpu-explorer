//! The fusion profile: which kernels an engine launches for the logical ops
//! (design §4.1; brief D7; ADR 0011).
//!
//! The profile is data. Each template names a kernel, the ops it fuses, the
//! tiling model behind it (`impl`) and the scenario it runs in (`when`).

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt;

use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::model::ModelConfig;
use crate::ops::{Op, OpId, OpKind, step_ops};
use crate::quantity::{Confidence, Provenance};
use crate::scenario::{Phase, Scenario, Weights};

const VLLM_0_31_0_H100: &str = include_str!("../../../data/fusion/vllm-0.31.0-h100.json");

/// The fusion profile with this id, parsed and validated.
pub fn fusion_profile(id: &str) -> Result<FusionProfile, CoreError> {
    match id {
        "vllm-0.31.0-h100" => parse(id, VLLM_0_31_0_H100),
        _ => Err(CoreError::UnknownId {
            kind: "fusion profile",
            id: id.to_owned(),
        }),
    }
}

fn parse(name: &str, src: &str) -> Result<FusionProfile, CoreError> {
    let profile: FusionProfile =
        serde_json::from_str(src).map_err(|e| CoreError::InvalidData(format!("{name}: {e}")))?;
    profile.validate()?;
    Ok(profile)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FusionProfile {
    pub id: String,
    pub engine: String,
    pub hardware: String,
    /// Source strings by key; templates cite the keys.
    pub sources: BTreeMap<String, String>,
    /// Once per step, before the first layer.
    pub prologue: Vec<Template>,
    /// Once per layer. The list starts with the kernel that starts the
    /// layer.
    pub layer: Vec<Template>,
    /// Once per step, after the last layer.
    pub epilogue: Vec<Template>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Template {
    /// The kernel's name as the engine or the profiler shows it.
    pub name: String,
    pub ops: Vec<OpRef>,
    #[serde(rename = "impl")]
    pub imp: Impl,
    #[serde(default)]
    pub when: When,
    pub confidence: Confidence,
    /// Keys into the profile's `sources`.
    pub sources: Vec<String>,
}

/// An op kind in the template's layer, or with `@prev` in the layer before
/// it (ADR 0011).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct OpRef {
    pub kind: OpKind,
    pub prev: bool,
}

impl TryFrom<String> for OpRef {
    type Error = String;
    fn try_from(s: String) -> Result<Self, String> {
        let (kind, prev) = match s.strip_suffix("@prev") {
            Some(kind) => (kind, true),
            None => (s.as_str(), false),
        };
        let kind = serde_json::from_value(kind.into()).map_err(|_| format!("unknown op {s:?}"))?;
        Ok(OpRef { kind, prev })
    }
}

impl From<OpRef> for String {
    fn from(r: OpRef) -> String {
        let kind = serde_json::to_value(r.kind).expect("op kinds serialize to strings");
        let kind = kind.as_str().expect("op kinds serialize to strings");
        if r.prev {
            format!("{kind}@prev")
        } else {
            kind.to_owned()
        }
    }
}

/// The tiling model that computes a kernel's grid (design §4.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub enum Impl {
    InductorElementwise,
    CublasBf16,
    CutlassFp8Tensor,
    FlashinferSwapab,
    DeepgemmSm90,
    MarlinW8a16,
    Fa3,
    Fa3Combine,
    Fa3Prepare,
    VllmCacheWrite,
    Fp8ActQuant,
    VllmPrepareInputs,
    TorchIndex,
    Sampling,
}

/// Conditions that must all hold for a template to run. Absent fields
/// always hold (ADR 0011).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct When {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase: Option<Phase>,
    /// Any of these weight formats.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weights: Option<Vec<Weights>>,
    /// Rows of the model's activations: `M = B · T`, padded to the CUDA
    /// graph size (`Scenario::padded_tokens`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokens: Option<Bound>,
    /// The split count FA3's host code sees (see `FusionProfile::fuse`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attention_splits: Option<Bound>,
    /// Only in the per-layer list.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_layer: Option<bool>,
}

/// `ge ≤ x < lt`, with either end open.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Bound {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lt: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ge: Option<u64>,
}

impl Bound {
    fn holds(self, x: u64) -> bool {
        self.lt.is_none_or(|lt| x < lt) && self.ge.is_none_or(|ge| x >= ge)
    }
}

/// The facts a `When` is checked against.
struct Facts {
    phase: Phase,
    weights: Weights,
    tokens: u64,
    attention_splits: u64,
    first_layer: Option<bool>,
}

impl When {
    fn holds(&self, f: &Facts) -> bool {
        self.phase.is_none_or(|p| p == f.phase)
            && self.weights.as_ref().is_none_or(|w| w.contains(&f.weights))
            && self.tokens.is_none_or(|b| b.holds(f.tokens))
            && self
                .attention_splits
                .is_none_or(|b| b.holds(f.attention_splits))
            && self
                .first_layer
                .is_none_or(|first| Some(first) == f.first_layer)
    }
}

/// One kernel launch in a step.
#[derive(Debug, Clone, PartialEq)]
pub struct Kernel {
    pub name: String,
    pub imp: Impl,
    /// The logical ops it fuses. The first kernel of a layer also holds the
    /// residual add of the layer before.
    pub ops: Vec<OpId>,
    /// `None` before and after the layers.
    pub layer: Option<u32>,
    pub provenance: Provenance,
}

/// The kernels of one layer: `kernels[start..end]` of the step.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct LayerSpan {
    pub layer: u32,
    pub start: usize,
    pub end: usize,
}

/// The ops of a step and the kernels that run them.
#[derive(Debug, Clone, PartialEq)]
pub struct FusedStep {
    pub ops: Vec<Op>,
    pub kernels: Vec<Kernel>,
    pub layers: Vec<LayerSpan>,
}

/// Where a template list sits in the step.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Part {
    Prologue,
    Layer(u32),
    /// Holds the number of layers, so `@prev` is the last one.
    Epilogue(u32),
}

impl fmt::Display for Part {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Part::Prologue => write!(f, "prologue"),
            Part::Layer(i) => write!(f, "layer {i}"),
            Part::Epilogue(_) => write!(f, "epilogue"),
        }
    }
}

impl FusionProfile {
    /// The kernels vLLM launches for one step of `scenario`.
    ///
    /// `attention_splits` is the split count FA3's host code sees, which
    /// decides whether the `combine` kernel runs: `Fa3Schedule::host_splits`
    /// (`tiling::fa3`; design §4.3).
    pub fn fuse(
        &self,
        model: &ModelConfig,
        scenario: &Scenario,
        attention_splits: u32,
    ) -> Result<FusedStep, CoreError> {
        scenario.validate()?;
        let ops = step_ops(model, scenario);
        let known: HashSet<OpId> = ops.iter().map(|op| op.id).collect();
        let n_layers = model.config.num_hidden_layers as u32;
        let facts = |first_layer| Facts {
            phase: scenario.phase,
            weights: scenario.weights,
            tokens: scenario.padded_tokens(),
            attention_splits: u64::from(attention_splits),
            first_layer,
        };

        let mut kernels = Vec::new();
        self.emit(Part::Prologue, &facts(None), &known, &mut kernels)?;
        let mut layers = Vec::new();
        for layer in 0..n_layers {
            let start = kernels.len();
            let f = facts(Some(layer == 0));
            self.emit(Part::Layer(layer), &f, &known, &mut kernels)?;
            layers.push(LayerSpan {
                layer,
                start,
                end: kernels.len(),
            });
        }
        self.emit(Part::Epilogue(n_layers), &facts(None), &known, &mut kernels)?;

        check_coverage(&ops, &kernels)?;
        Ok(FusedStep {
            ops,
            kernels,
            layers,
        })
    }

    fn emit(
        &self,
        part: Part,
        facts: &Facts,
        known: &HashSet<OpId>,
        out: &mut Vec<Kernel>,
    ) -> Result<(), CoreError> {
        let templates = match part {
            Part::Prologue => &self.prologue,
            Part::Layer(_) => &self.layer,
            Part::Epilogue(_) => &self.epilogue,
        };
        for t in templates.iter().filter(|t| t.when.holds(facts)) {
            let ops = t
                .ops
                .iter()
                .map(|r| {
                    let id = resolve(*r, part);
                    known.contains(&id).then_some(id).ok_or_else(|| {
                        self.invalid(&format!(
                            "{} in the {part} fuses {:?}, which this scenario does not have",
                            t.name, r.kind
                        ))
                    })
                })
                .collect::<Result<_, _>>()?;
            let sources =
                t.sources
                    .iter()
                    .map(|k| {
                        self.sources.get(k).map(String::as_str).ok_or_else(|| {
                            self.invalid(&format!("{}: unknown source {k:?}", t.name))
                        })
                    })
                    .collect::<Result<Vec<_>, _>>()?;
            out.push(Kernel {
                name: t.name.clone(),
                imp: t.imp,
                ops,
                layer: match part {
                    Part::Layer(i) => Some(i),
                    _ => None,
                },
                provenance: Provenance::new(t.confidence, sources),
            });
        }
        Ok(())
    }

    /// Checks what serde cannot: source keys, and op references that make
    /// sense where they appear (ADR 0011).
    fn validate(&self) -> Result<(), CoreError> {
        let parts = [
            ("prologue", &self.prologue),
            ("layer", &self.layer),
            ("epilogue", &self.epilogue),
        ];
        let mut used = HashSet::new();
        for (part, templates) in parts {
            for t in templates {
                let at = |msg: &str| self.invalid(&format!("{part}: {}: {msg}", t.name));
                if t.ops.is_empty() {
                    return Err(at("fuses no ops"));
                }
                if t.sources.is_empty() {
                    return Err(at("has no source"));
                }
                if let Some(k) = t.sources.iter().find(|k| !self.sources.contains_key(*k)) {
                    return Err(at(&format!("unknown source {k:?}")));
                }
                used.extend(t.sources.iter().map(String::as_str));
                let bounds = [t.when.tokens, t.when.attention_splits];
                if bounds.iter().flatten().any(|b| *b == Bound::default()) {
                    return Err(at("empty bound"));
                }
                if part != "layer" && t.when.first_layer.is_some() {
                    return Err(at("firstLayer is only valid in the layer list"));
                }
                for r in &t.ops {
                    let ok = match (part, r.kind.in_layer(), r.prev) {
                        (_, false, prev) => !prev,
                        ("prologue", true, _) => false,
                        ("layer", true, prev) => !prev || t.when.first_layer == Some(false),
                        (_, true, prev) => prev,
                    };
                    if !ok {
                        return Err(at(&format!("op {:?} cannot appear here", String::from(*r))));
                    }
                }
            }
        }
        if let Some(k) = self.sources.keys().find(|k| !used.contains(k.as_str())) {
            return Err(self.invalid(&format!("source {k:?} is never cited")));
        }
        Ok(())
    }

    fn invalid(&self, msg: &str) -> CoreError {
        CoreError::InvalidData(format!("{}: {msg}", self.id))
    }
}

fn resolve(r: OpRef, part: Part) -> OpId {
    let current = match part {
        Part::Prologue => None,
        Part::Layer(i) | Part::Epilogue(i) => Some(i),
    };
    OpId {
        layer: if r.kind.in_layer() {
            // No layer before the first: the op is then not found.
            current.and_then(|i| i.checked_sub(u32::from(r.prev)))
        } else {
            None
        },
        kind: r.kind,
    }
}

/// Every op runs in some kernel, and only once, except for the two that
/// span several: the input bookkeeping and attention (main kernel plus
/// `combine`).
fn check_coverage(ops: &[Op], kernels: &[Kernel]) -> Result<(), CoreError> {
    let mut runs: HashMap<OpId, usize> = HashMap::new();
    for id in kernels.iter().flat_map(|k| &k.ops) {
        *runs.entry(*id).or_default() += 1;
    }
    for op in ops {
        let n = runs.get(&op.id).copied().unwrap_or(0);
        let spans = matches!(op.id.kind, OpKind::PrepareInputs | OpKind::Attention);
        if n == 0 || (n > 1 && !spans) {
            return Err(CoreError::InvalidData(format!(
                "fusion: {:?} runs in {n} kernels",
                op.id
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{KvDtype, model};

    /// vLLM's split cap under CUDA graphs: the host always sees 32.
    const GRAPH_SPLITS: u32 = 32;

    fn profile() -> FusionProfile {
        fusion_profile("vllm-0.31.0-h100").expect("the embedded profile is valid")
    }

    fn scenario(phase: Phase, batch: usize, weights: Weights) -> Scenario {
        let new_tokens = match phase {
            Phase::Decode => 1,
            Phase::Prefill => 512,
        };
        Scenario {
            phase,
            contexts: vec![8192; batch],
            new_tokens,
            weights,
            kv: KvDtype::Bf16,
        }
    }

    fn fuse(s: &Scenario, splits: u32) -> FusedStep {
        let m = model("qwen3-8b").expect("valid preset");
        profile().fuse(&m, s, splits).expect("fuses")
    }

    fn decode(batch: usize, weights: Weights) -> FusedStep {
        fuse(&scenario(Phase::Decode, batch, weights), GRAPH_SPLITS)
    }

    fn layer(step: &FusedStep, i: usize) -> &[Kernel] {
        let span = step.layers[i];
        &step.kernels[span.start..span.end]
    }

    fn impls(kernels: &[Kernel]) -> Vec<Impl> {
        kernels.iter().map(|k| k.imp).collect()
    }

    fn assert_kernels_per_layer(step: &FusedStep, n: usize) {
        assert_eq!(step.layers.len(), 36);
        for span in &step.layers {
            assert_eq!(span.end - span.start, n, "layer {}", span.layer);
        }
    }

    fn id(layer: u32, kind: OpKind) -> OpId {
        OpId {
            layer: Some(layer),
            kind,
        }
    }

    /// The kernel of `layer` that fuses `kind`.
    fn kernel_with(kernels: &[Kernel], layer: u32, kind: OpKind) -> &Kernel {
        kernels
            .iter()
            .find(|k| k.ops.contains(&id(layer, kind)))
            .unwrap_or_else(|| panic!("no kernel runs {kind:?}"))
    }

    use Impl::*;

    #[test]
    fn fusion_decode_bf16_has_11_kernels_per_layer() {
        let step = decode(1, Weights::Bf16);
        assert_kernels_per_layer(&step, 11);
        assert_eq!(
            impls(layer(&step, 1)),
            [
                InductorElementwise, // residual + RMSNorm
                CublasBf16,          // QKV
                InductorElementwise, // QK-norm + RoPE
                VllmCacheWrite,
                Fa3,
                Fa3Combine,
                CublasBf16,          // O
                InductorElementwise, // residual + RMSNorm
                CublasBf16,          // gate + up
                InductorElementwise, // SiLU·mul
                CublasBf16,          // down
            ]
        );
        let l1 = layer(&step, 1);
        assert_eq!(l1[2].ops, [id(1, OpKind::QkNorm), id(1, OpKind::Rope)]);
        assert_eq!(l1[5].ops, [id(1, OpKind::Attention)]);
    }

    #[test]
    fn fusion_decode_fp8_block_has_15_kernels_per_layer() {
        // M < 32: FlashInfer's swapAB kernel, quantizing in its own kernel.
        let small = decode(1, Weights::Fp8Block);
        assert_kernels_per_layer(&small, 15);
        let l = layer(&small, 1);
        assert_eq!(
            &impls(l)[..3],
            [InductorElementwise, Fp8ActQuant, FlashinferSwapab]
        );
        assert_eq!(l[1].name, "scale_1x128_kernel");
        assert_eq!(l[1].ops, [id(1, OpKind::QkvQuant)]);
        let gemms = |l: &[Kernel], imp| l.iter().filter(|k| k.imp == imp).count();
        assert_eq!((gemms(l, Fp8ActQuant), gemms(l, FlashinferSwapab)), (4, 4));

        // M ≥ 32: DeepGEMM, after vLLM's group-quant kernel.
        let large = decode(32, Weights::Fp8Block);
        assert_kernels_per_layer(&large, 15);
        let l = layer(&large, 1);
        assert_eq!(&impls(l)[1..3], [Fp8ActQuant, DeepgemmSm90]);
        assert_eq!(l[1].name, "per_token_group_quant_8bit_kernel");
        assert_eq!((gemms(l, Fp8ActQuant), gemms(l, DeepgemmSm90)), (4, 4));
    }

    #[test]
    fn graph_padding_sends_batch_25_through_deepgemm() {
        // 24 is a captured size; 25 replays the graph for 32, so M = 32.
        let l = |batch| impls(&layer(&decode(batch, Weights::Fp8Block), 1)[1..3]);
        assert_eq!(l(24), [Fp8ActQuant, FlashinferSwapab]);
        assert_eq!(l(25), [Fp8ActQuant, DeepgemmSm90]);
        let step = decode(25, Weights::Fp8Block);
        let qkv = step
            .ops
            .iter()
            .find(|op| op.id == id(1, OpKind::QkvProj))
            .expect("QKV in step");
        assert!(matches!(qkv.shape, crate::ops::Shape::Gemm { m: 32, .. }));
    }

    #[test]
    fn fusion_decode_fp8_tensor_fuses_quant_into_inductor_kernels() {
        let step = decode(1, Weights::Fp8Tensor);
        // Quantization joins the RMSNorm and SiLU·mul kernels; before O it
        // runs alone, after FA3.
        assert_kernels_per_layer(&step, 12);
        let l = layer(&step, 1);
        let k = |kind| kernel_with(l, 1, kind);
        assert_eq!(k(OpKind::QkvQuant), k(OpKind::InputNorm));
        assert_eq!(k(OpKind::GateUpQuant), k(OpKind::PostAttnNorm));
        assert_eq!(k(OpKind::DownQuant), k(OpKind::SiluMul));
        assert_eq!(k(OpKind::OQuant).ops, [id(1, OpKind::OQuant)]);
        assert_eq!(l.iter().filter(|k| k.imp == CutlassFp8Tensor).count(), 4);
        assert_eq!(
            k(OpKind::QkvQuant).provenance.confidence(),
            Confidence::Simplified
        );
    }

    #[test]
    fn fusion_decode_w8a16_swaps_only_the_gemms() {
        let step = decode(1, Weights::Fp8W8a16);
        assert_kernels_per_layer(&step, 11);
        let bf16 = decode(1, Weights::Bf16);
        let swap = |i: Impl| if i == CublasBf16 { MarlinW8a16 } else { i };
        let expected: Vec<Impl> = impls(layer(&bf16, 1)).into_iter().map(swap).collect();
        assert_eq!(impls(layer(&step, 1)), expected);
    }

    #[test]
    fn fusion_prefill_bf16_combine_only_with_splits() {
        let s = scenario(Phase::Prefill, 1, Weights::Bf16);
        let one = fuse(&s, 1);
        assert_kernels_per_layer(&one, 10);
        assert!(one.kernels.iter().all(|k| k.imp != Fa3Combine));
        let three = fuse(&s, 3);
        assert_kernels_per_layer(&three, 11);
    }

    #[test]
    fn fusion_layer_boundary_is_the_residual_rmsnorm_kernel() {
        let step = decode(1, Weights::Bf16);
        assert_eq!(
            layer(&step, 0)[0].ops,
            [
                OpId {
                    layer: None,
                    kind: OpKind::Embedding
                },
                id(0, OpKind::InputNorm)
            ]
        );
        for i in 1..36 {
            let first = &layer(&step, i as usize)[0];
            assert_eq!(first.name, "triton_red_fused_fused_add_rms_norm");
            assert_eq!(
                first.ops,
                [id(i - 1, OpKind::MlpResidual), id(i, OpKind::InputNorm)]
            );
            assert_eq!(first.layer, Some(i));
        }
        let after = &step.kernels[step.layers[35].end];
        assert_eq!(
            after.ops,
            [
                id(35, OpKind::MlpResidual),
                OpId {
                    layer: None,
                    kind: OpKind::FinalNorm
                }
            ]
        );
        assert_eq!(after.layer, None);
    }

    #[test]
    fn fusion_out_of_loop_kernels() {
        let step = decode(1, Weights::Bf16);
        let before = &step.kernels[..step.layers[0].start];
        // 7 input-preparation kernels and FA3's scheduler, once per step.
        assert_eq!(before.len(), 8);
        assert_eq!(before.iter().filter(|k| k.imp == Fa3Prepare).count(), 1);
        let after = &step.kernels[step.layers[35].end..];
        assert_eq!(
            impls(after),
            [InductorElementwise, TorchIndex, CublasBf16, Sampling]
        );
        // The LM head stays BF16 in every weight format.
        let fp8 = decode(1, Weights::Fp8Block);
        let head = |s: &FusedStep| s.kernels[s.kernels.len() - 2].imp;
        assert_eq!(head(&fp8), CublasBf16);

        let prefill = fuse(&scenario(Phase::Prefill, 1, Weights::Bf16), 1);
        assert_eq!(
            prefill.layers[0].start, 13,
            "prefill adds 5 bookkeeping kernels"
        );
    }

    #[test]
    fn fusion_covers_every_op_in_every_variant() {
        // `fuse` fails if a template overlaps another or an op is left out.
        let weights = [
            Weights::Bf16,
            Weights::Fp8Block,
            Weights::Fp8Tensor,
            Weights::Fp8W8a16,
        ];
        for w in weights {
            for batch in [1, 31, 32, 64] {
                for splits in [1, 2, GRAPH_SPLITS] {
                    for phase in [Phase::Decode, Phase::Prefill] {
                        let step = fuse(&scenario(phase, batch, w), splits);
                        for k in &step.kernels {
                            assert!(k.provenance.sources().next().is_some(), "{}", k.name);
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn fusion_rejects_an_invalid_scenario() {
        let m = model("qwen3-8b").expect("valid preset");
        let empty = Scenario {
            contexts: vec![],
            ..scenario(Phase::Decode, 1, Weights::Bf16)
        };
        assert!(matches!(
            profile().fuse(&m, &empty, 1),
            Err(CoreError::InvalidScenario(_))
        ));
    }

    #[test]
    fn fusion_unknown_id_is_an_error() {
        assert!(matches!(
            fusion_profile("tgi"),
            Err(CoreError::UnknownId { .. })
        ));
    }

    /// The embedded file with one edit applied to its JSON.
    fn edited(edit: impl FnOnce(&mut serde_json::Value)) -> String {
        let mut v: serde_json::Value = serde_json::from_str(VLLM_0_31_0_H100).expect("valid JSON");
        edit(&mut v);
        v.to_string()
    }

    fn rejects(src: &str, needle: &str) {
        match parse("test", src) {
            Err(CoreError::InvalidData(msg)) => assert!(msg.contains(needle), "{msg}"),
            other => panic!("expected InvalidData containing {needle:?}, got {other:?}"),
        }
    }

    #[test]
    fn fusion_loader_rejects_bad_data() {
        rejects(&edited(|v| v["colour"] = "red".into()), "unknown field");
        rejects(
            &edited(|v| v["layer"][0]["when"]["batch"] = 1.into()),
            "unknown field",
        );
        rejects(
            &edited(|v| v["layer"][0]["ops"][0] = "softmax".into()),
            "unknown op",
        );
        rejects(
            &edited(|v| v["layer"][0]["sources"] = serde_json::json!(["nope"])),
            "unknown source",
        );
        rejects(
            &edited(|v| v["layer"][0]["sources"] = serde_json::json!([])),
            "has no source",
        );
        rejects(
            &edited(|v| v["sources"]["unused"] = "x".into()),
            "never cited",
        );
        rejects(
            &edited(|v| v["prologue"][0]["ops"] = serde_json::json!(["input_norm"])),
            "cannot appear here",
        );
        rejects(
            &edited(|v| v["epilogue"][0]["ops"] = serde_json::json!(["mlp_residual"])),
            "cannot appear here",
        );
        rejects(
            &edited(|v| v["layer"][8]["ops"] = serde_json::json!(["qkv_proj@prev"])),
            "cannot appear here",
        );
        rejects(
            &edited(|v| v["layer"][8]["when"]["tokens"] = serde_json::json!({})),
            "empty bound",
        );
        rejects(
            &edited(|v| v["epilogue"][0]["when"]["firstLayer"] = true.into()),
            "only valid in the layer list",
        );
    }

    #[test]
    fn fusion_op_ref_round_trips() {
        for s in ["input_norm", "mlp_residual@prev"] {
            let r = OpRef::try_from(s.to_owned()).expect("parses");
            assert_eq!(String::from(r), s);
        }
    }
}
