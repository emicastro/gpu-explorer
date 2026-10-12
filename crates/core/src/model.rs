//! Model configs (design §3.2; ADR 0002, 0010).
//!
//! Each preset embeds the upstream `config.json` verbatim under `config`.
//! Every value read from it shares the file-level `provenance`.

use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::quantity::{Confidence, Provenance};
use crate::units::{Bytes, Count};

const QWEN3_8B: &str = include_str!("../../../data/models/qwen3-8b.json");

/// The model preset with this id, parsed and validated.
pub fn model(id: &str) -> Result<ModelConfig, CoreError> {
    match id {
        "qwen3-8b" => parse(id, QWEN3_8B),
        _ => Err(CoreError::UnknownId {
            kind: "model",
            id: id.to_owned(),
        }),
    }
}

/// Every model preset, in the order the UI lists them.
pub fn models() -> Result<Vec<ModelConfig>, CoreError> {
    ["qwen3-8b"].into_iter().map(model).collect()
}

fn parse(name: &str, src: &str) -> Result<ModelConfig, CoreError> {
    let model: ModelConfig =
        serde_json::from_str(src).map_err(|e| CoreError::InvalidData(format!("{name}: {e}")))?;
    model.validate()?;
    Ok(model)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct ModelConfig {
    pub id: String,
    pub name: String,
    /// Applies to every value in `config`.
    pub provenance: SourceInfo,
    pub config: HfConfig,
    /// Read by the core only: the UI picks a weight format, not a scheme.
    #[serde(skip_serializing)]
    #[cfg_attr(feature = "ts", ts(skip))]
    pub quantization_variants: QuantizationVariants,
}

/// Confidence and sources as written in a data file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct SourceInfo {
    pub confidence: Confidence,
    pub sources: Vec<String>,
}

impl SourceInfo {
    pub fn provenance(&self) -> Provenance {
        Provenance::new(self.confidence, &self.sources)
    }
}

impl From<&Provenance> for SourceInfo {
    fn from(p: &Provenance) -> Self {
        SourceInfo {
            confidence: p.confidence(),
            sources: p.sources().map(str::to_owned).collect(),
        }
    }
}

/// The upstream `config.json` of a dense Qwen3 model, field for field.
/// Every upstream field is listed, so a new one fails to load.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct HfConfig {
    pub architectures: Vec<String>,
    pub attention_bias: bool,
    pub attention_dropout: f64,
    pub bos_token_id: u64,
    pub eos_token_id: u64,
    pub head_dim: u64,
    pub hidden_act: String,
    pub hidden_size: u64,
    pub initializer_range: f64,
    pub intermediate_size: u64,
    pub max_position_embeddings: u64,
    pub max_window_layers: u64,
    pub model_type: String,
    pub num_attention_heads: u64,
    pub num_hidden_layers: u64,
    pub num_key_value_heads: u64,
    pub rms_norm_eps: f64,
    pub rope_scaling: Option<RopeScaling>,
    pub rope_theta: f64,
    pub sliding_window: Option<u64>,
    pub tie_word_embeddings: bool,
    pub torch_dtype: String,
    pub transformers_version: String,
    pub use_cache: bool,
    pub use_sliding_window: bool,
    pub vocab_size: u64,
}

/// The YaRN block the Qwen3 model card adds to extend context (brief D11).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct RopeScaling {
    pub rope_type: String,
    pub factor: f64,
    pub original_max_position_embeddings: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QuantizationVariants {
    pub block: Fp8Scheme,
    pub per_tensor: Fp8Scheme,
}

/// How a W8A8 FP8 variant scales weights and activations (brief D8).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Fp8Scheme {
    pub fmt: String,
    pub weight_scale: ScaleGranularity,
    pub activation_scheme: ActivationScheme,
    pub activation_scale: ScaleGranularity,
    pub confidence: Confidence,
    pub sources: Vec<String>,
}

/// The region of a tensor that shares one scale.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum ScaleGranularity {
    Tensor,
    Token,
    /// `[rows, cols]` of a weight block.
    Block {
        size: [u64; 2],
    },
    /// `[tokens, channels]` of an activation group.
    Group {
        size: [u64; 2],
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActivationScheme {
    /// Scales computed at run time from each tensor's values.
    Dynamic,
    Static,
}

/// Element type of the KV cache (brief D8).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub enum KvDtype {
    Bf16,
    Fp8,
}

impl KvDtype {
    pub fn element_bytes(self) -> Bytes {
        match self {
            KvDtype::Bf16 => Bytes(2.0),
            KvDtype::Fp8 => Bytes(1.0),
        }
    }
}

