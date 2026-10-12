//! `evaluate`: one scenario in, the step plan the UI renders out (design
//! §3.3; brief §6.6).
//!
//! The pipeline is FA3's schedule → fusion → roofline → launches →
//! realistic time, plus the memory budget. Every number leaves as a
//! `Quantity`, so it carries its confidence and sources (R6).

use serde::Serialize;

use crate::error::CoreError;
use crate::fusion::{Impl, LayerSpan, fusion_profile};
use crate::hardware::{self, TensorPrecision};
use crate::memory::{Memory, memory};
use crate::model::{self, SourceInfo};
use crate::ops::OpId;
use crate::quantity::{Confidence, Provenance, Quantity};
use crate::roofline::{KernelRoofline, Limit, Traffic, roofline};
use crate::scenario::Scenario;
use crate::tiling::{Launch, Sm, fa3::fa3, launch};
use crate::time::{KernelTime, realistic};
use crate::units::{Bytes, Count, Flops, Ratio, TokensPerSec};

/// Everything the UI shows about one step.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct StepPlan {
    /// In launch order.
    pub kernels: Vec<KernelPlan>,
    /// Which kernels belong to each layer. The first kernel of a layer also
    /// holds the residual add of the layer before (brief §6.5).
    pub layers: Vec<LayerSpan>,
    pub memory: Memory,
    pub totals: Totals,
    /// The roofline's ceilings.
    pub roofs: Roofs,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct KernelPlan {
    /// Unique in the plan: `k` and the launch index.
    pub id: String,
    /// The kernel's name as vLLM's profile shows it.
    pub name: String,
    #[serde(rename = "impl")]
    #[cfg_attr(feature = "ts", ts(rename = "impl"))]
    pub imp: Impl,
    /// The logical ops it fuses.
    pub ops: Vec<OpId>,
    /// `null` before and after the layers.
    pub layer: Option<u32>,
    /// Of the kernel and its ops: the fusion profile's template.
    pub provenance: SourceInfo,
    pub flops: Quantity,
    pub bytes: KernelBytes,
    /// HBM bytes by origin, for the flow animation.
    pub phase_breakdown: PhaseBreakdown,
    pub intensity: Quantity,
    /// Which roof limits the lower bound.
    pub bound: Limit,
    /// The tensor-core peak the kernel is held to.
    pub precision: TensorPrecision,
    pub time: KernelTimes,
    pub grid: Grid,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct KernelBytes {
    pub hbm_read: Quantity,
    pub hbm_write: Quantity,
    /// Read plus written by its ops run one by one. Above `hbmRead +
    /// hbmWrite` by the fusion saving; below it for FA3's `combine`.
    pub unfused: Quantity,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct PhaseBreakdown {
    pub read: TrafficPlan,
    pub write: TrafficPlan,
}

/// HBM bytes by class.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct TrafficPlan {
    /// Weights, norm weights, embedding rows and their scales.
    pub weights: Quantity,
    pub kv: Quantity,
    pub activations: Quantity,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct KernelTimes {
    /// `max(FLOPs / peak, bytes / bandwidth)`.
    pub lower_bound: Quantity,
    /// Corrected by efficiencies, active SMs and the launch overhead.
    pub realistic: Quantity,
    /// Which roof limits the realistic time; few active SMs can flip it.
    pub realistic_bound: Limit,
}

/// The kernel's grid and how it spreads over the SMs (design §4.3).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct Grid {
    /// Work tiles; for a non-persistent grid, one per CTA.
    pub blocks: Quantity,
    /// The output tile of one CTA, `m × n × k` of its main MMA.
    pub tile: [u32; 3],
    /// The most splits any request gets (FA3), or 1.
    pub splits: Quantity,
    /// CTAs resident at once.
    pub slots: Quantity,
    /// Rounds of `slots` tiles.
    pub waves: Quantity,
    /// `blocks / (waves · slots)`: how full the rounds are.
    pub wave_efficiency: Quantity,
    /// Tiles in each round; the 3D maps them to SMs in index order.
    pub per_wave: Vec<u32>,
    pub persistent: bool,
    /// SMs with at least one CTA.
    pub active_sms: Quantity,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct Totals {
    pub flops: Quantity,
    pub hbm_read: Quantity,
    pub hbm_write: Quantity,
    /// Kernels run one after another: each time is the sum over kernels.
    pub time: StepTimes,
    /// The step's real tokens over each time.
    pub tokens_per_second: StepThroughput,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct StepTimes {
    pub lower_bound: Quantity,
    pub realistic: Quantity,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct StepThroughput {
    pub lower_bound: Quantity,
    pub realistic: Quantity,
}

/// Peaks derived from the hardware tree.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct Roofs {
    pub bf16_peak: Quantity,
    pub fp8_peak: Quantity,
    pub hbm_bandwidth: Quantity,
}

/// The fusion profile that describes how vLLM runs on this hardware.
fn profile_for(hw: &str) -> Result<&'static str, CoreError> {
    match hw {
        "h100-sxm" => Ok("vllm-0.31.0-h100"),
        _ => Err(CoreError::UnknownId {
            kind: "hardware",
            id: hw.to_owned(),
        }),
    }
}

/// The plan of one step of `scenario` for the model `model_id` on the
/// hardware `hw_id`. A batch that does not fit in HBM is not an error: the
/// plan says so in `memory.overflow`.
pub fn evaluate(hw_id: &str, model_id: &str, scenario: &Scenario) -> Result<StepPlan, CoreError> {
    scenario.validate()?;
    let hw = hardware::hardware(hw_id)?;
    let cal = hardware::calibration(hw_id)?;
    let model = model::model(model_id)?;
    let profile = fusion_profile(profile_for(hw_id)?)?;
    let sm = Sm::new(&hw)?;

    let schedule = fa3(&model, scenario, &hw)?;
    let step = profile.fuse(&model, scenario, schedule.host_splits)?;
    let roof = roofline(&step, &model, scenario, &hw, &schedule.splits)?;
    let launches = step
        .kernels
        .iter()
        .map(|k| launch(k, &step, scenario, &schedule, &sm))
        .collect::<Result<Vec<_>, _>>()?;
    let time = realistic(&step, &roof, &launches, scenario, &hw, &sm, &cal)?;

    let kernels = step
        .kernels
        .iter()
        .zip(&roof.kernels)
        .zip(&launches)
        .zip(&time.kernels)
        .enumerate()
        .map(|(i, (((kernel, r), l), t))| KernelPlan {
            id: format!("k{i}"),
            name: kernel.name.clone(),
            imp: kernel.imp,
            ops: kernel.ops.clone(),
            layer: kernel.layer,
            provenance: SourceInfo::from(&kernel.provenance),
            flops: Quantity::new(r.cost.flops, r.provenance.clone()),
            bytes: KernelBytes {
                hbm_read: Quantity::new(r.cost.read.total(), r.provenance.clone()),
                hbm_write: Quantity::new(r.cost.write.total(), r.provenance.clone()),
                unfused: Quantity::new(r.unfused.bytes(), r.provenance.clone()),
            },
            phase_breakdown: PhaseBreakdown {
                read: traffic(&r.cost.read, &r.provenance),
                write: traffic(&r.cost.write, &r.provenance),
            },
            intensity: Quantity::new(r.cost.intensity(), r.provenance.clone()),
            bound: r.limit,
            precision: r.precision,
            time: kernel_times(r, t),
            grid: grid(l, t),
        })
        .collect();

    let cost_prov = join(roof.kernels.iter().map(|k| &k.provenance));
    let all = roof.traffic();
    let read: Bytes = roof.kernels.iter().map(|k| k.cost.read.total()).sum();
    let flops: Flops = roof.kernels.iter().map(|k| k.cost.flops).sum();
    let (lower, lower_prov) = (roof.lower_bound(), roof.provenance());
    let (real, real_prov) = (time.realistic(), time.provenance());
    let tokens = scenario.tokens() as f64;
    let totals = Totals {
        flops: Quantity::new(flops, cost_prov.clone()),
        hbm_read: Quantity::new(read, cost_prov.clone()),
        hbm_write: Quantity::new(all.total() - read, cost_prov),
        time: StepTimes {
            lower_bound: Quantity::new(lower, lower_prov.clone()),
            realistic: Quantity::new(real, real_prov.clone()),
        },
        tokens_per_second: StepThroughput {
            lower_bound: Quantity::new(TokensPerSec(tokens / lower.0), lower_prov),
            realistic: Quantity::new(TokensPerSec(tokens / real.0), real_prov),
        },
    };

    let (bf16, bf16_prov) = hw.peak_tensor(TensorPrecision::Bf16)?;
    let (fp8, fp8_prov) = hw.peak_tensor(TensorPrecision::Fp8)?;
    let (bw, bw_prov) = hw.hbm_bandwidth()?;
    Ok(StepPlan {
        kernels,
        layers: step.layers,
        memory: memory(&model, scenario, &hw, &cal)?,
        totals,
        roofs: Roofs {
            bf16_peak: Quantity::new(bf16, bf16_prov),
            fp8_peak: Quantity::new(fp8, fp8_prov),
            hbm_bandwidth: Quantity::new(bw, bw_prov),
        },
    })
}

fn traffic(t: &Traffic, prov: &Provenance) -> TrafficPlan {
    TrafficPlan {
        weights: Quantity::new(t.weights, prov.clone()),
        kv: Quantity::new(t.kv, prov.clone()),
        activations: Quantity::new(t.activations, prov.clone()),
    }
}

fn kernel_times(r: &KernelRoofline, t: &KernelTime) -> KernelTimes {
    KernelTimes {
        lower_bound: Quantity::new(r.lower_bound, r.time_provenance.clone()),
        realistic: Quantity::new(t.realistic, t.provenance.clone()),
        realistic_bound: t.limit,
    }
}

fn grid(l: &Launch, t: &KernelTime) -> Grid {
    let p = &l.provenance;
    let waves = l.per_wave.len() as u64;
    let capacity = waves * l.slots;
    let efficiency = if capacity > 0 {
        l.blocks as f64 / capacity as f64
    } else {
        0.0
    };
    Grid {
        blocks: Quantity::new(Count(l.blocks), p.clone()),
        tile: [l.tile.m, l.tile.n, l.tile.k],
        splits: Quantity::new(Count(u64::from(l.splits)), p.clone()),
        slots: Quantity::new(Count(l.slots), p.clone()),
        waves: Quantity::new(Count(waves), p.clone()),
        wave_efficiency: Quantity::new(Ratio(efficiency), p.clone()),
        per_wave: l.per_wave.clone(),
        persistent: l.persistent,
        active_sms: Quantity::new(Count(t.active_sms), p.clone()),
    }
}

fn join<'a>(provs: impl Iterator<Item = &'a Provenance>) -> Provenance {
    provs.fold(Provenance::new(Confidence::Documented, [""; 0]), |a, b| {
        a.join(b)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::KvDtype;
    use crate::scenario::{Phase, Weights};
    use crate::units::Seconds;

    fn decode(batch: usize, context: u32) -> Scenario {
        Scenario {
            phase: Phase::Decode,
            contexts: vec![context; batch],
            new_tokens: 1,
            weights: Weights::Bf16,
            kv: KvDtype::Bf16,
        }
    }

    fn seconds(q: &Quantity) -> Seconds {
        q.get::<Seconds>().expect("a time")
    }

    fn plan(scenario: &Scenario) -> StepPlan {
        evaluate("h100-sxm", "qwen3-8b", scenario).expect("evaluates")
    }

    /// Every object with a `confidence` in the serialized value, with its
    /// JSON path.
    fn confidences<'a>(
        v: &'a serde_json::Value,
        path: String,
        out: &mut Vec<(String, &'a serde_json::Value)>,
    ) {
        match v {
            serde_json::Value::Object(map) => {
                if map.contains_key("confidence") {
                    out.push((path.clone(), v));
                }
                for (k, child) in map {
                    confidences(child, format!("{path}.{k}"), out);
                }
            }
            serde_json::Value::Array(items) => {
                for (i, child) in items.iter().enumerate() {
                    confidences(child, format!("{path}[{i}]"), out);
                }
            }
            _ => {}
        }
    }

    #[test]
    fn evaluate_every_documented_value_has_a_source() {
        let scenarios = [
            decode(1, 8192),
            decode(64, 131_072),
            Scenario {
                weights: Weights::Fp8Block,
                kv: KvDtype::Fp8,
                ..decode(25, 4096)
            },
            Scenario {
                phase: Phase::Prefill,
                contexts: vec![2048; 2],
                new_tokens: 2048,
                weights: Weights::Fp8Tensor,
                kv: KvDtype::Bf16,
            },
            Scenario {
                weights: Weights::Fp8W8a16,
                ..decode(3, 350)
            },
        ];
        for s in &scenarios {
            let json = serde_json::to_value(plan(s)).expect("serializes");
            let mut found = Vec::new();
            confidences(&json, String::new(), &mut found);
            assert!(found.len() > 1000, "{}", found.len());
            for (path, v) in found {
                let sources = v["sources"].as_array().expect("sources array");
                if v["confidence"] == "documented" {
                    assert!(!sources.is_empty(), "{path} is documented with no source");
                }
                assert!(
                    sources
                        .iter()
                        .all(|s| s.as_str().is_some_and(|s| !s.is_empty())),
                    "{path} has an empty source"
                );
            }
        }
    }

    #[test]
    fn evaluate_128k_overflows_at_batch_64_not_at_1() {
        assert!(!plan(&decode(1, 131_072)).memory.overflow);
        assert!(plan(&decode(64, 131_072)).memory.overflow);
    }

    #[test]
    fn evaluate_assembles_the_whole_step() {
        let p = plan(&decode(1, 8192));
        assert_eq!(p.layers.len(), 36);
        // 11 kernels per layer in decode BF16, plus the ones around them.
        let in_layers: usize = p.layers.iter().map(|l| l.end - l.start).sum();
        assert_eq!(in_layers, 36 * 11);
        let outside: Vec<&str> = p
            .kernels
            .iter()
            .filter(|k| k.layer.is_none())
            .map(|k| k.name.as_str())
            .collect();
        assert_eq!(outside.len(), p.kernels.len() - in_layers);
        assert!(
            p.kernels
                .iter()
                .any(|k| k.imp == Impl::Fa3Prepare && k.layer.is_none())
        );
        assert!(p.kernels.iter().any(|k| k.imp == Impl::Sampling));
        let ids: std::collections::HashSet<&str> =
            p.kernels.iter().map(|k| k.id.as_str()).collect();
        assert_eq!(ids.len(), p.kernels.len());

        // FA3 at batch 1 fits in one round of its persistent grid.
        let attention = p
            .kernels
            .iter()
            .find(|k| k.imp == Impl::Fa3)
            .expect("attention");
        assert_eq!(attention.grid.per_wave.len(), 1);
        let blocks = attention.grid.blocks.get::<Count>().expect("count");
        assert_eq!(u64::from(attention.grid.per_wave[0]), blocks.0);
        assert_eq!(attention.precision, TensorPrecision::Bf16);

        // Totals are the kernels' sums.
        let lower: Seconds = p.kernels.iter().map(|k| seconds(&k.time.lower_bound)).sum();
        assert!((seconds(&p.totals.time.lower_bound).0 / lower.0 - 1.0).abs() < 1e-12);
        let real: Seconds = p.kernels.iter().map(|k| seconds(&k.time.realistic)).sum();
        assert!((seconds(&p.totals.time.realistic).0 / real.0 - 1.0).abs() < 1e-12);
        assert!(real > lower);
        // Batch 1: tokens per second is one over the step time.
        let tps = p.totals.tokens_per_second.realistic.value();
        assert!((tps * real.0 - 1.0).abs() < 1e-9);
        assert_eq!(p.roofs.bf16_peak.unit(), crate::quantity::Unit::FlopsPerSec);
    }

    #[test]
    fn evaluate_serializes_to_the_wire_shape() {
        let json = serde_json::to_value(plan(&decode(1, 350))).expect("serializes");
        let k = &json["kernels"][0];
        for key in [
            "id",
            "name",
            "impl",
            "ops",
            "layer",
            "provenance",
            "flops",
            "bytes",
            "phaseBreakdown",
            "intensity",
            "bound",
            "precision",
            "time",
            "grid",
        ] {
            assert!(k.get(key).is_some(), "kernel has no {key}");
        }
        assert!(k["layer"].is_null());
        assert_eq!(json["kernels"][0]["id"], "k0");
        let qkv = json["kernels"]
            .as_array()
            .expect("array")
            .iter()
            .find(|k| {
                k["ops"]
                    .as_array()
                    .expect("ops")
                    .iter()
                    .any(|o| o["kind"] == "qkv_proj")
            })
            .expect("a QKV GEMM");
        assert_eq!(qkv["ops"][0]["layer"], 0);
        assert_eq!(qkv["bound"], "memory");
        assert_eq!(qkv["grid"]["perWave"].as_array().map(Vec::len), Some(1));
        assert!(json["memory"]["maxBatch"]["value"].is_number());
        assert_eq!(json["memory"]["overflow"], false);
        assert_eq!(json["layers"][0]["layer"], 0);
        assert_eq!(
            json["totals"]["tokensPerSecond"]["realistic"]["unit"],
            "tok/s"
        );
    }

    #[test]
    fn evaluate_rejects_unknown_ids_and_bad_scenarios() {
        assert!(matches!(
            evaluate("a100", "qwen3-8b", &decode(1, 1)),
            Err(CoreError::UnknownId {
                kind: "hardware",
                ..
            })
        ));
        assert!(matches!(
            evaluate("h100-sxm", "llama", &decode(1, 1)),
            Err(CoreError::UnknownId { kind: "model", .. })
        ));
        assert!(matches!(
            evaluate("h100-sxm", "qwen3-8b", &decode(0, 1)),
            Err(CoreError::InvalidScenario(_))
        ));
    }

    #[test]
    fn evaluate_scenario_reads_the_wire_shape() {
        let s: Scenario = serde_json::from_value(serde_json::json!({
            "phase": "decode",
            "contexts": [8192],
            "newTokens": 1,
            "weights": "fp8_block",
            "kv": "fp8",
        }))
        .expect("deserializes");
        assert_eq!(s.weights, Weights::Fp8Block);
        assert_eq!(s.kv, KvDtype::Fp8);
        let extra = serde_json::json!({
            "phase": "decode", "contexts": [1], "newTokens": 1,
            "weights": "bf16", "kv": "bf16", "timeMode": "realistic",
        });
        assert!(serde_json::from_value::<Scenario>(extra).is_err());
    }
}
