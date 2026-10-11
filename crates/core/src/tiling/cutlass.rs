//! CUTLASS SM90 GEMMs: vLLM's per-tensor FP8 dispatch, and the same table
//! standing in for cuBLAS BF16 (design §4.3; brief §7.2).
//!
//! vLLM picks a tile and cluster by M (and N for small M); below 65 tokens
//! it swaps A and B so the weight's N fills the MMA's M. CUTLASS's
//! persistent scheduler rounds the tile grid up to whole clusters and
//! launches at most as many CTAs as fit, GPC by GPC.

use super::{Launch, Sm, Tile};
use crate::quantity::{Confidence, Provenance};

const SOURCE_FP8: &str = "vLLM v0.31.0 csrc/libtorch_stable/quantization/w8a8/cutlass/c3x/scaled_mm_sm90_fp8_dispatch.cuh: M ≤ 16 → 64×16×256 swap AB (cluster 1×2 if N ≤ 1280); M ≤ 64 → 64×16×256 (N ≤ 1280, cluster 1×4) or 64×64×256 swap AB; M ≤ 128 → 64×128×128; M ≥ 8192 and K ≥ 6144 → 256×128×128; else 128×128×128; clusters 2×1 from M > 64";
const SOURCE_SCHEDULER: &str = "CUTLASS v4.7.1 include/cutlass/gemm/kernel/tile_scheduler_params.h: get_tiled_cta_shape_mnl rounds tiles up to whole clusters; get_grid_shape launches min(get_max_cta_occupancy(18 SMs per GPC, cluster, SMs), tiles) CTAs";
const SOURCE_CUBLAS: &str = "cuBLAS picks BF16 kernels with a closed heuristic; vLLM's CUTLASS FP8 table with block K halved (same bytes per stage) stands in for it";

/// The tile, cluster and operand order vLLM's dispatch picks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Config {
    tile: Tile,
    cluster: (u64, u64),
    swap_ab: bool,
}

/// `cutlass_scaled_mm` for `m` tokens through an `[n, k]` FP8 weight with a
/// per-tensor scale.
pub fn fp8_tensor(m: u64, n: u64, k: u64, sm: &Sm) -> Launch {
    launch(
        m,
        n,
        config(m, n, k),
        sm,
        Provenance::new(Confidence::Documented, [SOURCE_FP8, SOURCE_SCHEDULER]),
    )
}

/// `aten::mm` in BF16, which cuBLAS runs: the FP8 table with K halved.
pub fn cublas_bf16(m: u64, n: u64, k: u64, sm: &Sm) -> Launch {
    let mut c = config(m, n, k);
    c.tile.k /= 2;
    launch(
        m,
        n,
        c,
        sm,
        Provenance::new(
            Confidence::Simplified,
            [SOURCE_CUBLAS, SOURCE_FP8, SOURCE_SCHEDULER],
        ),
    )
}

/// `cutlass_gemm_sm90_fp8_dispatch`.
fn config(m: u64, n: u64, k: u64) -> Config {
    let c = |tm, tn, tk, cluster, swap_ab| Config {
        tile: Tile {
            m: tm,
            n: tn,
            k: tk,
        },
        cluster,
        swap_ab,
    };
    if m <= 16 {
        let cluster = if n <= 1280 { (1, 2) } else { (1, 1) };
        c(64, 16, 256, cluster, true)
    } else if m <= 64 {
        if n <= 1280 {
            c(64, 16, 256, (1, 4), true)
        } else {
            c(64, 64, 256, (1, 1), true)
        }
    } else if m <= 128 {
        c(64, 128, 128, (2, 1), false)
    } else if m >= 8192 && k >= 6144 {
        c(256, 128, 128, (2, 1), false)
    } else {
        c(128, 128, 128, (2, 1), false)
    }
}

fn launch(m: u64, n: u64, c: Config, sm: &Sm, provenance: Provenance) -> Launch {
    // The problem as the kernel sees it.
    let (pm, pn) = if c.swap_ab { (n, m) } else { (m, n) };
    let (cm, cn) = c.cluster;
    let tiles_m = pm.div_ceil(u64::from(c.tile.m)).div_ceil(cm) * cm;
    let tiles_n = pn.div_ceil(u64::from(c.tile.n)).div_ceil(cn) * cn;
    let slots = if cm * cn == 1 {
        sm.count
    } else {
        max_cta_occupancy(18, cm * cn, sm.count)
    };
    Launch::new(tiles_m * tiles_n, c.tile, slots, true, provenance)
}