/// Parameter counts by where they sit in the model.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Parameters {
    /// The token-embedding table.
    pub embedding: Count,
    /// All decoder layers together.
    pub layers: Count,
    pub final_norm: Count,
    /// Zero when tied to the embedding table.
    pub lm_head: Count,
}

impl Parameters {
    pub fn total(&self) -> Count {
        self.embedding + self.layers + self.final_norm + self.lm_head
    }

    /// Qwen's "non-embedding" count: without the embedding table or the LM
    /// head.
    pub fn non_embedding(&self) -> Count {
        self.layers + self.final_norm
    }
}

impl ModelConfig {
    pub fn provenance(&self) -> Provenance {
        self.provenance.provenance()
    }

    /// Parameters from the shapes in `config` (brief §6.5): per layer, Q, K,
    /// V and O projections, the per-head QK-norm, the three MLP matrices and
    /// two RMSNorms. No biases (`attention_bias` is checked on load).
    pub fn parameters(&self) -> (Parameters, Provenance) {
        let c = &self.config;
        let (h, d, i) = (c.hidden_size, c.head_dim, c.intermediate_size);
        let (n_q, n_kv) = (c.num_attention_heads, c.num_key_value_heads);
        let attention = h * (n_q + 2 * n_kv) * d + n_q * d * h;
        let qk_norm = 2 * d;
        let mlp = 3 * h * i;
        let norms = 2 * h;
        let per_layer = attention + qk_norm + mlp + norms;
        let embedding = c.vocab_size * h;
        let params = Parameters {
            embedding: Count(embedding),
            layers: Count(c.num_hidden_layers * per_layer),
            final_norm: Count(h),
            lm_head: Count(if c.tie_word_embeddings { 0 } else { embedding }),
        };
        (params, self.provenance())
    }

    /// Parameters a decode step reads from HBM: every layer, the final norm
    /// and the LM head, but only one embedding row per request (brief §8).
    pub fn decode_parameters_read(&self, batch: Count) -> (Count, Provenance) {
        let (p, prov) = self.parameters();
        let head = if self.config.tie_word_embeddings {
            p.embedding
        } else {
            p.lm_head
        };
        let rows = batch * Count(self.config.hidden_size);
        (p.non_embedding() + head + rows, prov)
    }

    /// K and V for one token across all layers: `2 · layers · n_kv · d ·
    /// bytes` (brief §7.1).
    pub fn kv_bytes_per_token(&self, kv: KvDtype) -> (Bytes, Provenance) {
        let c = &self.config;
        let elements = Count(2 * c.num_hidden_layers * c.num_key_value_heads * c.head_dim);
        (elements * kv.element_bytes(), self.provenance())
    }

    /// The assumptions the formulas above rely on.
    fn validate(&self) -> Result<(), CoreError> {
        let c = &self.config;
        let checks = [
            (c.model_type == "qwen3", "model_type must be \"qwen3\""),
            (!c.attention_bias, "attention_bias is not modeled"),
            (
                !c.use_sliding_window && c.sliding_window.is_none(),
                "sliding-window attention is not modeled",
            ),
            (c.hidden_act == "silu", "hidden_act must be \"silu\""),
            (
                c.num_key_value_heads > 0
                    && c.num_attention_heads.is_multiple_of(c.num_key_value_heads),
                "num_attention_heads must be a multiple of num_key_value_heads",
            ),
        ];
        if let Some((_, msg)) = checks.iter().find(|(ok, _)| !ok) {
            return Err(self.invalid(msg));
        }
        let sources = [
            ("provenance", self.provenance.sources.as_slice()),
            ("block", self.quantization_variants.block.sources.as_slice()),
            (
                "per_tensor",
                self.quantization_variants.per_tensor.sources.as_slice(),
            ),
        ];
        if let Some((key, _)) = sources.iter().find(|(_, s)| s.is_empty()) {
            return Err(self.invalid(&format!("{key} has no source")));
        }
        Ok(())
    }

