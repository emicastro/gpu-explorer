//! Marlin's W8A16 GEMM, which vLLM v0.31.0 uses on H100 only when forced
//! (design §4.3).
//!
//! Marlin is persistent and stripe-partitioned: every SM walks a stripe of
//! `(k, n)` tiles. The tile shape follows `determine_exec_config`.

use super::{Launch, Sm, Tile};
use crate::quantity::{Confidence, Provenance};

const SOURCE: &str = "vLLM v0.31.0 csrc/libtorch_stable/quantization/marlin/marlin.cu: marlin_mm and determine_exec_config (thread config {thread_k, thread_n, threads} from the small-batch list for up to 16 rows, else the large-batch list; {128, 64, 128} when the grid would leave SMs idle; blocks = SMs, 1 per SM). Simplified: shared-memory validity of a config is not checked, calls above 8192 rows are one launch here, and the stripes are counted as tiles";

/// Candidates in priority order: `(thread_k, thread_n, threads)`.
const SMALL_BATCH: [(u64, u64, u64); 3] = [(128, 128, 256), (64, 128, 128), (128, 64, 128)];
const LARGE_BATCH: [(u64, u64, u64); 3] = [(64, 256, 256), (64, 128, 128), (128, 64, 128)];

/// The most 16-row blocks one CTA covers.
const MAX_THREAD_M_BLOCKS: u64 = 4;

/// The launch for `m` tokens through a `[k, n]` weight.
pub fn launch(m: u64, n: u64, k: u64, sm: &Sm) -> Launch {
    let m_blocks = m.div_ceil(16).min(MAX_THREAD_M_BLOCKS);
    let rows = if m <= 8 { 8 } else { 16 * m_blocks };
    let valid = |(tk, tn, _): (u64, u64, u64)| k.is_multiple_of(tk) && n.is_multiple_of(tn);
    let list = if m_blocks > 1 {
        LARGE_BATCH
    } else {
        SMALL_BATCH
    };
    let mut config = list
        .into_iter()
        .find(|&c| valid(c))
        .unwrap_or(SMALL_BATCH[2]);
    // Few tiles would leave SMs idle: take the finest config.
    let fine = SMALL_BATCH[2];
    if n / config.1 * m.div_ceil(rows) * 4 <= sm.count && valid(fine) {
        config = fine;
    }
    let (tk, tn, _) = config;
    let tiles = (n / tn) * (k / tk) * m.div_ceil(rows);
    Launch::new(
        tiles.min(sm.count),
        Tile {
            m: rows as u32,
            n: tn as u32,
            k: tk as u32,
        },
        sm.count,
        true,
        Provenance::new(Confidence::Simplified, [SOURCE]),
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
    fn marlin_batch_1_configs_follow_determine_exec_config() {
        let sm = sm();
        // QKV (n 6144): 6144 / 128 * 1 * 4 = 192 > 132 SMs, so the first
        // config {128, 128} stays. Tiles: 48 * 32 = 1536 → all 132 SMs.
        let l = launch(1, 6144, 4096, &sm);
        assert_eq!(
            l.tile,
            Tile {
                m: 8,
                n: 128,
                k: 128
            }
        );
        assert_eq!(l.blocks, 132);
        // O (n 4096): 4096 / 128 * 1 * 4 = 128 <= 132 would idle SMs, so
        // it takes {128, 64}.
        let l = launch(1, 4096, 4096, &sm);
        assert_eq!(
            l.tile,
            Tile {
                m: 8,
                n: 64,
                k: 128
            }
        );
        assert!(l.persistent);
        assert_eq!(l.slots, 132);
    }

    #[test]
    fn marlin_large_batches_use_the_large_batch_list() {
        // 64 rows → 4 m-blocks of 16: {64, 256} first. n 24576 / 256 * 1 * 4
        // = 384 > 132.
        let l = launch(64, 24576, 4096, &sm());
        assert_eq!(
            l.tile,
            Tile {
                m: 64,
                n: 256,
                k: 64
            }
        );
        // A tiny weight has fewer tiles than SMs.
        let l = launch(1, 64, 128, &sm());
        assert_eq!(l.blocks, 1);
    }
}
