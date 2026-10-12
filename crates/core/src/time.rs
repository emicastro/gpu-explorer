//! Realistic time of each kernel: the lower bound corrected by efficiencies
//! and a fixed cost per kernel (design §4.4; brief §7.1).
//!
//! ```text
//! bw_ef      = BW · η_m · min(1, active SMs / SMs to saturate HBM)
//! compute_ef = peak · η_c(FLOPs) · min(1, active SMs / SMs)
//! t_real     = max(FLOPs / compute_ef, bytes / bw_ef) + t_overhead
//! ```
//!
//! Every parameter lives in the `calibration` block of the hardware file
//! (ADR 0014), and every one is `estimated`.

use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::hardware::HwNode;
use crate::quantity::{Confidence, Provenance, Quantity};
use crate::roofline::{Limit, StepRoofline};
use crate::scenario::{Phase, Scenario};
use crate::tiling::fa3::GRAPH_MAX_TOKENS;
use crate::tiling::{Launch, Sm};
use crate::units::{Count, Flops, Ratio, Seconds};

/// The parameters of the realistic time for one GPU and software stack.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Calibration {
    /// `η_m`: the fraction of the HBM peak a saturating kernel reaches.
    pub memory_efficiency: Quantity,
    /// Active SMs from which a kernel reaches `η_m`; fewer get a
    /// proportional share.
    pub sms_to_saturate_hbm: Quantity,
    /// `η_c` against a kernel's FLOPs, interpolated in log FLOPs and
    /// clamped at both ends. FLOPs strictly increase.
    pub compute_efficiency: Vec<CurvePoint>,
    /// Fixed cost of each kernel in a step replayed from a CUDA graph.
    pub kernel_overhead_graphs: Quantity,
    /// Fixed cost of each kernel launched one by one from the host.
    pub kernel_overhead_eager: Quantity,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurvePoint {
    pub flops: Quantity,
    pub efficiency: Quantity,
}

impl Calibration {
    pub fn memory_efficiency(&self) -> Result<(Ratio, Provenance), CoreError> {
        fraction("memoryEfficiency", &self.memory_efficiency)
    }

    pub fn sms_to_saturate_hbm(&self) -> Result<(Count, Provenance), CoreError> {
        let q = &self.sms_to_saturate_hbm;
        match q.get::<Count>() {
            Some(n) if n.0 > 0 => Ok((n, q.provenance())),
            _ => Err(invalid(format!(
                "smsToSaturateHbm must be a positive count, got {} {:?}",
                q.value(),
                q.unit()
            ))),
        }
    }

    /// `η_c` for a kernel of `flops`.
    pub fn compute_efficiency(&self, flops: Flops) -> Result<(Ratio, Provenance), CoreError> {
        let points = self
            .compute_efficiency
            .iter()
            .map(|p| {
                let x = p
                    .flops
                    .get::<Flops>()
                    .filter(|f| f.0 > 0.0)
                    .ok_or_else(|| {
                        invalid(format!(
                            "computeEfficiency point at {} {:?} is not a positive FLOP count",
                            p.flops.value(),
                            p.flops.unit()
                        ))
                    })?;
                let (y, prov) = fraction("computeEfficiency", &p.efficiency)?;
                Ok((x.0.log10(), y.0, prov.join(&p.flops.provenance())))
            })
            .collect::<Result<Vec<_>, CoreError>>()?;
        let (first, last) = match (points.first(), points.last()) {
            (Some(f), Some(l)) => (f, l),
            _ => return Err(invalid("computeEfficiency has no points".to_owned())),
        };
        if points.windows(2).any(|w| w[1].0 <= w[0].0) {
            return Err(invalid(
                "computeEfficiency FLOPs must strictly increase".to_owned(),
            ));
        }
        let prov = points
            .iter()
            .fold(first.2.clone(), |acc, (_, _, p)| acc.join(p));
        let x = if flops.0 > 0.0 {
            flops.0.log10()
        } else {
            f64::NEG_INFINITY
        };
        let eta = if x <= first.0 {
            first.1
        } else if x >= last.0 {
            last.1
        } else {
            let i = points.partition_point(|p| p.0 <= x);
            let (a, b) = (&points[i - 1], &points[i]);
            a.1 + (b.1 - a.1) * (x - a.0) / (b.0 - a.0)
        };
        Ok((Ratio(eta), prov))
    }

