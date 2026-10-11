//! DeepGEMM's SM90 FP8 GEMM (`fp8_gemm_nt`, the 1D2D kernel), which vLLM
//! v0.31.0 runs for `fp8_block` weights from 32 tokens up (design §4.3;
//! brief §7.2).
//!
//! DeepGEMM enumerates block and cluster shapes, drops the ones that do not
//! fit or pipeline badly, and keeps the one its own cost model says takes
//! the fewest cycles: L1 and L2 traffic per block over the wave efficiency.
//! This is `SM90ArchSpec` for a normal GEMM with FP8 inputs, a BF16 output
//! and no accumulation, with the integer and `float` arithmetic of the C++.

use super::{Launch, Sm, Tile};
use crate::error::CoreError;
use crate::quantity::{Confidence, Provenance};

const SOURCE: &str = "vllm-project/DeepGEMM e1f418c csrc/jit_kernels/heuristics/sm90.hpp (SM90ArchSpec: candidates, stages and the L1/L2 cycle model), heuristics/common.hpp (get_best_config keeps the first strictly cheaper layout), impls/sm90_fp8_gemm_1d2d.hpp (Normal 1D2D, grid of num_sms CTAs); vLLM v0.31.0 vllm/model_executor/kernels/linear/scaled_mm/flashinfer.py: DeepGEMM from M = 32";

/// `SM90ArchSpec::smem_capacity`.
const SMEM_CAPACITY: u64 = 232_448;
const MAX_STAGES: u64 = 16;
/// `128 · 8 / 8` bits for FP8.
const BLOCK_K: u64 = 128;
const WGMMA_M: u64 = 64;
/// FP8 inputs, BF16 output.
const AB_BYTES: u64 = 1;
const CD_BYTES: u64 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Layout {
    block_m: u64,
    block_n: u64,
    cluster_m: u64,
    cluster_n: u64,
}

/// DeepGEMM's launch for `m` tokens through an `[n, k]` weight.
pub fn launch(m: u64, n: u64, k: u64, sm: &Sm) -> Result<Launch, CoreError> {
    let (layout, _) = best(m, n, k, sm.count).ok_or_else(|| {
        CoreError::InvalidData(format!("DeepGEMM: no layout fits m={m} n={n} k={k}"))
    })?;
    Ok(Launch::new(
        m.div_ceil(layout.block_m) * n.div_ceil(layout.block_n),
        Tile {
            m: layout.block_m as u32,
            n: layout.block_n as u32,
            k: BLOCK_K as u32,
        },
        sm.count,
        true,
        Provenance::new(Confidence::Documented, [SOURCE]),
    ))
}

/// `get_best_config`: the first layout with the fewest cycles.
fn best(m: u64, n: u64, k: u64, sms: u64) -> Option<(Layout, u64)> {
    let mut best: Option<(Layout, u64)> = None;
    for layout in candidates(m, k, sms) {
        let c = cycles(m, n, k, sms, layout);
        if best.is_none_or(|(_, b)| c < b) {
            best = Some((layout, c));
        }
    }
    best
}

/// `get_layout_candidates`, in the C++ enumeration order.
fn candidates(m: u64, k: u64, sms: u64) -> Vec<Layout> {
    let mut block_ms = vec![64, 128];
    if m <= 16 {
        block_ms.push(16);
    }
    if m <= 32 {
        block_ms.push(32);
    }
    // BF16 output allows 256.
    block_ms.push(256);
    // 16 to 192: the 1D2D kernel spills registers above.
    let block_ns: Vec<u64> = (16..=192).step_by(16).collect();

    let mut out = Vec::new();
    for cluster_m in 1..=2 {
        for cluster_n in 1..=2 {
            let size = cluster_m * cluster_n;
            if size > 2 || !sms.is_multiple_of(size) {
                continue;
            }
            for &block_m in &block_ms {
                for &block_n in &block_ns {
                    // The 1D2D kernel's unroll needs block N to tile block K.
                    if block_n > BLOCK_K {
                        let d = block_n - BLOCK_K;
                        if !block_n.is_multiple_of(d) && !BLOCK_K.is_multiple_of(d) {
                            continue;
                        }
                    }
                    if block_m > 128 && block_n > 128 {
                        continue;
                    }
                    // Swizzling is 128 B for K-major FP8 at block K 128, so
                    // the 64 B minimum always holds.
                    let layout = Layout {
                        block_m,
                        block_n,
                        cluster_m,
                        cluster_n,
                    };
                    let s = stages(k, layout);
                    if s < 3 || (block_m * block_n < 128 * 192 && s < 4) {
                        continue;
                    }
                    out.push(layout);
                }
            }
        }
    }
    out
}

