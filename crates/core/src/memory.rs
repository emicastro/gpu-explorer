//! HBM occupancy: weights, KV cache, what the engine holds besides them, and
//! how many requests fit (design §4.5; brief §7.1).
//!
//! vLLM sizes its KV cache once at start-up: `gpu_memory_utilization` of
//! the capacity, minus the weights and the activation peak of a profile
//! run. Whatever the batch needs beyond that does not fit.

use serde::Serialize;

use crate::error::CoreError;
use crate::hardware::HwNode;
use crate::model::ModelConfig;
use crate::quantity::{Confidence, Provenance, Quantity};
use crate::roofline::scales;
use crate::scenario::{Scenario, Weights};
use crate::time::Calibration;
use crate::units::{Bytes, Count};

/// Tokens per KV block: a request holds its KV in whole blocks.
pub const BLOCK_TOKENS: u64 = 16;

const SOURCE_BLOCKS: &str = "vLLM v0.31.0 vllm/config/cache.py: DEFAULT_BLOCK_SIZE = 16; vllm/v1/core/kv_cache_manager.py allocates each request's KV in whole blocks";
const SOURCE_WEIGHTS: &str = "design §4.5: the four GEMM weights of each layer in the scenario's format with their FP32 scales; embeddings, LM head and norms in BF16";

/// Bytes of a BF16 element: every weight outside the four GEMMs.
const BF16: f64 = 2.0;
/// Bytes of an FP32 quantization scale.
const FP32: f64 = 4.0;

/// HBM occupancy of a scenario. Without overflow, `weights + kv +
/// activations + headroom + free = capacity`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct Memory {
    pub capacity: Quantity,
    pub weights: Quantity,
    /// The KV cache of every request in the batch.
    pub kv: Quantity,
    /// Peak activations and non-torch allocations (`activationMemory`).
    pub activations: Quantity,
    /// What `gpu_memory_utilization` leaves unused.
    pub headroom: Quantity,
    /// KV space left after this batch; zero on overflow.
    pub free: Quantity,
    /// Requests of the batch's longest context that fit.
    pub max_batch: Quantity,
    /// The batch's KV does not fit. Not an error: the UI shows it in red.
    pub overflow: bool,
}

/// The HBM occupancy of `scenario`.
pub fn memory(
    model: &ModelConfig,
    scenario: &Scenario,
    hw: &HwNode,
    cal: &Calibration,
) -> Result<Memory, CoreError> {
    scenario.validate()?;
    let package = hw
        .find("package")
        .ok_or_else(|| CoreError::InvalidData(format!("{}: no node \"package\"", hw.id)))?;
    let (capacity, capacity_prov) = package.spec::<Bytes>("memoryCapacity")?;
    let (util, util_prov) = cal.gpu_memory_utilization()?;
    let (activations, act_prov) = cal.activation_memory()?;
    let (weights, weights_prov) = weight_bytes(model, scenario.weights);

    let (per_token, kv_prov) = model.kv_bytes_per_token(scenario.kv);
    let kv_prov = kv_prov.join(&Provenance::new(Confidence::Documented, [SOURCE_BLOCKS]));
    let request =
        |context: u32| Count(u64::from(context).next_multiple_of(BLOCK_TOKENS)) * per_token;
    let kv: Bytes = scenario.contexts.iter().map(|&s| request(s)).sum();
    let longest = scenario.contexts.iter().copied().max().unwrap_or(0);

    let headroom = capacity * (1.0 - util.0);
    let budget = capacity - headroom - weights - activations;
    let budget_prov = capacity_prov
        .join(&util_prov)
        .join(&weights_prov)
        .join(&act_prov);
    let fits = (budget.0.max(0.0) / request(longest).0).floor();

    let free_prov = budget_prov.join(&kv_prov);
    Ok(Memory {
        capacity: Quantity::new(capacity, capacity_prov.clone()),
        weights: Quantity::new(weights, weights_prov),
        kv: Quantity::new(kv, kv_prov),
        activations: Quantity::new(activations, act_prov),
        headroom: Quantity::new(headroom, capacity_prov.join(&util_prov)),
        free: Quantity::new(Bytes((budget - kv).0.max(0.0)), free_prov.clone()),
        max_batch: Quantity::new(Count(fits as u64), free_prov),
        overflow: kv > budget,
    })
}

