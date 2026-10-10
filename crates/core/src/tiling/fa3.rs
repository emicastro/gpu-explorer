//! FlashAttention 3's split-KV schedule and tiles, as vLLM v0.31.0 drives it
//! on H100 (design §4.3; brief §7.2).
//!
//! Three layers decide the splits:
//! 1. vLLM passes FA3 a cap: 32 when the step has at most 512 tokens (the
//!    largest CUDA graph it captures), in either phase. Above that it passes
//!    0, which lets FA3 choose.
//! 2. FA3's host code turns the cap into `num_splits`: the cap itself, or
//!    `num_splits_heuristic` for a single request with the longest lengths.
//!    Over 992 requests it is 1. Above 1, the `combine` kernel runs.
//! 3. The prepare kernel gives each request its own count, at most the
//!    host's, from the total work of the batch.
//!
//! vLLM's attention is always causal for Qwen3, and FA3 always packs GQA
//! here because the head dims of K and V are equal.

use super::{Launch, Tile, per_wave};
use crate::error::CoreError;
use crate::hardware::{HwNode, Level};
use crate::model::{KvDtype, ModelConfig};
use crate::quantity::{Confidence, Provenance};
use crate::scenario::Scenario;

const SOURCE_VLLM: &str = "vLLM v0.31.0 vllm/v1/attention/backends/flash_attn.py: max_num_splits = flash_attn_max_num_splits_for_cuda_graph (32) when num_actual_tokens <= max_cudagraph_capture_size, else 0 (FA3 heuristic); vllm/config/vllm.py: max_cudagraph_capture_size = min(2 · max_num_seqs, 512), with max_num_seqs = 1024 on H100 (vllm/engine/arg_utils.py)";
const SOURCE_HOST: &str = "vllm-project/flash-attention 9cd61de hopper/flash_api.cpp: get_num_splits runs the heuristic as if batch = 1 under varlen; pack_gqa forced when d == dv; num_splits = 1 over 992 requests; causal kept for hdim 128 with a page table. hopper/heuristics.h: num_splits_heuristic, use_one_mma_wg";
const SOURCE_PREPARE: &str = "vllm-project/flash-attention 9cd61de hopper/flash_prepare_scheduler.cu: per request, clamp(⌈n_blocks / ⌈1.1 · Σ m_blocks·n_blocks · n_kv / SMs⌉⌉, 1, num_splits)";
const SOURCE_TILES: &str = "vllm-project/flash-attention 9cd61de hopper/tile_size.h: tile_size_fwd_sm90 (FP8 two-level accumulation on, as vLLM builds it); hopper/tile_scheduler.hpp: VarlenDynamicPersistentTileScheduler, one CTA per SM";

/// vLLM's split cap while a CUDA graph can hold the step.
pub const GRAPH_SPLITS: u32 = 32;
/// The most tokens vLLM captures in a CUDA graph on H100 by default.
pub const GRAPH_MAX_TOKENS: u64 = 512;
/// Requests the single prepare CTA handles; over it, every request gets 1
/// split.
const PREPARE_MAX_BATCH: u64 = 992;
/// FA3's ceiling on the heuristic's splits.
const HEURISTIC_MAX_SPLITS: u64 = 128;
/// The L2 size FA3's heuristic assumes.
const HEURISTIC_L2: u64 = 50 * 1024 * 1024;

/// FA3's split-KV schedule for one step.
#[derive(Debug, Clone, PartialEq)]
pub struct Fa3Schedule {
    /// `num_splits` on FA3's host side. Above 1, `combine` runs.
    pub host_splits: u32,
    /// Per request, the splits the prepare kernel gives it.
    pub splits: Vec<u32>,
    /// The main attention kernel.
    pub launch: Launch,
}

/// FA3's schedule for the attention of every layer in `scenario`.
pub fn fa3(
    model: &ModelConfig,
    scenario: &Scenario,
    hw: &HwNode,
) -> Result<Fa3Schedule, CoreError> {
    scenario.validate()?;
    let cap = if scenario.tokens() <= GRAPH_MAX_TOKENS {
        GRAPH_SPLITS
    } else {
        0
    };
    Problem::new(model, scenario, hw)?.schedule(cap)
}

/// The attention of one layer, as FA3 sees it.
struct Problem<'a> {
    contexts: &'a [u32],
    new_tokens: u64,
    q_heads: u64,
    kv_heads: u64,
    head_dim: u64,
    kv: KvDtype,
    sms: u64,
}