    fn invalid(&self, msg: &str) -> CoreError {
        CoreError::InvalidData(format!("{}: {msg}", self.id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn qwen3_8b() -> ModelConfig {
        model("qwen3-8b").expect("the embedded Qwen3-8B preset is valid")
    }

    #[test]
    fn qwen3_8b_parameters() {
        let (p, prov) = qwen3_8b().parameters();
        // Model card: 8.2 B total, 6.95 B non-embedding.
        assert_eq!(p.total(), Count(8_190_735_360));
        assert_eq!(p.non_embedding(), Count(6_946_075_648));
        assert_eq!(p.embedding, p.lm_head, "untied");
        assert_eq!(prov.confidence(), Confidence::Documented);
    }

    #[test]
    fn qwen3_8b_kv_per_token() {
        let m = qwen3_8b();
        let (bf16, _) = m.kv_bytes_per_token(KvDtype::Bf16);
        assert_eq!(bf16, Bytes(147_456.0)); // 144 KiB
        let (fp8, _) = m.kv_bytes_per_token(KvDtype::Fp8);
        assert_eq!(fp8, Bytes(73_728.0));
    }

    #[test]
    fn qwen3_8b_kv_of_a_32k_request() {
        let (per_token, _) = qwen3_8b().kv_bytes_per_token(KvDtype::Bf16);
        let gib = Bytes(f64::from(1u32 << 30));
        assert_eq!(Count(32_768) * per_token / gib, 4.5);
    }

    #[test]
    fn qwen3_8b_decode_reads_15_1_gb_of_bf16_weights() {
        let (params, _) = qwen3_8b().decode_parameters_read(Count(1));
        let bytes = params * Bytes(2.0);
        // Not the embedding table, only one row of it.
        assert_eq!(bytes, Bytes(15_136_819_200.0));
        assert!((bytes.0 / 15.1e9 - 1.0).abs() < 0.005, "{bytes:?}");
    }

    #[test]
    fn qwen3_8b_matches_brief_d2() {
        let c = qwen3_8b().config;
        assert_eq!(c.num_hidden_layers, 36);
        assert_eq!(c.hidden_size, 4096);
        assert_eq!((c.num_attention_heads, c.num_key_value_heads), (32, 8));
        assert_eq!(c.head_dim, 128);
        assert_eq!(c.intermediate_size, 12288);
        assert_eq!(c.vocab_size, 151_936);
        assert!(!c.tie_word_embeddings);
        assert_eq!(c.rope_theta, 1e6);
        assert_eq!(c.max_position_embeddings, 40960);
    }

    #[test]
    fn qwen3_8b_fp8_variants() {
        let q = qwen3_8b().quantization_variants;
        assert_eq!(
            q.block.weight_scale,
            ScaleGranularity::Block { size: [128, 128] }
        );
        assert_eq!(
            q.block.activation_scale,
            ScaleGranularity::Group { size: [1, 128] }
        );
        assert_eq!(q.block.activation_scheme, ActivationScheme::Dynamic);
        assert_eq!(q.per_tensor.weight_scale, ScaleGranularity::Tensor);
        assert_eq!(q.per_tensor.activation_scale, ScaleGranularity::Token);
    }

    #[test]
    fn unknown_id_is_an_error() {
        assert_eq!(
            model("llama"),
            Err(CoreError::UnknownId {
                kind: "model",
                id: "llama".to_owned()
            })
        );
    }

    /// The embedded file with one edit applied to its JSON.
    fn edited(edit: impl FnOnce(&mut serde_json::Value)) -> String {
        let mut v: serde_json::Value = serde_json::from_str(QWEN3_8B).expect("valid JSON");
        edit(&mut v);
        v.to_string()
    }

    fn rejects(src: &str, needle: &str) {
        match parse("test", src) {
            Err(CoreError::InvalidData(msg)) => assert!(msg.contains(needle), "{msg}"),
            other => panic!("expected InvalidData containing {needle:?}, got {other:?}"),
        }
    }

    #[test]
    fn loader_rejects_bad_data() {
        rejects(
            &edited(|v| v["config"]["num_experts"] = 128.into()),
            "unknown field",
        );
        rejects(&edited(|v| v["colour"] = "red".into()), "unknown field");
        rejects(
            &edited(|v| v["config"]["attention_bias"] = true.into()),
            "attention_bias",
        );
        rejects(
            &edited(|v| v["config"]["use_sliding_window"] = true.into()),
            "sliding-window",
        );
        rejects(
            &edited(|v| v["config"]["num_key_value_heads"] = 5.into()),
            "multiple",
        );
        rejects(
            &edited(|v| v["provenance"]["sources"] = serde_json::json!([])),
            "provenance has no source",
        );
        rejects(
            &edited(|v| v["quantization_variants"]["block"]["sources"] = serde_json::json!([])),
            "block has no source",
        );
    }

    #[test]
    fn yarn_rope_scaling_loads() {
        let src = edited(|v| {
            v["config"]["rope_scaling"] = serde_json::json!({
                "rope_type": "yarn",
                "factor": 4.0,
                "original_max_position_embeddings": 32768,
            })
        });
        let m = parse("test", &src).expect("loads");
        assert_eq!(m.config.rope_scaling.map(|r| r.factor), Some(4.0));
    }
}
