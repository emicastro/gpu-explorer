//! The Triton kernels Inductor generates for norms, residuals, RoPE and
//! SiLU·mul (design §4.3).
//!
//! The grids follow the D14 trace (vLLM v0.31.0 on an RTX 3070), which
//! matches three rules in every captured step:
//! - a reduction over the hidden size (RMSNorm, per-token quantization)
//!   runs one 512-thread program per token;
//! - QK-norm + RoPE runs one 128-thread program per 4 head rows;
//! - SiLU·mul runs one 256-thread program per 512 output elements.
//!
//! Inductor's block sizes on H100 and the FP8 per-tensor variants, which
//! were not traced, are assumed to be the same.

use super::{Launch, Sm, Tile};
use crate::error::CoreError;
use crate::ops::{Op, OpKind, Shape};
use crate::quantity::{Confidence, Provenance};

const SOURCE: &str = "data/traces/vllm-0.31.0_qwen3-8b-3layers_rtx3070/kernels.json (D14): triton_red_fused_fused_add_rms_norm grid M, block 512, ≤ 36 registers, 64 B shared; triton_red_fused (QK-norm + RoPE) grid M·(n_q + n_kv)/4, block 128, 46 registers; triton_poi_fused_mul_silu_slice grid M·I/512, block 256, 16 registers. Ampere; assumed the same on H100";

/// QK-norm + RoPE: head rows per program.
const HEAD_ROWS: u64 = 4;
/// SiLU·mul: output elements per program.
const POINTWISE: u64 = 512;

/// Program shape: threads, registers per thread, shared memory.
struct Program {
    threads: u64,
    regs: u64,
    smem: u64,
}

const ROW: Program = Program {
    threads: 512,
    regs: 36,
    smem: 64,
};
const HEADS: Program = Program {
    threads: 128,
    regs: 46,
    smem: 0,
};
const POINT: Program = Program {
    threads: 256,
    regs: 16,
    smem: 0,
};

/// The launch of an Inductor kernel that fuses `ops`.
pub fn launch(ops: &[&Op], sm: &Sm) -> Result<Launch, CoreError> {
    let rows_of = |kinds: &[OpKind]| {
        ops.iter().find_map(|op| match op.shape {
            Shape::Rows { rows, cols } if kinds.contains(&op.id.kind) => Some((rows, cols)),
            _ => None,
        })
    };
    use OpKind::*;
    let (blocks, tile, program) = if let Some((rows, cols)) = rows_of(&[QkNorm]) {
        (rows.div_ceil(HEAD_ROWS), (HEAD_ROWS, cols), HEADS)
    } else if let Some((rows, cols)) = rows_of(&[
        InputNorm,
        PostAttnNorm,
        FinalNorm,
        QkvQuant,
        OQuant,
        GateUpQuant,
        DownQuant,
    ]) {
        (rows, (1, cols), ROW)
    } else if let Some((rows, cols)) = rows_of(&[SiluMul]) {
        ((rows * cols).div_ceil(POINTWISE), (1, POINTWISE), POINT)
    } else {
        let kinds: Vec<OpKind> = ops.iter().map(|op| op.id.kind).collect();
        return Err(CoreError::InvalidData(format!(
            "Inductor tiling: no rule for a kernel of {kinds:?}"
        )));
    };
    let per_sm = sm.ctas_per_sm(program.threads, program.regs, program.smem);
    Ok(Launch::new(
        blocks,
        Tile {
            m: tile.0 as u32,
            n: tile.1 as u32,
            k: 0,
        },
        sm.count * per_sm,
        false,
        Provenance::new(Confidence::Simplified, [SOURCE]),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hardware::hardware;
    use crate::ops::OpId;

    fn op(kind: OpKind, rows: u64, cols: u64) -> Op {
        Op {
            id: OpId {
                layer: Some(0),
                kind,
            },
            shape: Shape::Rows { rows, cols },
        }
    }

    #[test]
    fn gemm_tiling_inductor_grids_match_the_trace() {
        // The trace's decode step of 4 tokens: grids 4, 40 and 96.
        let sm = Sm::new(&hardware("h100-sxm").expect("valid preset")).expect("sm limits");
        let m = 4;
        let norm = [
            op(OpKind::AttnResidual, m, 4096),
            op(OpKind::PostAttnNorm, m, 4096),
        ];
        let l = launch(&norm.iter().collect::<Vec<_>>(), &sm).expect("launches");
        assert_eq!(l.blocks, 4);
        // 512 threads × 36 registers: 3 CTAs per SM.
        assert_eq!(l.slots, 3 * 132);
        assert!(!l.persistent);

        let qk = [
            op(OpKind::QkNorm, m * 40, 128),
            op(OpKind::Rope, m * 40, 128),
        ];
        let l = launch(&qk.iter().collect::<Vec<_>>(), &sm).expect("launches");
        assert_eq!(l.blocks, 40);
        assert_eq!(l.tile, Tile { m: 4, n: 128, k: 0 });

        let silu = [op(OpKind::SiluMul, m, 12288)];
        let l = launch(&silu.iter().collect::<Vec<_>>(), &sm).expect("launches");
        assert_eq!(l.blocks, 96);

        // The prefill step of 256 tokens: 256, 2560 and 6144.
        let silu = [op(OpKind::SiluMul, 256, 12288)];
        let l = launch(&silu.iter().collect::<Vec<_>>(), &sm).expect("launches");
        assert_eq!(l.blocks, 6144);
        assert_eq!(l.provenance.confidence(), Confidence::Simplified);

        let none = [op(OpKind::Rope, 1, 128)];
        assert!(launch(&none.iter().collect::<Vec<_>>(), &sm).is_err());
    }
}
