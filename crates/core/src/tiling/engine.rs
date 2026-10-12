//! The small kernels vLLM, PyTorch and FlashInfer launch around the model:
//! input bookkeeping, the KV write, activation quantization, the last-token
//! gather and sampling (design §4.3).
//!
//! These are all `simplified`: their grids are short formulas read from the
//! source or the D14 trace, and none of them dominates a step.

use super::{Launch, Sm, Tile};
use crate::error::CoreError;
use crate::quantity::{Confidence, Provenance};

const CACHE_WRITE_SOURCE: &str = "vLLM v0.31.0 csrc/cache_kernels.cu reshape_and_cache_flash: grid = tokens, block = min(kv_heads * head_dim, 512); 40 registers and no shared memory from the D14 trace (Ampere; assumed the same on H100)";

const PREPARE_INPUTS_SOURCE: &str = "data/traces/vllm-0.31.0_qwen3-8b-3layers_rtx3070/kernels.json (D14): grids by kernel for 1, 3 and 4 requests (_prepare_pos_seq_lens and _compute_slot_mappings: requests + 1; _combine_sampled_and_draft_tokens, _prepare_prefill_inputs and _gather_block_tables: requests; the rest 1). _apply_write_kernel ran 1 to 4 CTAs in a 4-request step, taken as requests. Ampere; assumed the same on H100";

const VLLM_QUANT_SOURCE: &str = "vLLM v0.31.0 csrc/libtorch_stable/quantization/w8a8/fp8/per_token_group_quant.cu per_token_group_quant_8bit: BF16 input with group size 128 takes the register path, 8 threads per group in blocks of 256 (32 groups), one CTA per 32 groups. Slots count the thread limit only: registers and shared memory are not cited (ADR 0013)";

const FLASHINFER_QUANT_SOURCE: &str = "FlashInfer 0.7.0.post1 csrc/nv_internal/tensorrt_llm/kernels/cutlass_kernels/fp8_blockscale_gemm/fp8_blockscale_gemm_kernel.cuh: scale_1x128_kernel<<<kNumDeviceSMs * 8, 256>>>, a grid of 8 CTAs per SM that is already resident";

const INDEX_SOURCE: &str = "data/traces/vllm-0.31.0_qwen3-8b-3layers_rtx3070/kernels.json (D14): PyTorch's index kernel runs one 128-thread CTA per 512 elements (grid 32 for 4 requests × 4096, 24 for 3), 16 registers";

const SAMPLING_SOURCE: &str = "FlashInfer 0.7.0.post1 include/flashinfer/sampling.cuh: one CTA per request, 1024 threads on compute capability 8 and up. vLLM's sampler may launch more kernels around it; they are not modeled. Slots count the thread limit only (ADR 0013)";

fn provenance(source: &'static str) -> Provenance {
    Provenance::new(Confidence::Simplified, [source])
}

/// Non-persistent grid of `blocks` CTAs of `threads` threads.
fn grid(blocks: u64, tile: Tile, threads: u64, regs: u64, sm: &Sm, source: &'static str) -> Launch {
    Launch::new(
        blocks,
        tile,
        sm.count * sm.ctas_per_sm(threads, regs, 0),
        false,
        provenance(source),
    )
}

/// `reshape_and_cache_flash`: one CTA per token.
pub fn cache_write(tokens: u64, kv_heads: u64, head_dim: u64, sm: &Sm) -> Launch {
    let threads = (kv_heads * head_dim).min(512);
    let tile = Tile {
        m: 1,
        n: threads as u32,
        k: 0,
    };
    grid(tokens, tile, threads, 40, sm, CACHE_WRITE_SOURCE)
}

/// One of the input-bookkeeping kernels, by the name in the fusion profile.
pub fn prepare_inputs(name: &str, requests: u64, sm: &Sm) -> Result<Launch, CoreError> {
    // (CTAs, threads, registers per thread)
    let (blocks, threads, regs) = match name {
        "_apply_write_kernel" => (requests, 128, 36),
        "_prepare_prefill_inputs_kernel" => (requests, 128, 36),
        "_prepare_pos_seq_lens_kernel" => (requests + 1, 128, 29),
        "_combine_sampled_and_draft_tokens_kernel" => (requests, 128, 19),
        "_gather_block_tables_kernel" => (requests, 128, 36),
        "_compute_slot_mappings_kernel" => (requests + 1, 128, 64),
        "aten::fill_" => (1, 128, 16),
        "aten::arange" => (1, 64, 16),
        _ => {
            return Err(CoreError::InvalidData(format!(
                "input preparation: no grid for kernel {name:?}"
            )));
        }
    };
    let tile = Tile {
        m: 1,
        n: threads as u32,
        k: 0,
    };
    Ok(grid(blocks, tile, threads, regs, sm, PREPARE_INPUTS_SOURCE))
}

