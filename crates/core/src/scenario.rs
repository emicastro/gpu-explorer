//! The scenario an inference step is evaluated for (brief §6.4; design §3.3).

use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::model::KvDtype;

/// The most tokens vLLM captures in a CUDA graph on H100 by default.
pub const GRAPH_MAX_TOKENS: u64 = 512;

/// Where the CUDA graph padding comes from (design §4.1).
pub const GRAPH_PADDING_SOURCE: &str = "vLLM v0.31.0 vllm/config/compilation.py: cudagraph_capture_sizes = [1, 2, 4] + range(8, 256, 8) + range(256, max_cudagraph_capture_size + 1, 16); vllm/v1/cudagraph_dispatcher.py: a step of up to max_cudagraph_capture_size tokens is padded to the next captured size, FULL for uniform decode and PIECEWISE otherwise; vllm/v1/worker/gpu_model_runner.py: the model runs on input_ids[:num_tokens_padded] and only hidden_states[logits_indices] reach the LM head; with a FULL graph (pad_attn) the attention metadata adds requests of zero query and KV length, and slot_mapping is padded with -1";

/// The CUDA graph size vLLM pads a step of `tokens` to, or `None` when no
/// graph holds it: `[1, 2, 4]`, then multiples of 8 up to 248, then of 16
/// up to 512.
pub fn graph_size(tokens: u64) -> Option<u64> {
    match tokens {
        0..=2 | 4 => Some(tokens),
        3 => Some(4),
        5..=255 => Some(tokens.next_multiple_of(8)),
        256..=GRAPH_MAX_TOKENS => Some(tokens.next_multiple_of(16)),
        _ => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub enum Phase {
    Prefill,
    Decode,
}

/// Weight format and the GEMM path vLLM runs for it (brief D8).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub enum Weights {
    Bf16,
    /// W8A8 with 128×128 weight blocks and 1×128 activation groups.
    Fp8Block,
    /// W8A8 with a per-tensor weight scale and per-token activation scales.
    Fp8Tensor,
    /// FP8 weights, BF16 activations and math.
    Fp8W8a16,
}

impl Weights {
    /// Both GEMM operands are FP8, so activations are quantized at run time.
    pub fn is_w8a8(self) -> bool {
        matches!(self, Weights::Fp8Block | Weights::Fp8Tensor)
    }
}

/// What `evaluate` takes from the UI (brief §6.4). The time mode is not
/// here: the plan carries both times.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct Scenario {
    pub phase: Phase,
    /// Per request, the KV length attention reads after this step's tokens
    /// are written. v1 sends them all equal (brief D9).
    pub contexts: Vec<u32>,
    /// Tokens each request adds this step: 1 in decode, the prompt length
    /// in prefill.
    pub new_tokens: u32,
    pub weights: Weights,
    pub kv: KvDtype,
}

impl Scenario {
    /// Requests in the batch, `B`.
    pub fn batch(&self) -> u64 {
        self.contexts.len() as u64
    }

    /// Rows of every activation matrix, `M = B · T`.
    pub fn tokens(&self) -> u64 {
        self.batch() * u64::from(self.new_tokens)
    }

    /// Rows the model's kernels run on: `M` padded to the CUDA graph vLLM
    /// replays the step from, or `M` itself when no graph holds the step.
    /// Attention, the KV write and the kernels outside the model (inputs,
    /// LM head, sampling) still see `M`.
    pub fn padded_tokens(&self) -> u64 {
        graph_size(self.tokens()).unwrap_or(self.tokens())
    }

    /// Requests in the attention metadata vLLM builds for the step. Decode
    /// replays a FULL graph, which pads them to the captured size with
    /// empty requests. Prefill runs attention outside its PIECEWISE graph,
    /// on the real batch.
    pub fn metadata_batch(&self) -> u64 {
        match self.phase {
            Phase::Decode => self.padded_tokens(),
            Phase::Prefill => self.batch(),
        }
    }

    pub fn validate(&self) -> Result<(), CoreError> {
        let invalid = |msg: &str| Err(CoreError::InvalidScenario(msg.to_owned()));
        if self.contexts.is_empty() {
            return invalid("the batch has no requests");
        }
        if self.new_tokens == 0 {
            return invalid("new_tokens must be at least 1");
        }
        if self.phase == Phase::Decode && self.new_tokens != 1 {
            return invalid("decode adds exactly one token per request");
        }
        if self.contexts.iter().any(|&s| s < self.new_tokens) {
            return invalid("a context is shorter than the tokens it adds");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode(batch: usize) -> Scenario {
        Scenario {
            phase: Phase::Decode,
            contexts: vec![8192; batch],
            new_tokens: 1,
            weights: Weights::Bf16,
            kv: KvDtype::Bf16,
        }
    }

    #[test]
    fn tokens_is_batch_times_new_tokens() {
        assert_eq!(decode(4).tokens(), 4);
        let prefill = Scenario {
            phase: Phase::Prefill,
            new_tokens: 512,
            ..decode(2)
        };
        assert_eq!(prefill.tokens(), 1024);
    }

    #[test]
    fn graph_padding_rounds_up_to_the_captured_sizes() {
        let sizes = [
            (1, 1),
            (2, 2),
            (3, 4),
            (5, 8),
            (25, 32),
            (248, 248),
            (249, 256),
        ];
        for (tokens, size) in sizes.into_iter().chain([(257, 272), (512, 512)]) {
            assert_eq!(graph_size(tokens), Some(size), "{tokens}");
        }
        assert_eq!(graph_size(513), None);
    }

    #[test]
    fn graph_padding_metadata_batch_pads_only_in_decode() {
        assert_eq!(decode(25).padded_tokens(), 32);
        assert_eq!(decode(25).metadata_batch(), 32);
        assert_eq!(decode(600).padded_tokens(), 600);
        let prefill = Scenario {
            phase: Phase::Prefill,
            new_tokens: 300,
            contexts: vec![300],
            ..decode(1)
        };
        assert_eq!(prefill.padded_tokens(), 304);
        assert_eq!(prefill.metadata_batch(), 1);
    }

    #[test]
    fn scenario_validation() {
        assert_eq!(decode(1).validate(), Ok(()));
        let bad = [
            decode(0),
            Scenario {
                new_tokens: 2,
                ..decode(1)
            },
            Scenario {
                phase: Phase::Prefill,
                new_tokens: 9000,
                ..decode(1)
            },
        ];
        for s in bad {
            assert!(
                matches!(s.validate(), Err(CoreError::InvalidScenario(_))),
                "{s:?}"
            );
        }
    }
}