/// CUTLASS's `get_max_cta_occupancy`: clusters cannot span GPCs, so each
/// GPC of up to `per_gpc` SMs holds only whole clusters.
fn max_cta_occupancy(per_gpc: u64, cluster: u64, sms: u64) -> u64 {
    let gpcs = if sms < per_gpc { 1 } else { sms / per_gpc };
    let residual = if sms < per_gpc { 0 } else { sms % per_gpc };
    let ctas = gpcs * (per_gpc - per_gpc % cluster) + (residual - residual % cluster);
    ctas.min(sms)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hardware::hardware;

    fn sm() -> Sm {
        Sm::new(&hardware("h100-sxm").expect("valid preset")).expect("sm limits")
    }

    fn tile(m: u32, n: u32, k: u32) -> Tile {
        Tile { m, n, k }
    }

    #[test]
    fn gemm_tiling_cutlass_selection_by_m() {
        // Qwen3-8B QKV (N = 6144, K = 4096) across vLLM's M ranges.
        let cases = [
            (1, tile(64, 16, 256), true, 96),
            (16, tile(64, 16, 256), true, 96),
            (17, tile(64, 64, 256), true, 96),
            (64, tile(64, 64, 256), true, 96),
            (65, tile(64, 128, 128), false, 2 * 48),
            (128, tile(64, 128, 128), false, 2 * 48),
            (129, tile(128, 128, 128), false, 2 * 48),
            (8192, tile(128, 128, 128), false, 64 * 48),
        ];
        let sm = sm();
        for (m, want, swap, blocks) in cases {
            let c = config(m, 6144, 4096);
            assert_eq!((c.tile, c.swap_ab), (want, swap), "M = {m}");
            assert_eq!(fp8_tensor(m, 6144, 4096, &sm).blocks, blocks, "M = {m}");
        }
        // Large M and K: the 256-row cooperative tile (down, K = 12288).
        assert_eq!(config(8192, 4096, 12288).tile, tile(256, 128, 128));
        // Small N with small M: the 1×2 and 1×4 clusters.
        assert_eq!(config(8, 1024, 4096).cluster, (1, 2));
        assert_eq!(config(16, 1024, 4096).cluster, (1, 2));
        assert_eq!(config(17, 1024, 4096).cluster, (1, 4));
        assert_eq!(config(32, 1024, 4096).cluster, (1, 4));
    }

    #[test]
    fn gemm_tiling_cutlass_rounds_to_clusters_and_gpcs() {
        let sm = sm();
        // 65 tokens: 2 × 48 tiles; the 2 × 1 cluster keeps 2 M tiles.
        let l = fp8_tensor(65, 6144, 4096, &sm);
        assert_eq!(l.blocks, 96);
        assert_eq!(l.slots, 132);
        // 200 tokens, 128 × 128: 2 M tiles (already even) × 48.
        assert_eq!(fp8_tensor(200, 6144, 4096, &sm).blocks, 96);
        // 300 tokens: 3 M tiles round up to 4 for the 2 × 1 cluster.
        assert_eq!(fp8_tensor(300, 6144, 4096, &sm).blocks, 4 * 48);
        // 129 tokens through O (N = 4096): 2 × 32 = 64.
        assert_eq!(fp8_tensor(129, 4096, 4096, &sm).blocks, 64);
        // A 1×4 cluster fits 4 per full GPC of 18 and 4 of the 6 left over.
        assert_eq!(max_cta_occupancy(18, 4, 132), 7 * 16 + 4);
        assert_eq!(max_cta_occupancy(18, 2, 132), 132);
        // 8 tokens through N = 1024, 1×2 cluster: 16 × 1 tiles → 16 × 2.
        assert_eq!(fp8_tensor(8, 1024, 4096, &sm).blocks, 32);
    }

    #[test]
    fn gemm_tiling_cublas_bf16_halves_block_k() {
        let sm = sm();
        let l = cublas_bf16(1, 6144, 4096, &sm);
        assert_eq!(l.tile, tile(64, 16, 128));
        assert_eq!(l.blocks, 96);
        assert_eq!(l.provenance.confidence(), Confidence::Simplified);
        assert_eq!(cublas_bf16(4096, 6144, 4096, &sm).tile, tile(128, 128, 64));
    }
}