/// vLLM's per-token-group FP8 quantization of `rows × cols` activations in
/// groups of 128 (the path for 32 tokens or more).
pub fn vllm_group_quant(rows: u64, cols: u64, sm: &Sm) -> Launch {
    const GROUP: u64 = 128;
    const GROUPS_PER_BLOCK: u64 = 32;
    let groups = rows * cols / GROUP;
    let tile = Tile {
        m: GROUPS_PER_BLOCK as u32,
        n: GROUP as u32,
        k: 0,
    };
    grid(
        groups.div_ceil(GROUPS_PER_BLOCK),
        tile,
        256,
        0,
        sm,
        VLLM_QUANT_SOURCE,
    )
}

/// FlashInfer's `scale_1x128_kernel` (the path below 32 tokens): a fixed
/// grid of 8 CTAs per SM, whatever the shape.
pub fn flashinfer_quant(sm: &Sm) -> Launch {
    let slots = sm.count * 8;
    Launch::new(
        slots,
        Tile { m: 1, n: 128, k: 0 },
        slots,
        true,
        provenance(FLASHINFER_QUANT_SOURCE),
    )
}

/// The gather of the last token of each request: `requests × hidden`
/// elements, 512 per CTA.
pub fn index(requests: u64, hidden: u64, sm: &Sm) -> Launch {
    const PER_CTA: u64 = 128 * 4;
    let tile = Tile {
        m: 1,
        n: PER_CTA as u32,
        k: 0,
    };
    grid(
        (requests * hidden).div_ceil(PER_CTA),
        tile,
        128,
        16,
        sm,
        INDEX_SOURCE,
    )
}

/// Sampling: one CTA per request.
pub fn sampling(requests: u64, vocab: u64, sm: &Sm) -> Launch {
    let tile = Tile {
        m: 1,
        n: vocab.min(u64::from(u32::MAX)) as u32,
        k: 0,
    };
    grid(requests, tile, 1024, 0, sm, SAMPLING_SOURCE)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hardware::hardware;

    fn sm() -> Sm {
        Sm::new(&hardware("h100-sxm").expect("valid preset")).expect("sm limits")
    }

    #[test]
    fn engine_grids_match_the_trace() {
        let sm = sm();
        // Prefill of 256 tokens: reshape_and_cache_flash grid 256, block 512.
        let l = cache_write(256, 8, 128, &sm);
        assert_eq!((l.blocks, l.tile.n), (256, 512));
        // Decode with 4 and 3 requests: the index kernel's grids 32 and 24.
        assert_eq!(index(4, 4096, &sm).blocks, 32);
        assert_eq!(index(3, 4096, &sm).blocks, 24);
        // Input bookkeeping for 4 requests.
        for (name, blocks) in [
            ("_prepare_pos_seq_lens_kernel", 5),
            ("_combine_sampled_and_draft_tokens_kernel", 4),
            ("_gather_block_tables_kernel", 4),
            ("_compute_slot_mappings_kernel", 5),
            ("aten::fill_", 1),
            ("aten::arange", 1),
        ] {
            let l = prepare_inputs(name, 4, &sm).expect("known kernel");
            assert_eq!(l.blocks, blocks, "{name}");
            assert_eq!(l.provenance.confidence(), Confidence::Simplified);
        }
        assert!(prepare_inputs("nope", 4, &sm).is_err());
    }

    #[test]
    fn engine_group_quant_has_one_cta_per_32_groups() {
        let sm = sm();
        // 32 tokens: 32 groups per token over 4096 → 1024 groups; the
        // down-projection input (12288) has 96 per token → 3072.
        assert_eq!(vllm_group_quant(32, 4096, &sm).blocks, 32);
        assert_eq!(vllm_group_quant(32, 12288, &sm).blocks, 96);
        let l = flashinfer_quant(&sm);
        assert_eq!((l.blocks, l.slots, l.persistent), (1056, 1056, true));
    }

    #[test]
    fn engine_sampling_is_one_cta_per_request() {
        let l = sampling(7, 151_936, &sm());
        assert_eq!((l.blocks, l.per_wave), (7, vec![7]));
    }
}
