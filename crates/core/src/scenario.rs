//! The scenario an inference step is evaluated for (brief §6.4; design §3.3).

use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::model::KvDtype;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Prefill,
    Decode,
}

/// Weight format and the GEMM path vLLM runs for it (brief D8).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
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

#[derive(Debug, Clone, PartialEq, Eq)]
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
