//! Confidence, provenance and the serialized `Quantity` (design §3.1, R6).

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::units::Measure;

/// How much to trust a number. Ordered from best to worst, so the worst of
/// several inputs is their `max`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub enum Confidence {
    /// Taken from a public source for the pinned version.
    Documented,
    /// A deliberate approximation of something documented.
    Simplified,
    /// Calibrated or guessed; no source pins it down.
    Estimated,
}

/// The unit tag of a serialized value, always the SI base unit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub enum Unit {
    #[serde(rename = "B")]
    Bytes,
    #[serde(rename = "FLOP")]
    Flops,
    #[serde(rename = "s")]
    Seconds,
    #[serde(rename = "B/s")]
    BytesPerSec,
    #[serde(rename = "FLOP/s")]
    FlopsPerSec,
    #[serde(rename = "FLOP/B")]
    FlopsPerByte,
    #[serde(rename = "Hz")]
    Hertz,
    #[serde(rename = "FLOP/cycle")]
    FlopsPerCycle,
    #[serde(rename = "tok/s")]
    TokensPerSec,
    #[serde(rename = "count")]
    Count,
    /// Dimensionless: the SI unit "1".
    #[serde(rename = "1")]
    Ratio,
}

/// Where a number comes from: its confidence and the sources behind it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Provenance {
    confidence: Confidence,
    // A set, so joining the same input twice does not repeat its sources and
    // the serialized order is stable.
    sources: BTreeSet<String>,
}

impl Provenance {
    pub fn new<S: Into<String>>(
        confidence: Confidence,
        sources: impl IntoIterator<Item = S>,
    ) -> Self {
        Self {
            confidence,
            sources: sources.into_iter().map(Into::into).collect(),
        }
    }

    pub fn confidence(&self) -> Confidence {
        self.confidence
    }

    pub fn sources(&self) -> impl Iterator<Item = &str> {
        self.sources.iter().map(String::as_str)
    }

    /// The provenance of a value computed from `self` and `other`: the worse
    /// confidence of the two and the union of their sources.
    pub fn join(&self, other: &Provenance) -> Provenance {
        Provenance {
            confidence: self.confidence.max(other.confidence),
            sources: self.sources.union(&other.sources).cloned().collect(),
        }
    }
}

/// A number as it leaves the core: value, unit, confidence and sources.
///
/// Built from a unit newtype and a `Provenance`, or loaded from a data file
/// that states all four fields (ADR 0009), so there is no way to emit a
/// number without a unit and a confidence.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct Quantity {
    value: f64,
    unit: Unit,
    confidence: Confidence,
    sources: Vec<String>,
}

impl Quantity {
    pub fn new<M: Measure>(measure: M, provenance: Provenance) -> Self {
        Self {
            value: measure.value(),
            unit: M::UNIT,
            confidence: provenance.confidence,
            sources: provenance.sources.into_iter().collect(),
        }
    }

    pub fn value(&self) -> f64 {
        self.value
    }

    pub fn unit(&self) -> Unit {
        self.unit
    }

    pub fn confidence(&self) -> Confidence {
        self.confidence
    }

    pub fn sources(&self) -> &[String] {
        &self.sources
    }

    pub fn provenance(&self) -> Provenance {
        Provenance::new(self.confidence, &self.sources)
    }

    /// The value as `M`, or `None` if the unit is not `M`'s or the value is
    /// not valid for `M`.
    pub fn get<M: Measure>(&self) -> Option<M> {
        if self.unit == M::UNIT {
            M::from_value(self.value)
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::units::{Bytes, BytesPerSec, Count, Intensity};

    #[test]
    fn join_takes_the_worst_confidence() {
        use Confidence::*;
        let cases = [
            (Documented, Documented, Documented),
            (Documented, Simplified, Simplified),
            (Simplified, Documented, Simplified),
            (Documented, Estimated, Estimated),
            (Simplified, Estimated, Estimated),
            (Estimated, Documented, Estimated),
        ];
        for (a, b, want) in cases {
            let got = Provenance::new(a, ["x"]).join(&Provenance::new(b, ["y"]));
            assert_eq!(got.confidence(), want, "{a:?} ⊔ {b:?}");
        }
    }

    #[test]
    fn join_unions_sources_without_repeats() {
        let a = Provenance::new(Confidence::Documented, ["spec", "whitepaper"]);
        let b = Provenance::new(Confidence::Estimated, ["whitepaper", "bench"]);
        let joined = a.join(&b);
        assert_eq!(
            joined.sources().collect::<Vec<_>>(),
            ["bench", "spec", "whitepaper"]
        );
    }

    #[test]
    fn quantity_takes_unit_from_the_newtype() {
        let p = Provenance::new(Confidence::Documented, ["H100 datasheet"]);
        let q = Quantity::new(BytesPerSec(3.35e12), p);
        assert_eq!(q.value(), 3.35e12);
        assert_eq!(q.unit(), Unit::BytesPerSec);
        assert_eq!(q.confidence(), Confidence::Documented);
        assert_eq!(q.sources(), ["H100 datasheet"]);
    }

    #[test]
    fn quantity_serializes_to_the_wire_shape() {
        let p = Provenance::new(Confidence::Simplified, ["b", "a"]);
        let q = Quantity::new(Bytes(147_456.0), p);
        let json = serde_json::to_value(&q).expect("Quantity serializes");
        assert_eq!(
            json,
            serde_json::json!({
                "value": 147456.0,
                "unit": "B",
                "confidence": "simplified",
                "sources": ["a", "b"],
            })
        );
    }

    #[test]
    fn unit_and_confidence_tags() {
        let tag = |u: Unit| serde_json::to_value(u).expect("Unit serializes");
        assert_eq!(tag(Unit::Flops), "FLOP");
        assert_eq!(tag(Unit::Seconds), "s");
        assert_eq!(tag(Unit::FlopsPerSec), "FLOP/s");
        assert_eq!(tag(Unit::FlopsPerByte), "FLOP/B");
        assert_eq!(tag(Unit::TokensPerSec), "tok/s");
        assert_eq!(tag(Unit::Count), "count");
        assert_eq!(tag(Unit::Ratio), "1");
        let none = Provenance::new(Confidence::Estimated, Vec::<String>::new());
        let q = Quantity::new(Count(3), none.clone());
        assert_eq!(
            serde_json::to_value(&q).expect("serializes")["confidence"],
            "estimated"
        );
        let q = Quantity::new(Intensity(4.0), none);
        assert_eq!(
            serde_json::to_value(&q).expect("serializes")["unit"],
            "FLOP/B"
        );
    }
}
