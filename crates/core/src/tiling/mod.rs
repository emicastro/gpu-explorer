//! How each kernel is cut into tiles and spread over the SMs (design §4.3;
//! brief §7.2).

pub mod fa3;

use crate::quantity::Provenance;

/// The output tile one CTA computes, as `M × N × K` of its main MMA.
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
    /// CTAs resident at once: the persistent grid, or SMs × CTAs per SM.
    pub slots: u64,
    /// Tiles in each round of `slots`. The real scheduler hands tiles out
    /// one by one as CTAs finish, so rounds are an approximation for
    /// uneven tiles.
    pub per_wave: Vec<u32>,
    pub persistent: bool,
    pub provenance: Provenance,
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

    #[test]
    fn per_wave_fills_every_round_but_the_last() {
        assert_eq!(per_wave(104, 132), vec![104]);
        assert_eq!(per_wave(132, 132), vec![132]);
        assert_eq!(per_wave(256, 132), vec![132, 124]);
        assert_eq!(per_wave(0, 132), Vec::<u32>::new());
    }
}
