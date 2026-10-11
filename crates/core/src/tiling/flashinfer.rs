//! FlashInfer's swap-AB FP8 block-scaled GEMM, which vLLM v0.31.0 runs for
//! `fp8_block` weights below 32 tokens (design §4.3; brief §7.2).
//!
//! Swap AB puts the weight's `N` rows in the MMA's M dimension, so a tile
//! is 64 or 128 weight rows by 16 to 128 tokens.

use super::{Launch, Sm, Tile};
use crate::quantity::{Confidence, Provenance};

const SOURCE: &str = "FlashInfer 0.7.0.post1 csrc/nv_internal/tensorrt_llm/deep_gemm/jit_utils.cuh: get_best_gemm_config with swap_ab (block M over the weight's N: 64 if N <= 64, else 128; block N over the tokens, 16 to 128 by 8; fewest waves, then the fullest last wave, then the smallest block N); kernels/cutlass_kernels/fp8_blockscale_gemm/fp8_blockscale_gemm_kernel.cuh: gemm_dispatch swaps below M = 32; deep_gemm/fp8_gemm.cuh: grid of one CTA per SM";

/// The swap-AB launch for `m` tokens through an `[n, k]` weight. `K` does
/// not change the tiles.
pub fn launch(m: u64, n: u64, _k: u64, sm: &Sm) -> Launch {
    let sms = sm.count;
    let block_m = if n <= 64 { 64 } else { 128 };
    let tiles = |bn: u64| n.div_ceil(block_m) * m.div_ceil(bn);
    let waves = |bn: u64| tiles(bn).div_ceil(sms);
    let last_wave = |bn: u64| match tiles(bn) % sms {
        0 => sms,
        r => r,
    };
    // `get_best_gemm_config`'s loop, with one block M candidate.
    let mut best = 16;
    for bn in (24..=128).step_by(8) {
        let better = waves(bn) < waves(best)
            || (waves(bn) == waves(best)
                && (last_wave(bn) > last_wave(best)
                    || (last_wave(bn) == last_wave(best) && bn < best)));
        if better {
            best = bn;
        }
    }
    Launch::new(
        tiles(best),
        Tile {
            m: block_m as u32,
            n: best as u32,
            k: 128,
        },
        sms,
        true,
        Provenance::new(Confidence::Documented, [SOURCE]),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hardware::hardware;

    fn sm() -> Sm {
        Sm::new(&hardware("h100-sxm").expect("valid preset")).expect("sm limits")
    }

    #[test]
    fn gemm_tiling_flashinfer_batch_1_tiles() {
        // Brief §8: Qwen3-8B at batch 1, tile 128 × 16.
        let sm = sm();
        let tile = Tile {
            m: 128,
            n: 16,
            k: 128,
        };
        for (name, n, k, tiles, waves) in [
            ("qkv", 6144, 4096, 48, vec![48]),
            ("o", 4096, 4096, 32, vec![32]),
            ("gate_up", 24576, 4096, 192, vec![132, 60]),
            ("down", 4096, 12288, 32, vec![32]),
        ] {
            let l = launch(1, n, k, &sm);
            assert_eq!(l.tile, tile, "{name}");
            assert_eq!(l.blocks, tiles, "{name}");
            assert_eq!(l.per_wave, waves, "{name}");
            assert!(l.persistent);
        }
    }

    #[test]
    fn gemm_tiling_flashinfer_block_n_follows_the_tokens() {
        let sm = sm();
        // 31 tokens through O: block N 16 gives 64 tiles and 32 gives 32,
        // both in one wave; the fuller last wave wins.
        let l = launch(31, 4096, 4096, &sm);
        assert_eq!(l.tile.n, 16);
        assert_eq!(l.blocks, 64);
        // 17 tokens through gate+up: 192 × 2 = 384 tiles at block N 16 (3
        // waves) vs 192 at 24 (2 waves, 60 in the last).
        let l = launch(17, 24576, 4096, &sm);
        assert_eq!(l.tile.n, 24);
        assert_eq!(l.blocks, 192);
        // A weight of 64 rows or fewer gets block M 64.
        assert_eq!(launch(1, 64, 4096, &sm).tile.m, 64);
    }
}