impl<'a> Problem<'a> {
    fn new(model: &ModelConfig, scenario: &'a Scenario, hw: &HwNode) -> Result<Self, CoreError> {
        let c = &model.config;
        Ok(Problem {
            contexts: &scenario.contexts,
            new_tokens: u64::from(scenario.new_tokens),
            q_heads: c.num_attention_heads,
            kv_heads: c.num_key_value_heads,
            head_dim: c.head_dim,
            kv: scenario.kv,
            sms: hw.enabled_total(|n| n.level == Level::Sm)?.0,
        })
    }

    /// `cap` is the `num_splits` vLLM passes: 0 lets FA3 choose.
    fn schedule(&self, cap: u32) -> Result<Fa3Schedule, CoreError> {
        let tile = self.tile()?;
        let host_splits = self.host_splits(cap, tile);
        let splits = self.request_splits(host_splits, tile);
        let m_blocks = self.m_blocks(tile);
        let blocks = splits
            .iter()
            .map(|&s| m_blocks * self.kv_heads * u64::from(s))
            .sum();
        // A persistent grid of one CTA per SM.
        let slots = self.sms;
        let launch = Launch {
            blocks,
            tile,
            splits: splits.iter().copied().max().unwrap_or(1),
            slots,
            per_wave: per_wave(blocks, slots),
            persistent: true,
            provenance: Provenance::new(
                Confidence::Documented,
                [SOURCE_VLLM, SOURCE_HOST, SOURCE_PREPARE, SOURCE_TILES],
            ),
        };
        Ok(Fa3Schedule {
            host_splits,
            splits,
            launch,
        })
    }

    /// Query heads per KV head: the rows PackGQA stacks in one tile.
    fn group(&self) -> u64 {
        self.q_heads.div_ceil(self.kv_heads)
    }

    /// `tile_size_fwd_sm90` for a causal, paged-KV head dim of 128.
    fn tile(&self) -> Result<Tile, CoreError> {
        if self.head_dim != 128 {
            return Err(CoreError::InvalidData(format!(
                "FA3 tiling: head_dim {} is not modeled, only 128",
                self.head_dim
            )));
        }
        // `use_one_mma_wg`: one MMA warpgroup when the packed queries of a
        // KV head fit 64 rows, which every decode does.
        let one_wg = self.new_tokens * (self.q_heads / self.kv_heads) <= 64;
        let (m, n) = match (self.kv, one_wg) {
            (KvDtype::Bf16, true) => (64, 128),
            (KvDtype::Bf16, false) => (128, 128),
            (KvDtype::Fp8, true) => (64, 96),
            (KvDtype::Fp8, false) => (128, 192),
        };
        Ok(Tile {
            m,
            n,
            k: self.head_dim as u32,
        })
    }

    /// Query tiles per request and KV head, with GQA packed.
    fn m_blocks(&self, tile: Tile) -> u64 {
        (self.new_tokens * self.group()).div_ceil(u64::from(tile.m))
    }

    fn n_blocks(&self, context: u32, tile: Tile) -> u64 {
        u64::from(context).div_ceil(u64::from(tile.n))
    }

    /// `num_splits` on FA3's host side (`mha_fwd`).
    fn host_splits(&self, cap: u32, tile: Tile) -> u32 {
        if self.contexts.len() as u64 > PREPARE_MAX_BATCH {
            return 1;
        }
        if cap > 0 {
            return cap;
        }
        // Under varlen FA3 only knows the longest lengths and plans for one
        // request: this is an upper bound for the prepare kernel.
        let max_context = self.contexts.iter().copied().max().unwrap_or(0);
        let m_blocks = self.m_blocks(tile);
        let element = match self.kv {
            KvDtype::Bf16 => 2,
            KvDtype::Fp8 => 1,
        };
        num_splits_heuristic(
            self.kv_heads * m_blocks,
            self.sms,
            self.n_blocks(max_context, tile),
            m_blocks,
            u64::from(max_context) * 2 * self.head_dim * element,
            true,
            HEURISTIC_MAX_SPLITS,
        )
    }

    /// `prepare_varlen_num_blocks_kernel`: each request's splits, spreading
    /// the batch's KV blocks over the SMs with a 10 % margin.
    fn request_splits(&self, host_splits: u32, tile: Tile) -> Vec<u32> {
        if host_splits <= 1 {
            return vec![1; self.contexts.len()];
        }
        let m_blocks = self.m_blocks(tile);
        let n_blocks: Vec<u64> = self
            .contexts
            .iter()
            .map(|&s| self.n_blocks(s, tile))
            .collect();
        let total: u64 = n_blocks.iter().map(|n| m_blocks * n).sum();
        // In f32, in this order, as the kernel computes it.
        let per_sm = (total as f32 * 1.1f32 * self.kv_heads as f32 / self.sms as f32).ceil() as u64;
        n_blocks
            .iter()
            .map(|n| n.div_ceil(per_sm).clamp(1, u64::from(host_splits)) as u32)
            .collect()
    }
}