/// The weights in HBM: the four GEMM matrices of each layer in the format
/// of `weights`, with their scales, and everything else in BF16.
pub fn weight_bytes(model: &ModelConfig, weights: Weights) -> (Bytes, Provenance) {
    let c = &model.config;
    let (h, d, i) = (c.hidden_size, c.head_dim, c.intermediate_size);
    let (n_q, n_kv) = (c.num_attention_heads, c.num_key_value_heads);
    // `[n, k]` of QKV, O, gate+up and down.
    let gemms = [((n_q + 2 * n_kv) * d, h), (h, n_q * d), (2 * i, h), (h, i)];
    let v = &model.quantization_variants;
    let scheme = match weights {
        Weights::Bf16 => None,
        // W8A16 runs the block-scaled checkpoint through Marlin.
        Weights::Fp8Block | Weights::Fp8W8a16 => Some(&v.block),
        Weights::Fp8Tensor => Some(&v.per_tensor),
    };
    let per_layer: Bytes = gemms
        .iter()
        .map(|&(n, k)| match scheme {
            None => Bytes((n * k) as f64 * BF16),
            Some(s) => Bytes((n * k) as f64 + scales(s.weight_scale, n, k) as f64 * FP32),
        })
        .sum();
    let gemm_params: u64 = gemms.iter().map(|(n, k)| n * k).sum::<u64>() * c.num_hidden_layers;
    let (params, model_prov) = model.parameters();
    let rest = Count(params.total().0 - gemm_params) * Bytes(BF16);
    let mut prov = model_prov.join(&Provenance::new(Confidence::Documented, [SOURCE_WEIGHTS]));
    if let Some(s) = scheme {
        prov = prov.join(&Provenance::new(s.confidence, &s.sources));
    }
    (Count(c.num_hidden_layers) * per_layer + rest, prov)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hardware::{calibration, hardware};
    use crate::model::{KvDtype, model};
    use crate::scenario::Phase;

    const GIB: f64 = (1u64 << 30) as f64;

    fn run(batch: usize, context: u32, weights: Weights, kv: KvDtype) -> Memory {
        let scenario = Scenario {
            phase: Phase::Decode,
            contexts: vec![context; batch],
            new_tokens: 1,
            weights,
            kv,
        };
        memory(
            &model("qwen3-8b").expect("valid preset"),
            &scenario,
            &hardware("h100-sxm").expect("valid preset"),
            &calibration("h100-sxm").expect("valid preset"),
        )
        .expect("memory")
    }

    #[test]
    fn memory_bf16_weights_are_two_bytes_per_parameter() {
        let qwen = model("qwen3-8b").expect("valid preset");
        let (bytes, prov) = weight_bytes(&qwen, Weights::Bf16);
        assert_eq!(bytes, Bytes(8_190_735_360.0 * 2.0));
        assert_eq!(prov.confidence(), Confidence::Documented);
    }

    #[test]
    fn memory_fp8_weights_carry_their_scales() {
        let qwen = model("qwen3-8b").expect("valid preset");
        let (bf16, _) = weight_bytes(&qwen, Weights::Bf16);
        let (block, _) = weight_bytes(&qwen, Weights::Fp8Block);
        let (tensor, _) = weight_bytes(&qwen, Weights::Fp8Tensor);
        let (w8a16, _) = weight_bytes(&qwen, Weights::Fp8W8a16);
        // Per layer: QKV [6144, 4096], O [4096, 4096], gate+up [24576,
        // 4096], down [4096, 12288] = 192 937 984 parameters.
        let gemm = 36.0 * 192_937_984.0;
        // 128×128 blocks: 48·32 + 32·32 + 192·32 + 32·96 scales per layer.
        let block_scales = 36.0 * (1536.0 + 1024.0 + 6144.0 + 3072.0);
        assert_eq!(bf16.0 - block.0, gemm - block_scales * 4.0);
        assert_eq!(bf16.0 - tensor.0, gemm - 36.0 * 4.0 * 4.0);
        assert_eq!(w8a16, block);
    }

    #[test]
    fn memory_kv_of_a_32k_request_is_4_5_gib() {
        let m = run(1, 32_768, Weights::Bf16, KvDtype::Bf16);
        assert_eq!(m.kv.value(), 4.5 * GIB);
    }

    #[test]
    fn memory_kv_is_held_in_whole_blocks() {
        let m = run(2, 350, Weights::Bf16, KvDtype::Bf16);
        assert_eq!(m.kv.value(), 2.0 * 352.0 * 147_456.0);
    }

    #[test]
    fn memory_max_batch_is_what_fits_beside_the_weights() {
        let m = run(1, 32_768, Weights::Bf16, KvDtype::Bf16);
        // 80 GiB · 0.92 − 15.26 GiB of weights − 2 GiB of activations =
        // 56.34 GiB, over 4.5 GiB per request.
        let budget = 80.0 * GIB * 0.92 - 8_190_735_360.0 * 2.0 - 2.0 * GIB;
        assert_eq!(m.max_batch.value(), (budget / (4.5 * GIB)).floor());
        assert_eq!(m.max_batch.value(), 12.0);
        assert!(!m.overflow);
        assert_eq!(m.max_batch.confidence(), Confidence::Estimated);
    }

    #[test]
    fn memory_parts_add_up_to_the_capacity() {
        let m = run(4, 8192, Weights::Fp8Block, KvDtype::Fp8);
        let parts = [&m.weights, &m.kv, &m.activations, &m.headroom, &m.free];
        let sum: f64 = parts.iter().map(|q| q.value()).sum();
        assert!((sum - m.capacity.value()).abs() < 1.0, "{sum}");
    }

    #[test]
    fn memory_128k_overflows_at_batch_64_not_at_1() {
        let one = run(1, 131_072, Weights::Bf16, KvDtype::Bf16);
        assert!(!one.overflow);
        assert_eq!(one.max_batch.value(), 3.0);
        let many = run(64, 131_072, Weights::Bf16, KvDtype::Bf16);
        assert!(many.overflow);
        assert_eq!(many.free.value(), 0.0);
        assert_eq!(many.max_batch.value(), 3.0);
    }
}
