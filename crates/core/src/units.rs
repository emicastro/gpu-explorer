//! Physical units as newtypes (design §3.1).
//!
//! Every value is held in its SI base unit: bytes, FLOPs, seconds. Scaling to
//! KiB, TB/s, etc. is a display concern of the UI. Only operations with a
//! physical meaning are implemented, so mixing units is a compile error:
//!
//! ```compile_fail
//! use gpuviz_core::units::{Bytes, Flops};
//! let _ = Bytes(1.0) + Flops(1.0);
//! ```
//!
//! The same imports with matching units compile, so the example above fails
//! for the unit mismatch and not for a typo:
//!
//! ```
//! use gpuviz_core::units::{Bytes, BytesPerSec, Flops, Seconds};
//! assert_eq!(Bytes(1.0) + Bytes(2.0), Bytes(3.0));
//! assert_eq!(Flops(6.0) / Bytes(2.0), gpuviz_core::units::Intensity(3.0));
//! assert_eq!(Bytes(8.0) / BytesPerSec(2.0), Seconds(4.0));
//! ```

use std::iter::Sum;
use std::ops::{Add, Div, Mul, Sub};

use crate::quantity::Unit;

/// A value with a physical unit, convertible into a serialized `Quantity`.
pub trait Measure: Copy {
    /// The unit tag that goes on the wire.
    const UNIT: Unit;
    /// The value in the SI base unit.
    fn value(self) -> f64;
    /// The inverse of `value`; `None` when `v` is not a valid value of this
    /// type (a fractional or negative `Count`).
    fn from_value(v: f64) -> Option<Self>;
}

