//! How each kernel is cut into tiles and spread over the SMs (design §4.3;
//! brief §7.2).

pub mod cutlass;
pub mod deepgemm;
pub mod fa3;
pub mod flashinfer;
pub mod inductor;

use crate::error::CoreError;
use crate::hardware::{HwNode, Level};
use crate::quantity::Provenance;
use crate::units::{Bytes, Count};

/// The output tile one CTA computes, as `M × N × K` of its main MMA. For a
/// swap-AB GEMM, `m` runs over the weight's rows and `n` over the tokens.
/// For an elementwise kernel, `m` rows of `n` elements and `k = 0`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tile {
    pub m: u32,
    pub n: u32,
    pub k: u32,
}

/// A kernel's grid, reduced to what the SM mapping needs.
#[derive(Debug, Clone, PartialEq)]
pub struct Launch {
    /// Work tiles. For a non-persistent grid, one per thread block.
    pub blocks: u64,
    pub tile: Tile,
    /// The most splits any request gets (FA3), or the split-K factor.
    pub splits: u32,
    /// CTAs resident at once: the persistent grid, or SMs × CTAs per SM
    /// (ADR 0013).
    pub slots: u64,
    /// Tiles in each round of `slots`. The real scheduler hands tiles out
    /// one by one as CTAs finish, so rounds are an approximation for
    /// uneven tiles.
    pub per_wave: Vec<u32>,
    pub persistent: bool,
    pub provenance: Provenance,
}

impl Launch {
    /// A grid of `blocks` tiles over `slots` resident CTAs, without splits.
    fn new(
        blocks: u64,
        tile: Tile,
        slots: u64,
        persistent: bool,
        provenance: Provenance,
    ) -> Launch {
        Launch {
            blocks,
            tile,
            splits: 1,
            slots,
            per_wave: per_wave(blocks, slots),
            persistent,
            provenance,
        }
    }
}

/// What one SM holds at once, and how many SMs are enabled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Sm {
    pub count: u64,
    pub threads: u64,
    pub blocks: u64,
    pub registers: u64,
    /// Shared memory one CTA can use.
    pub smem: u64,
}

impl Sm {
    pub fn new(hw: &HwNode) -> Result<Sm, CoreError> {
        let missing =
            |what: &str| CoreError::InvalidData(format!("{}: no node with {what}", hw.id));
        let sm = first(hw, &|n| n.level == Level::Sm).ok_or_else(|| missing("level sm"))?;
        let shared = first(sm, &|n| n.specs.contains_key("sharedMemoryMax"))
            .ok_or_else(|| missing("spec \"sharedMemoryMax\""))?;
        let count = |key| sm.spec::<Count>(key).map(|(c, _)| c.0);
        Ok(Sm {
            count: hw.enabled_total(|n| n.level == Level::Sm)?.0,
            threads: count("maxThreads")?,
            blocks: count("maxBlocks")?,
            registers: count("registers")?,
            smem: shared.spec::<Bytes>("sharedMemoryMax")?.0.0 as u64,
        })
    }

    /// CTAs of this shape that fit on one SM at once: the tightest of the
    /// thread, block, register and shared-memory limits. Register
    /// allocation granularity is ignored.
    pub fn ctas_per_sm(&self, threads: u64, regs_per_thread: u64, smem: u64) -> u64 {
        let by_regs = self.registers / (threads * regs_per_thread).max(1);
        let by_smem = self.smem.checked_div(smem).unwrap_or(u64::MAX);
        (self.threads / threads.max(1))
            .min(self.blocks)
            .min(by_regs)
            .min(by_smem)
    }
}

/// The first node in `node`'s subtree, depth first, that matches `pred`.
fn first<'a>(node: &'a HwNode, pred: &impl Fn(&HwNode) -> bool) -> Option<&'a HwNode> {
    if pred(node) {
        return Some(node);
    }
    node.children.iter().find_map(|c| first(c, pred))
}

/// `blocks` tiles dealt in rounds of `slots`: every round is full but the
/// last.
fn per_wave(blocks: u64, slots: u64) -> Vec<u32> {
    let waves = blocks.div_ceil(slots);
    (0..waves)
        .map(|w| (blocks - w * slots).min(slots) as u32)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hardware::hardware;

    #[test]
    fn per_wave_fills_every_round_but_the_last() {
        assert_eq!(per_wave(104, 132), vec![104]);
        assert_eq!(per_wave(132, 132), vec![132]);
        assert_eq!(per_wave(256, 132), vec![132, 124]);
        assert_eq!(per_wave(0, 132), Vec::<u32>::new());
    }

    #[test]
    fn sm_limits_from_h100_data() {
        let sm = Sm::new(&hardware("h100-sxm").expect("valid preset")).expect("sm limits");
        assert_eq!(
            sm,
            Sm {
                count: 132,
                threads: 2048,
                blocks: 32,
                registers: 65536,
                smem: 233_472,
            }
        );
        // 512 threads × 36 registers: registers allow 3, threads 4.
        assert_eq!(sm.ctas_per_sm(512, 36, 64), 3);
        // 128 threads × 46 registers: 11 by registers, 16 by threads.
        assert_eq!(sm.ctas_per_sm(128, 46, 0), 11);
        // Shared memory binds a 120 KB CTA to 1.
        assert_eq!(sm.ctas_per_sm(256, 64, 120_000), 1);
    }
}