/// `num_splits_heuristic` from FA3's `hopper/heuristics.h`: the fewest
/// splits within 85 % of the best wave efficiency.
fn num_splits_heuristic(
    total_m_blocks: u64,
    sms: u64,
    n_blocks: u64,
    m_blocks: u64,
    kv_head_bytes: u64,
    causal: bool,
    max_splits: u64,
) -> u32 {
    if total_m_blocks as f32 >= 0.8f32 * sms as f32 {
        // Enough tiles already; split only a KV head too big for L2.
        if kv_head_bytes > HEURISTIC_L2 && m_blocks >= sms * 2 && !causal {
            return kv_head_bytes.div_ceil(HEURISTIC_L2).min(max_splits) as u32;
        }
        return 1;
    }
    if n_blocks <= 4 {
        return 1;
    }
    let max_splits = max_splits.min(sms).min(n_blocks);
    let efficiency: Vec<f32> = (1..=max_splits)
        .map(|s| {
            let waves = (total_m_blocks * s) as f32 / sms as f32;
            waves / waves.ceil()
        })
        .collect();
    let best = efficiency.iter().copied().fold(0.0f32, f32::max);
    efficiency
        .iter()
        .position(|&e| f64::from(e) >= 0.85 * f64::from(best))
        .map_or(1, |i| i as u32 + 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hardware::hardware;
    use crate::model::model;
    use crate::scenario::{Phase, Weights};

    fn scenario(phase: Phase, contexts: Vec<u32>, new_tokens: u32, kv: KvDtype) -> Scenario {
        Scenario {
            phase,
            contexts,
            new_tokens,
            weights: Weights::Bf16,
            kv,
        }
    }

    fn decode(batch: usize, context: u32) -> Scenario {
        scenario(Phase::Decode, vec![context; batch], 1, KvDtype::Bf16)
    }

    fn schedule(s: &Scenario) -> Fa3Schedule {
        let m = model("qwen3-8b").expect("valid preset");
        let hw = hardware("h100-sxm").expect("valid preset");
        fa3(&m, s, &hw).expect("schedules")
    }

    #[test]
    fn fa3_decode_splits_match_brief_table() {
        // Brief §7.2, row by row: (B, S, splits, blocks, SMs busy %).
        let rows = [
            (1, 256, 2, 16, 12),
            (1, 1024, 8, 64, 48),
            (1, 4096, 11, 88, 67),
            (1, 8192, 13, 104, 79),
            (1, 32768, 15, 120, 91),
            (1, 131072, 15, 120, 91),
            (8, 8192, 2, 128, 97),
        ];
        for (b, s, splits, blocks, busy) in rows {
            let f = schedule(&decode(b, s));
            assert_eq!(f.host_splits, GRAPH_SPLITS, "B {b}, S {s}");
            assert_eq!(f.splits, vec![splits; b], "B {b}, S {s}");
            assert_eq!(f.launch.blocks, blocks, "B {b}, S {s}");
            assert_eq!(f.launch.per_wave, vec![blocks as u32], "B {b}, S {s}");
            let pct = (100.0 * blocks as f64 / 132.0).round() as u64;
            assert_eq!(pct, busy, "B {b}, S {s}");
        }
        // 32 × 8k: 1 split, 256 blocks in 2 rounds.
        let f = schedule(&decode(32, 8192));
        assert_eq!(f.splits, vec![1; 32]);
        assert_eq!(f.launch.blocks, 256);
        assert_eq!(f.launch.per_wave, vec![132, 124]);
    }

    #[test]
    fn fa3_decode_tile_is_64x128_packed_and_persistent() {
        let f = schedule(&decode(1, 8192));
        assert_eq!(
            f.launch.tile,
            Tile {
                m: 64,
                n: 128,
                k: 128
            }
        );
        assert_eq!(f.launch.slots, 132);
        assert!(f.launch.persistent);
        assert_eq!(f.launch.provenance.confidence(), Confidence::Documented);
    }

    #[test]
    fn fa3_decode_without_split_is_8_blocks_at_batch_1() {
        // Brief §8: one tile per KV head with PackGQA (~6 % of the SMs).
        let m = model("qwen3-8b").expect("valid preset");
        let hw = hardware("h100-sxm").expect("valid preset");
        let s = decode(1, 8192);
        let f = Problem::new(&m, &s, &hw)
            .expect("problem")
            .schedule(1)
            .expect("schedules");
        assert_eq!(f.host_splits, 1);
        assert_eq!(f.launch.blocks, 8);
        assert_eq!(f.launch.per_wave, vec![8]);
    }

    #[test]
    fn fa3_mixed_contexts_split_by_each_requests_blocks() {
        // 64 + 8 KV blocks; ⌈72 · 1.1 · 8 / 132⌉ = 5 per SM.
        let s = scenario(Phase::Decode, vec![8192, 1024], 1, KvDtype::Bf16);
        let f = schedule(&s);
        assert_eq!(f.splits, vec![13, 2]);
        assert_eq!(f.launch.splits, 13);
        assert_eq!(f.launch.blocks, 8 * (13 + 2));
    }

    #[test]
    fn fa3_over_512_tokens_uses_the_heuristic_cap() {
        // No CUDA graph: FA3 plans for one request of 64 KV blocks and 8
        // tiles; 15 splits is the first within 85 % of the best efficiency
        // (14 gives 112/132 = 0.848, 15 gives 120/132).
        let f = schedule(&decode(600, 8192));
        assert_eq!(f.host_splits, 15);
        // The batch already fills the SMs, so nobody splits.
        assert_eq!(f.splits, vec![1; 600]);
        assert_eq!(f.launch.blocks, 600 * 8);
        // Short contexts: 4 KV blocks or fewer never split.
        assert_eq!(schedule(&decode(600, 512)).host_splits, 1);
    }

    #[test]
    fn fa3_over_992_requests_never_splits() {
        let f = schedule(&decode(1000, 8192));
        assert_eq!(f.host_splits, 1);
        assert_eq!(f.splits, vec![1; 1000]);
        // 992 still fits the prepare CTA: the heuristic's cap stands.
        assert_eq!(schedule(&decode(992, 8192)).host_splits, 15);
    }

    #[test]
    fn fa3_prefill_tiles_and_splits() {
        // 2048 queries × 4 heads: two MMA warpgroups, 128 × 128 causal.
        let f = schedule(&scenario(Phase::Prefill, vec![2048], 2048, KvDtype::Bf16));
        assert_eq!(
            f.launch.tile,
            Tile {
                m: 128,
                n: 128,
                k: 128
            }
        );
        // 64 query tiles × 8 KV heads fill the SMs: no split, no combine.
        assert_eq!(f.host_splits, 1);
        assert_eq!(f.launch.blocks, 512);
        assert_eq!(f.launch.per_wave, vec![132, 132, 132, 116]);

        // A small prefill fits a CUDA graph: cap 32, and the prepare kernel
        // splits by m_blocks · n_blocks (16 · 4 = 64 → 5 per SM → 1).
        let f = schedule(&scenario(Phase::Prefill, vec![512], 512, KvDtype::Bf16));
        assert_eq!(f.host_splits, GRAPH_SPLITS);
        assert_eq!(f.splits, vec![1]);

        // 16 queries × 4 heads still fit one warpgroup.
        let f = schedule(&scenario(Phase::Prefill, vec![4096], 16, KvDtype::Bf16));
        assert_eq!(
            f.launch.tile,
            Tile {
                m: 64,
                n: 128,
                k: 128
            }
        );
    }

    #[test]
    fn fa3_fp8_kv_tiles() {
        let f = schedule(&scenario(Phase::Decode, vec![8192], 1, KvDtype::Fp8));
        assert_eq!(
            f.launch.tile,
            Tile {
                m: 64,
                n: 96,
                k: 128
            }
        );
        // 86 KV blocks of 96; ⌈86 · 1.1 · 8 / 132⌉ = 6 per SM → 15 splits.
        assert_eq!(f.splits, vec![15]);
        let f = schedule(&scenario(Phase::Prefill, vec![4096], 4096, KvDtype::Fp8));
        assert_eq!(
            f.launch.tile,
            Tile {
                m: 128,
                n: 192,
                k: 128
            }
        );
    }

    #[test]
    fn fa3_heuristic_prefers_fewest_good_splits() {
        // FA3's own comment: 48 tiles on 108 SMs → 2 splits (0.89) beats 3.
        assert_eq!(num_splits_heuristic(48, 108, 64, 1, 0, true, 128), 2);
        // Over 80 % of the SMs: no split unless a non-causal KV head
        // overflows L2.
        assert_eq!(num_splits_heuristic(120, 132, 64, 15, 0, true, 128), 1);
        let big = 3 * HEURISTIC_L2;
        assert_eq!(num_splits_heuristic(300, 132, 64, 300, big, false, 128), 3);
        assert_eq!(num_splits_heuristic(300, 132, 64, 300, big, true, 128), 1);
    }
}