macro_rules! real_unit {
    ($(#[$doc:meta])* $name:ident, $unit:ident) => {
        $(#[$doc])*
        #[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Default)]
        pub struct $name(pub f64);

        impl Measure for $name {
            const UNIT: Unit = Unit::$unit;
            fn value(self) -> f64 {
                self.0
            }
            fn from_value(v: f64) -> Option<Self> {
                Some($name(v))
            }
        }

        impl Add for $name {
            type Output = $name;
            fn add(self, rhs: $name) -> $name {
                $name(self.0 + rhs.0)
            }
        }

        impl Sub for $name {
            type Output = $name;
            fn sub(self, rhs: $name) -> $name {
                $name(self.0 - rhs.0)
            }
        }

        /// Scaling by a dimensionless factor.
        impl Mul<f64> for $name {
            type Output = $name;
            fn mul(self, rhs: f64) -> $name {
                $name(self.0 * rhs)
            }
        }

        impl Mul<$name> for f64 {
            type Output = $name;
            fn mul(self, rhs: $name) -> $name {
                $name(self * rhs.0)
            }
        }

        impl Div<f64> for $name {
            type Output = $name;
            fn div(self, rhs: f64) -> $name {
                $name(self.0 / rhs)
            }
        }

        /// The ratio of two values in the same unit is dimensionless.
        impl Div for $name {
            type Output = f64;
            fn div(self, rhs: $name) -> f64 {
                self.0 / rhs.0
            }
        }

        impl Sum for $name {
            fn sum<I: Iterator<Item = $name>>(iter: I) -> $name {
                $name(iter.map(|x| x.0).sum())
            }
        }
    };
}

real_unit!(
    /// A number of bytes.
    Bytes, Bytes
);
real_unit!(
    /// A number of floating-point operations.
    Flops, Flops
);
real_unit!(
    /// A duration in seconds.
    Seconds, Seconds
);
real_unit!(
    /// A bandwidth in bytes per second.
    BytesPerSec, BytesPerSec
);
real_unit!(
    /// A throughput in FLOPs per second.
    FlopsPerSec, FlopsPerSec
);
real_unit!(
    /// Arithmetic intensity in FLOPs per byte.
    Intensity, FlopsPerByte
);
real_unit!(
    /// A clock frequency in cycles per second.
    Hertz, Hertz
);
real_unit!(
    /// Throughput per clock cycle: what one tensor core does each cycle.
    FlopsPerCycle, FlopsPerCycle
);
real_unit!(
    /// A dimensionless ratio, such as the fraction of a peak a kernel
    /// reaches. It scales a real unit with `*` on its `f64` (ADR 0014).
    Ratio, Ratio
);

/// `n` instances of a quantity: 132 SMs × shared memory per SM. Not for
/// `Intensity`, which is a ratio and does not add up across instances.
macro_rules! countable {
    ($($name:ident),*) => {$(
        impl Mul<$name> for Count {
            type Output = $name;
            fn mul(self, rhs: $name) -> $name {
                $name(self.as_f64() * rhs.0)
            }
        }
    )*};
}

countable!(
    Bytes,
    Flops,
    Seconds,
    BytesPerSec,
    FlopsPerSec,
    FlopsPerCycle
);

/// `lhs * rhs = out` and both divisions back.
macro_rules! product {
    ($lhs:ident * $rhs:ident = $out:ident) => {
        impl Mul<$rhs> for $lhs {
            type Output = $out;
            fn mul(self, rhs: $rhs) -> $out {
                $out(self.0 * rhs.0)
            }
        }

        impl Mul<$lhs> for $rhs {
            type Output = $out;
            fn mul(self, rhs: $lhs) -> $out {
                $out(self.0 * rhs.0)
            }
        }

        impl Div<$lhs> for $out {
            type Output = $rhs;
            fn div(self, rhs: $lhs) -> $rhs {
                $rhs(self.0 / rhs.0)
            }
        }

        impl Div<$rhs> for $out {
            type Output = $lhs;
            fn div(self, rhs: $rhs) -> $lhs {
                $lhs(self.0 / rhs.0)
            }
        }
    };
}

product!(BytesPerSec * Seconds = Bytes);
product!(FlopsPerSec * Seconds = Flops);
product!(Intensity * Bytes = Flops);
// Ridge point: peak FLOP/s over bandwidth; and the roofline's memory slope.
product!(Intensity * BytesPerSec = FlopsPerSec);
// Peak throughput: FLOPs per cycle at a clock.
product!(FlopsPerCycle * Hertz = FlopsPerSec);

/// A count of discrete things: SMs, blocks, tokens, layers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct Count(pub u64);

impl Count {
    /// The count as a float, for multiplying real-valued units. Exact below
    /// 2^53, far above any count this model produces.
    pub fn as_f64(self) -> f64 {
        self.0 as f64
    }
}

impl Measure for Count {
    const UNIT: Unit = Unit::Count;
    fn value(self) -> f64 {
        self.as_f64()
    }
    fn from_value(v: f64) -> Option<Self> {
        // The upper bound keeps the cast exact (see `as_f64`).
        let exact = v >= 0.0 && v.fract() == 0.0 && v < 2f64.powi(53);
        exact.then_some(Count(v as u64))
    }
}

impl Add for Count {
    type Output = Count;
    fn add(self, rhs: Count) -> Count {
        Count(self.0 + rhs.0)
    }
}

impl Mul for Count {
    type Output = Count;
    fn mul(self, rhs: Count) -> Count {
        Count(self.0 * rhs.0)
    }
}

impl Sum for Count {
    fn sum<I: Iterator<Item = Count>>(iter: I) -> Count {
        Count(iter.map(|x| x.0).sum())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transfer_time_is_bytes_over_bandwidth() {
        // 15.1 GB of weights at 3.35 TB/s.
        let t = Bytes(15.1e9) / BytesPerSec(3.35e12);
        assert!((t.0 - 4.507e-3).abs() < 1e-6, "{t:?}");
        assert_eq!(BytesPerSec(2.0) * Seconds(3.0), Bytes(6.0));
        assert_eq!(Bytes(6.0) / Seconds(3.0), BytesPerSec(2.0));
    }

    #[test]
    fn compute_time_is_flops_over_throughput() {
        assert_eq!(Flops(10.0) / FlopsPerSec(4.0), Seconds(2.5));
        assert_eq!(Seconds(2.5) * FlopsPerSec(4.0), Flops(10.0));
        assert_eq!(Flops(10.0) / Seconds(2.5), FlopsPerSec(4.0));
    }

    #[test]
    fn ridge_point_is_peak_over_bandwidth() {
        let ridge = FlopsPerSec(989e12) / BytesPerSec(3.35e12);
        assert!((ridge.0 - 295.2).abs() < 0.1, "{ridge:?}");
        assert_eq!(Intensity(4.0) * BytesPerSec(2.0), FlopsPerSec(8.0));
        assert_eq!(Intensity(4.0) * Bytes(2.0), Flops(8.0));
        assert_eq!(Flops(8.0) / Intensity(4.0), Bytes(2.0));
    }

    #[test]
    fn same_unit_arithmetic() {
        assert_eq!(Bytes(5.0) - Bytes(2.0), Bytes(3.0));
        assert_eq!(Bytes(5.0) * 2.0, Bytes(10.0));
        assert_eq!(2.0 * Bytes(5.0), Bytes(10.0));
        assert_eq!(Bytes(5.0) / 2.0, Bytes(2.5));
        assert_eq!(Bytes(5.0) / Bytes(2.0), 2.5);
        let total: Seconds = [Seconds(1.0), Seconds(2.0)].into_iter().sum();
        assert_eq!(total, Seconds(3.0));
    }

    #[test]
    fn counts_scale_real_units() {
        assert_eq!(
            Count(132) * Bytes(228.0 * 1024.0),
            Bytes(132.0 * 228.0 * 1024.0)
        );
        assert_eq!(Count(2) + Count(3), Count(5));
        assert_eq!(Count(2) * Count(3), Count(6));
        assert_eq!([Count(1), Count(2)].into_iter().sum::<Count>(), Count(3));
    }

    #[test]
    fn peak_is_flops_per_cycle_at_a_clock() {
        assert_eq!(FlopsPerCycle(2.0) * Hertz(3.0), FlopsPerSec(6.0));
        assert_eq!(FlopsPerSec(6.0) / Hertz(3.0), FlopsPerCycle(2.0));
        assert_eq!(Count(4) * FlopsPerCycle(2.0), FlopsPerCycle(8.0));
    }

    #[test]
    fn count_from_value_rejects_non_integers() {
        assert_eq!(Count::from_value(132.0), Some(Count(132)));
        assert_eq!(Count::from_value(0.0), Some(Count(0)));
        assert_eq!(Count::from_value(1.5), None);
        assert_eq!(Count::from_value(-1.0), None);
        assert_eq!(Count::from_value(f64::NAN), None);
        assert_eq!(Count::from_value(f64::INFINITY), None);
        assert_eq!(Bytes::from_value(1.5), Some(Bytes(1.5)));
    }

    #[test]
    fn measure_reports_base_unit() {
        assert_eq!(Bytes::UNIT, Unit::Bytes);
        assert_eq!(Intensity::UNIT, Unit::FlopsPerByte);
        assert_eq!(Count::UNIT, Unit::Count);
        assert_eq!(Ratio::UNIT, Unit::Ratio);
        assert_eq!(Count(7).value(), 7.0);
    }
}