    /// The fixed cost of one kernel, with or without CUDA graphs.
    pub fn kernel_overhead(&self, graphs: bool) -> Result<(Seconds, Provenance), CoreError> {
        let (key, q) = if graphs {
            ("kernelOverheadGraphs", &self.kernel_overhead_graphs)
        } else {
            ("kernelOverheadEager", &self.kernel_overhead_eager)
        };
        match q.get::<Seconds>() {
            Some(t) if t.0 >= 0.0 => Ok((t, q.provenance())),
            _ => Err(invalid(format!(
                "{key} must be a non-negative time, got {} {:?}",
                q.value(),
                q.unit()
            ))),
        }
    }

    /// Every value has the right unit and range and a source.
    pub(crate) fn validate(&self) -> Result<(), CoreError> {
        self.memory_efficiency()?;
        self.sms_to_saturate_hbm()?;
        self.compute_efficiency(Flops(1.0))?;
        self.kernel_overhead(true)?;
        self.kernel_overhead(false)?;
        let mut values = vec![
            ("memoryEfficiency", &self.memory_efficiency),
            ("smsToSaturateHbm", &self.sms_to_saturate_hbm),
            ("kernelOverheadGraphs", &self.kernel_overhead_graphs),
            ("kernelOverheadEager", &self.kernel_overhead_eager),
        ];
        for p in &self.compute_efficiency {
            values.push(("computeEfficiency", &p.flops));
            values.push(("computeEfficiency", &p.efficiency));
        }
        match values.iter().find(|(_, q)| q.sources().is_empty()) {
            Some((key, _)) => Err(invalid(format!("{key} has no source"))),
            None => Ok(()),
        }
    }
}

/// A ratio in `(0, 1]`.
fn fraction(key: &str, q: &Quantity) -> Result<(Ratio, Provenance), CoreError> {
    match q.get::<Ratio>() {
        Some(r) if r.0 > 0.0 && r.0 <= 1.0 => Ok((r, q.provenance())),
        _ => Err(invalid(format!(
            "{key} must be a ratio in (0, 1], got {} {:?}",
            q.value(),
            q.unit()
        ))),
    }
}

fn invalid(msg: String) -> CoreError {
    CoreError::InvalidData(format!("calibration: {msg}"))
}

/// Whether vLLM replays the step from a CUDA graph: a decode step of up to
/// 512 tokens (design §4.1).
pub fn cuda_graphs(scenario: &Scenario) -> bool {
    scenario.phase == Phase::Decode && scenario.tokens() <= GRAPH_MAX_TOKENS
}

#[derive(Debug, Clone, PartialEq)]
pub struct KernelTime {
    /// `t_real`.
    pub realistic: Seconds,
    /// SMs with at least one CTA: the grid, up to one per SM.
    pub active_sms: u64,
    /// Which roof limits the corrected time; it can differ from the lower
    /// bound's when few SMs throttle one side.
    pub limit: Limit,
    pub provenance: Provenance,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StepTime {
    /// One per kernel of the step, in the same order.
    pub kernels: Vec<KernelTime>,
}

impl StepTime {
    /// Kernels run one after another, so the step takes their sum.
    pub fn realistic(&self) -> Seconds {
        self.kernels.iter().map(|k| k.realistic).sum()
    }

