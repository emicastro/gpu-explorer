//! The two small FA3 kernels around the attention: the per-step `prepare`
//! kernel and the split-KV `combine` (design §4.3).
//!
//! Both grids come from vllm-project/flash-attention `9cd61de`, `hopper/`.

use super::fa3::PREPARE_MAX_BATCH;
use super::{Launch, Sm, Tile};
use crate::quantity::{Confidence, Provenance};

const COMBINE_SOURCE: &str = "vllm-project/flash-attention 9cd61de hopper/flash_fwd_combine_launch_template.h (run_mha_fwd_combine_: kBlockK 64 if dv <= 64, else 128; kBlockM = 8 for kBlockK 128, 16 for 64; 256 threads) and hopper/flash_fwd_combine_kernel.h (StaticVarlenTileScheduler::get_grid_shape: ceil(dv / kBlockK) x ceil(seqlen_q * h / kBlockM) tiles per request). Slots count the thread limit only: the kernel's registers and shared memory are not cited (ADR 0013)";

const PREPARE_SOURCE: &str = "vllm-project/flash-attention 9cd61de hopper/flash_prepare_scheduler.cu (prepare_varlen_num_blocks: ceil(b / 992) CTAs of 32 * min(ceil(b / 31), 32) threads, warps rounded up to a power of two). Slots count the thread limit only: registers and shared memory are not cited (ADR 0013)";

const COMBINE_THREADS: u64 = 256;

/// The `combine` launch: `batch` requests of `new_tokens` queries each over
/// `q_heads` heads of value width `dv`. `splits` is the most splits any
/// request has.
///
/// The scheduler launches a padded grid when it linearizes sparse tiles
/// (`ceil(total_q · h / kBlockM) + b`); the extra CTAs exit at once, so
/// `blocks` counts only the tiles with work.
pub fn combine(batch: u64, new_tokens: u64, q_heads: u64, dv: u64, splits: u32, sm: &Sm) -> Launch {
    let block_k = if dv <= 64 { 64 } else { 128 };
    let block_m = if block_k % 128 == 0 { 8 } else { 16 };
    let tiles_m = (new_tokens * q_heads).div_ceil(block_m);
    let blocks = batch * tiles_m * dv.div_ceil(block_k);
    let mut launch = Launch::new(
        blocks,
        Tile {
            m: block_m as u32,
            n: block_k as u32,
            k: 0,
        },
        sm.count * sm.ctas_per_sm(COMBINE_THREADS, 0, 0),
        false,
        Provenance::new(Confidence::Documented, [COMBINE_SOURCE]),
    );
    launch.splits = splits;
    launch
}

/// The `prepare` launch for `batch` requests.
pub fn prepare(batch: u64, sm: &Sm) -> Launch {
    let warps = batch.div_ceil(31).clamp(1, 32).next_power_of_two();
    let threads = 32 * warps;
    Launch::new(
        batch.div_ceil(PREPARE_MAX_BATCH).max(1),
        Tile {
            m: 1,
            n: threads as u32,
            k: 0,
        },
        sm.count * sm.ctas_per_sm(threads, 0, 0),
        false,
        Provenance::new(Confidence::Documented, [PREPARE_SOURCE]),
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
    fn fa3_aux_prepare_launches_one_cta_up_to_992_requests() {
        let sm = sm();
        for (batch, ctas, threads) in [
            (1, 1, 32),
            (31, 1, 32),
            (32, 1, 64),
            (992, 1, 1024),
            (993, 2, 1024),
            (2000, 3, 1024),
        ] {
            let l = prepare(batch, &sm);
            assert_eq!(l.blocks, ctas, "batch {batch}");
            assert_eq!(l.tile.n, threads, "batch {batch}");
            assert!(!l.persistent);
        }
        assert_eq!(PREPARE_MAX_BATCH, 992);
    }

    #[test]
    fn fa3_aux_combine_decode_batch_1_matches_the_header() {
        // Qwen3-8B decode, 1 request: seqlen_q 1, h = 32 Q heads, dv = 128.
        // flash_fwd_combine_launch_template.h: dv > 64 gives kBlockK 128 and
        // kBlockM = 8. get_grid_shape (STANDARD, the grid is dense):
        //   num_blocks_m = ceil(1 * 32 / 8) = 4
        //   num_blocks_k = ceil(128 / 128)  = 1
        //   grid = (4, 1, b = 1)
        let l = combine(1, 1, 32, 128, 13, &sm());
        assert_eq!(l.blocks, 4);
        assert_eq!(l.tile, Tile { m: 8, n: 128, k: 0 });
        assert_eq!(l.splits, 13);
        assert_eq!(l.per_wave, vec![4]);
        assert_eq!(l.provenance.confidence(), Confidence::Documented);
    }

    #[test]
    fn fa3_aux_combine_grid_grows_with_requests_and_tokens() {
        let sm = sm();
        // 8 requests × 4 tiles; sparse decode grids are linearized but hold
        // the same tiles with work.
        assert_eq!(combine(8, 1, 32, 128, 4, &sm).blocks, 32);
        // A 256-token prefill: ceil(256 * 32 / 8) = 1024 tiles per request.
        assert_eq!(combine(2, 256, 32, 128, 4, &sm).blocks, 2048);
        // dv <= 64: kBlockK 64, kBlockM 16.
        let l = combine(1, 1, 32, 64, 4, &sm);
        assert_eq!((l.blocks, l.tile.m, l.tile.n), (2, 16, 64));
    }
}