/// `get_pipeline_config`: how many A/B stages fit in shared memory.
fn stages(k: u64, l: Layout) -> u64 {
    let align = |x: u64, a: u64| x.div_ceil(a) * a;
    let smem_cd = align(l.block_m * l.block_n * CD_BYTES, 1024);
    let smem_barriers = MAX_STAGES * 8 * 2;
    let a = l.block_m * BLOCK_K * AB_BYTES;
    let b = l.block_n * BLOCK_K * AB_BYTES;
    let sfa = align(l.block_m * 4, 128);
    let uniform_sfb = if BLOCK_K.is_multiple_of(l.block_n) {
        1
    } else {
        2
    };
    let extra_sfb = align(k.div_ceil(BLOCK_K) * 4 * uniform_sfb, 8);
    let extra = smem_cd + smem_barriers + extra_sfb;
    (SMEM_CAPACITY.saturating_sub(extra) / (a + b + sfa)).min(MAX_STAGES)
}

/// `get_layout_info`: the cycle estimate a layout is ranked by.
fn cycles(m: u64, n: u64, k: u64, sms: u64, l: Layout) -> u64 {
    let blocks = m.div_ceil(l.block_m) * n.div_ceil(l.block_n);
    let waves = blocks.div_ceil(sms);
    // B/cycle; the L2 figure is a double truncated to int.
    let l2_bandwidth = (64.0 * sms as f64).min(8e6 / 1.3e3) as u64;
    let l1_bandwidth = 128 * sms;

    let (bm, bn) = (l.block_m, l.block_n);
    let l2_ab = k * (bm / l.cluster_n + bn / l.cluster_m) * AB_BYTES;
    let l1_ab = k * (bm + bn) * AB_BYTES;
    let l1_tc = k * (WGMMA_M.max(bm) + bn) * AB_BYTES + bm * bn * CD_BYTES;
    let cd = bm * bn * CD_BYTES;

    let l2_cycles = (l2_ab + cd) * blocks / l2_bandwidth;
    let l1_cycles = (l1_ab + l1_tc + cd) * blocks / l1_bandwidth;
    let wave_efficiency = blocks as f32 / (waves * sms) as f32;
    // Multicast is pointless within one wave.
    if l.cluster_m * l.cluster_n > 1 && waves <= 1 {
        return i64::MAX as u64;
    }
    (l1_cycles.max(l2_cycles) as f32 / wave_efficiency) as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hardware::hardware;

    fn layout(block_m: u64, block_n: u64, cluster_m: u64, cluster_n: u64) -> Layout {
        Layout {
            block_m,
            block_n,
            cluster_m,
            cluster_n,
        }
    }

    #[test]
    fn gemm_tiling_deepgemm_m256_qkv_by_hand() {
        // Qwen3-8B QKV at M = 256: N = 6144, K = 4096, 132 SMs.
        // L2 bandwidth = ⌊min(64 · 132, 8e6 / 1300)⌋ = 6153 B/cycle; L1 =
        // 128 · 132 = 16896 B/cycle.
        //
        // Winner, 128 × 96 without a cluster: 2 · 64 = 128 blocks, 1 wave,
        // efficiency 128/132.
        //   L2: (4096 · (128 + 96) + 128 · 96 · 2) · 128 / 6153
        //     = 942080 · 128 / 6153 = 19597
        //   L1: (917504 + 942080 + 24576) · 128 / 16896 = 14273
        //   cycles = ⌊19597 / 0.969697⌋ = 20209
        // Runner-up, 64 × 96 with a 2 × 1 cluster: 4 · 64 = 256 blocks, 2
        // waves, efficiency 256/264. L2 halves the N side by multicast:
        //   L2: (4096 · (64 + 96/2) + 12288) · 256 / 6153 = 19597
        //   L1: (655360 + 667648 + 12288) · 256 / 16896 = 20231
        //   cycles = ⌊20231 / 0.969697⌋ = 20863
        let sms = 132;
        assert_eq!(cycles(256, 6144, 4096, sms, layout(128, 96, 1, 1)), 20209);
        assert_eq!(cycles(256, 6144, 4096, sms, layout(64, 96, 2, 1)), 20863);
        assert_eq!(
            best(256, 6144, 4096, sms),
            Some((layout(128, 96, 1, 1), 20209))
        );

        let sm = Sm::new(&hardware("h100-sxm").expect("valid preset")).expect("sm limits");
        let l = launch(256, 6144, 4096, &sm).expect("launches");
        assert_eq!(
            l.tile,
            Tile {
                m: 128,
                n: 96,
                k: 128
            }
        );
        assert_eq!(l.blocks, 128);
        assert_eq!(l.per_wave, vec![128]);
        assert_eq!(l.slots, 132);
    }

    #[test]
    fn gemm_tiling_deepgemm_layouts_by_shape() {
        // Cross-checked against a line-by-line Python transcription of
        // sm90.hpp.
        let sms = 132;
        let cases = [
            // (m, n, k, layout)
            (256, 4096, 4096, layout(64, 128, 1, 1)),
            (256, 24576, 4096, layout(128, 192, 2, 1)),
            (256, 4096, 12288, layout(64, 128, 1, 1)),
            (32, 6144, 4096, layout(32, 48, 1, 1)),
            (4096, 24576, 4096, layout(256, 128, 1, 2)),
        ];
        for (m, n, k, want) in cases {
            let (got, _) = best(m, n, k, sms).expect("a layout fits");
            assert_eq!(got, want, "m={m} n={n} k={k}");
        }
        // At M = 32 the tensor-core traffic still counts a 64-row WGMMA for
        // a 32-row block: gate+up costs 18623 cycles, not 16575.
        assert_eq!(
            best(32, 24576, 4096, sms),
            Some((layout(32, 96, 2, 1), 18623))
        );
        assert_eq!(
            best(32, 4096, 12288, sms),
            Some((layout(32, 32, 1, 1), 16914))
        );
    }

    #[test]
    fn gemm_tiling_deepgemm_candidate_filters() {
        // Block N 176 does not tile block K 128 (176 % 48 and 128 % 48);
        // 144, 160 and 192 do.
        let ns: Vec<u64> = candidates(256, 4096, 132)
            .iter()
            .filter(|l| l.block_m == 64 && l.cluster_m * l.cluster_n == 1)
            .map(|l| l.block_n)
            .collect();
        assert!(!ns.contains(&176), "{ns:?}");
        assert!(ns.contains(&144) && ns.contains(&160) && ns.contains(&192));
        // Block M 32 only at M ≤ 32, and never 256 × (> 128).
        assert!(candidates(33, 4096, 132).iter().all(|l| l.block_m != 32));
        assert!(
            candidates(256, 4096, 132)
                .iter()
                .all(|l| !(l.block_m > 128 && l.block_n > 128))
        );
        // 256 × 128: 64 KB A/B per stage plus scales; 3 stages fit.
        assert_eq!(stages(4096, layout(256, 128, 1, 2)), 3);
    }
}