    pub fn provenance(&self) -> Provenance {
        self.kernels
            .iter()
            .map(|k| &k.provenance)
            .fold(Provenance::new(Confidence::Documented, [""; 0]), |a, b| {
                a.join(b)
            })
    }
}

/// The realistic time of every kernel of a step, from its roofline and its
/// launches (both in the step's kernel order).
pub fn realistic(
    roofline: &StepRoofline,
    launches: &[Launch],
    scenario: &Scenario,
    hw: &HwNode,
    sm: &Sm,
    cal: &Calibration,
) -> Result<StepTime, CoreError> {
    if launches.len() != roofline.kernels.len() {
        return Err(CoreError::InvalidData(format!(
            "realistic: {} launches for {} kernels",
            launches.len(),
            roofline.kernels.len()
        )));
    }
    let (bw, bw_prov) = hw.hbm_bandwidth()?;
    let (eta_m, eta_m_prov) = cal.memory_efficiency()?;
    let (saturate, saturate_prov) = cal.sms_to_saturate_hbm()?;
    let (overhead, overhead_prov) = cal.kernel_overhead(cuda_graphs(scenario))?;
    let mut kernels = Vec::with_capacity(launches.len());
    for (k, launch) in roofline.kernels.iter().zip(launches) {
        // A grid with no work still occupies a launch; give it one SM so
        // the shares below stay finite.
        let active = launch.blocks.min(sm.count).max(1);
        let (peak, peak_prov) = hw.peak_tensor(k.precision)?;
        let (eta_c, eta_c_prov) = cal.compute_efficiency(k.cost.flops)?;
        let memory_share = (active as f64 / saturate.as_f64()).min(1.0);
        let compute_share = (active as f64 / sm.count as f64).min(1.0);
        let t_compute = k.cost.flops / (peak * (eta_c.0 * compute_share));
        let t_memory = k.cost.bytes() / (bw * (eta_m.0 * memory_share));
        let (limit, t) = if t_compute > t_memory {
            (Limit::Compute, t_compute)
        } else {
            (Limit::Memory, t_memory)
        };
        let side = match limit {
            Limit::Compute => peak_prov.join(&eta_c_prov),
            Limit::Memory => bw_prov.join(&eta_m_prov).join(&saturate_prov),
        };
        kernels.push(KernelTime {
            realistic: t + overhead,
            active_sms: active,
            limit,
            provenance: k
                .provenance
                .join(&launch.provenance)
                .join(&side)
                .join(&overhead_prov),
        });
    }
    Ok(StepTime { kernels })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fusion::{FusedStep, Impl, fusion_profile};
    use crate::hardware::{calibration, hardware};
    use crate::model::{KvDtype, model};
    use crate::roofline::roofline;
    use crate::scenario::Weights;
    use crate::tiling::{fa3, launch};

    struct Run {
        step: FusedStep,
        roofline: StepRoofline,
        launches: Vec<Launch>,
        time: StepTime,
    }

    fn run(scenario: &Scenario) -> Run {
        let hw = hardware("h100-sxm").expect("valid preset");
        let cal = calibration("h100-sxm").expect("valid preset");
        let qwen = model("qwen3-8b").expect("valid preset");
        let sm = Sm::new(&hw).expect("sm limits");
        let schedule = fa3::fa3(&qwen, scenario, &hw).expect("schedules");
        let step = fusion_profile("vllm-0.31.0-h100")
            .expect("valid profile")
            .fuse(&qwen, scenario, schedule.host_splits)
            .expect("fuses");
        let roofline = roofline(&step, &qwen, scenario, &hw, &schedule.splits).expect("roofline");
        let launches: Vec<Launch> = step
            .kernels
            .iter()
            .map(|k| launch(k, &step, scenario, &schedule, &sm).expect("launches"))
            .collect();
        let time = realistic(&roofline, &launches, scenario, &hw, &sm, &cal).expect("times");
        Run {
            step,
            roofline,
            launches,
            time,
        }
    }

    fn scenario(phase: Phase, batch: usize, context: u32, new_tokens: u32) -> Scenario {
        Scenario {
            phase,
            contexts: vec![context; batch],
            new_tokens,
            weights: Weights::Bf16,
            kv: KvDtype::Bf16,
        }
    }

    /// GPUStack, "Optimizing Qwen3-8B Latency on NVIDIA H100 GPUs": vLLM
    /// v0.11.0, BF16, ShareGPT at concurrency 1, mean TPOT 7.28 ms (brief
    /// §8). ShareGPT's mean of ~233 input and ~221 output tokens puts the
    /// average decode step near a context of 350 (requirements R4).
    #[test]
    fn calibration_decode_8b_bf16_batch_1_matches_gpustack() {
        const TPOT: f64 = 7.28e-3;
        let r = run(&scenario(Phase::Decode, 1, 350, 1));
        let t = r.time.realistic().0;
        assert!(
            (t / TPOT - 1.0).abs() <= 0.15,
            "realistic {:.3} ms",
            t * 1e3
        );
        let bound = r.roofline.lower_bound().0;
        assert!(bound < TPOT, "lower bound {:.3} ms", bound * 1e3);
        assert_eq!(r.time.provenance().confidence(), Confidence::Estimated);
    }

    #[test]
    fn calibration_values_are_estimated_and_sourced() {
        let cal = calibration("h100-sxm").expect("valid preset");
        let mut values = vec![
            &cal.memory_efficiency,
            &cal.sms_to_saturate_hbm,
            &cal.kernel_overhead_graphs,
            &cal.kernel_overhead_eager,
        ];
        assert!(!cal.compute_efficiency.is_empty());
        values.extend(cal.compute_efficiency.iter().map(|p| &p.efficiency));
        for q in values {
            assert_eq!(q.confidence(), Confidence::Estimated, "{q:?}");
            assert!(!q.sources().is_empty(), "{q:?}");
        }
        let (eta_m, _) = cal.memory_efficiency().expect("valid");
        assert_eq!(eta_m, Ratio(0.93));
        let (graphs, _) = cal.kernel_overhead(true).expect("valid");
        let (eager, _) = cal.kernel_overhead(false).expect("valid");
        assert!(graphs < eager, "{graphs:?} vs {eager:?}");
    }

    #[test]
    fn calibration_compute_efficiency_interpolates_in_log_flops() {
        let cal = calibration("h100-sxm").expect("valid preset");
        let eta = |f: f64| cal.compute_efficiency(Flops(f)).expect("valid").0.0;
        let points: Vec<(f64, f64)> = cal
            .compute_efficiency
            .iter()
            .map(|p| (p.flops.value(), p.efficiency.value()))
            .collect();
        let (first, last) = (points[0], points[points.len() - 1]);
        // Clamped at both ends.
        assert_eq!(eta(first.0 / 10.0), first.1);
        assert_eq!(eta(0.0), first.1);
        assert_eq!(eta(last.0 * 10.0), last.1);
        // Exact at a point, and halfway in log between two points.
        for w in points.windows(2) {
            let ((x0, y0), (x1, y1)) = (w[0], w[1]);
            assert!((eta(x0) - y0).abs() < 1e-12);
            let mid = eta((x0 * x1).sqrt());
            assert!((mid - (y0 + y1) / 2.0).abs() < 1e-9, "{mid}");
        }
    }

    #[test]
    fn calibration_rejects_bad_values() {
        let good = calibration("h100-sxm").expect("valid preset");
        let q = |v: f64, unit: &str| -> Quantity {
            serde_json::from_value(serde_json::json!({
                "value": v, "unit": unit, "confidence": "estimated", "sources": ["s"]
            }))
            .expect("parses")
        };
        let cases: Vec<(Calibration, &str)> = vec![
            (
                Calibration {
                    memory_efficiency: q(1.2, "1"),
                    ..good.clone()
                },
                "memoryEfficiency",
            ),
            (
                Calibration {
                    memory_efficiency: q(0.9, "B/s"),
                    ..good.clone()
                },
                "memoryEfficiency",
            ),
            (
                Calibration {
                    sms_to_saturate_hbm: q(0.0, "count"),
                    ..good.clone()
                },
                "smsToSaturateHbm",
            ),
            (
                Calibration {
                    kernel_overhead_eager: q(-1e-6, "s"),
                    ..good.clone()
                },
                "kernelOverheadEager",
            ),
            (
                Calibration {
                    compute_efficiency: vec![],
                    ..good.clone()
                },
                "no points",
            ),
            (
                Calibration {
                    compute_efficiency: vec![
                        CurvePoint {
                            flops: q(1e12, "FLOP"),
                            efficiency: q(0.7, "1"),
                        },
                        CurvePoint {
                            flops: q(1e11, "FLOP"),
                            efficiency: q(0.5, "1"),
                        },
                    ],
                    ..good.clone()
                },
                "strictly increase",
            ),
            (
                Calibration {
                    kernel_overhead_graphs: serde_json::from_value(serde_json::json!({
                        "value": 1e-6, "unit": "s", "confidence": "estimated", "sources": []
                    }))
                    .expect("parses"),
                    ..good.clone()
                },
                "no source",
            ),
        ];
        for (cal, needle) in cases {
            match cal.validate() {
                Err(CoreError::InvalidData(msg)) => assert!(msg.contains(needle), "{msg}"),
                other => panic!("expected an error with {needle:?}, got {other:?}"),
            }
        }
    }

    /// Every kernel of every scenario takes at least its lower bound: the
    /// efficiencies only slow it down and the overhead only adds.
    #[test]
    fn calibration_realistic_is_never_below_the_bound() {
        for (phase, batch, context, new_tokens) in [
            (Phase::Decode, 1, 350, 1),
            (Phase::Decode, 64, 8192, 1),
            (Phase::Decode, 1024, 2048, 1),
            (Phase::Prefill, 1, 4096, 4096),
            (Phase::Prefill, 4, 512, 256),
        ] {
            for weights in [
                Weights::Bf16,
                Weights::Fp8Block,
                Weights::Fp8Tensor,
                Weights::Fp8W8a16,
            ] {
                let s = Scenario {
                    weights,
                    ..scenario(phase, batch, context, new_tokens)
                };
                let r = run(&s);
                for (i, (t, b)) in r.time.kernels.iter().zip(&r.roofline.kernels).enumerate() {
                    assert!(
                        t.realistic >= b.lower_bound,
                        "{s:?}: {} realistic {:?} < bound {:?}",
                        r.step.kernels[i].name,
                        t.realistic,
                        b.lower_bound
                    );
                    assert_eq!(t.provenance.confidence(), Confidence::Estimated);
                }
            }
        }
    }

    /// Below the saturation point, a memory-bound kernel gets a share of
    /// `η_m · BW` proportional to its active SMs.
    #[test]
    fn calibration_few_ctas_throttle_bandwidth() {
        let hw = hardware("h100-sxm").expect("valid preset");
        let cal = calibration("h100-sxm").expect("valid preset");
        let (bw, _) = hw.hbm_bandwidth().expect("bandwidth");
        let (eta_m, _) = cal.memory_efficiency().expect("valid");
        let (saturate, _) = cal.sms_to_saturate_hbm().expect("valid");
        let (overhead, _) = cal.kernel_overhead(true).expect("valid");

        // Decode at 350 tokens: FA3 gives the one request 3 splits, so 8 KV
        // heads × 3 = 24 tiles, under the saturation point.
        let r = run(&scenario(Phase::Decode, 1, 350, 1));
        let i = r
            .step
            .kernels
            .iter()
            .position(|k| k.imp == Impl::Fa3)
            .expect("an FA3 kernel");
        assert_eq!(r.launches[i].blocks, 24);
        let (t, k) = (&r.time.kernels[i], &r.roofline.kernels[i]);
        assert_eq!(t.active_sms, 24);
        assert!(24 < saturate.0);
        let share = 24.0 / saturate.as_f64();
        let want = k.cost.bytes() / (bw * (eta_m.0 * share)) + overhead;
        assert!((t.realistic.0 / want.0 - 1.0).abs() < 1e-12);
        assert_eq!(t.limit, Limit::Memory);

        // A GEMM over every SM gets the whole `η_m · BW`.
        let i = r
            .step
            .kernels
            .iter()
            .position(|k| k.imp == Impl::CublasBf16 && k.layer == Some(0))
            .expect("a GEMM");
        let (t, k) = (&r.time.kernels[i], &r.roofline.kernels[i]);
        assert!(t.active_sms >= saturate.0, "{} SMs", t.active_sms);
        let want = k.cost.bytes() / (bw * eta_m.0) + overhead;
        assert!((t.realistic.0 / want.0 - 1.0).abs() < 1e-12);
    }

    /// A compute-bound kernel on half the SMs gets half of `η_c · peak`.
    #[test]
    fn calibration_few_ctas_throttle_compute() {
        use crate::hardware::TensorPrecision;
        use crate::roofline::{Cost, KernelRoofline};
        use crate::tiling::Tile;
        use crate::units::Bytes;

        let hw = hardware("h100-sxm").expect("valid preset");
        let sm = Sm::new(&hw).expect("sm limits");
        let cal = calibration("h100-sxm").expect("valid preset");
        let (peak, _) = hw.peak_tensor(TensorPrecision::Bf16).expect("peak");
        let flops = Flops(1e12);
        let (eta_c, _) = cal.compute_efficiency(flops).expect("valid");
        let (overhead, _) = cal.kernel_overhead(false).expect("valid");
        let prov = Provenance::new(Confidence::Estimated, ["test"]);
        let mut cost = Cost {
            flops,
            ..Cost::default()
        };
        cost.read.weights = Bytes(1e6);
        let roofline = StepRoofline {
            kernels: vec![KernelRoofline {
                cost,
                unfused: cost,
                provenance: prov.clone(),
                precision: TensorPrecision::Bf16,
                limit: Limit::Compute,
                lower_bound: flops / peak,
                time_provenance: prov.clone(),
            }],
        };
        let half = sm.count / 2;
        let launch = Launch {
            blocks: half,
            tile: Tile {
                m: 128,
                n: 128,
                k: 64,
            },
            splits: 1,
            slots: sm.count,
            per_wave: vec![half as u32],
            persistent: false,
            provenance: prov,
        };
        let s = scenario(Phase::Prefill, 1, 4096, 4096);
        let t = realistic(&roofline, &[launch], &s, &hw, &sm, &cal).expect("times");
        let want = flops / (peak * (eta_c.0 * 0.5)) + overhead;
        let got = &t.kernels[0];
        assert_eq!(got.limit, Limit::Compute);
        assert!((got.realistic.0 / want.0 - 1.0).abs() < 1e-12, "{got:?}");
    }

    #[test]
    fn calibration_overhead_follows_cuda_graphs() {
        assert!(cuda_graphs(&scenario(Phase::Decode, 512, 1024, 1)));
        assert!(!cuda_graphs(&scenario(Phase::Decode, 513, 1024, 1)));
        assert!(!cuda_graphs(&scenario(Phase::Prefill, 1, 256, 256)));

        let hw = hardware("h100-sxm").expect("valid preset");
        let sm = Sm::new(&hw).expect("sm limits");
        let cal = calibration("h100-sxm").expect("valid preset");
        let (graphs, _) = cal.kernel_overhead(true).expect("valid");
        let (eager, _) = cal.kernel_overhead(false).expect("valid");
        let zero: Quantity = serde_json::from_value(serde_json::json!({
            "value": 0.0, "unit": "s", "confidence": "estimated", "sources": ["s"]
        }))
        .expect("parses");
        let free = Calibration {
            kernel_overhead_graphs: zero.clone(),
            kernel_overhead_eager: zero,
            ..cal
        };
        // Every kernel pays the same fixed cost on top of its transfer or
        // compute time.
        for (s, want) in [
            (scenario(Phase::Decode, 1, 350, 1), graphs),
            (scenario(Phase::Prefill, 1, 64, 64), eager),
        ] {
            let r = run(&s);
            let without = realistic(&r.roofline, &r.launches, &s, &hw, &sm, &free).expect("times");
            for (t, w) in r.time.kernels.iter().zip(&without.kernels) {
                let paid = t.realistic - w.realistic;
                assert!((paid.0 / want.0 - 1.0).abs() < 1e-9, "{s:?}: {paid:?}");
            }
        }
    }
}
