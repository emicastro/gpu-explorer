//! The hardware tree (design §3.2; ADR 0002, 0008).
//!
//! Each preset is a JSON file embedded at compile time. Derivable numbers
//! (peak FLOP/s, ridge point) are not stored: they are computed here.

use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::quantity::{Provenance, Quantity};
use crate::time::Calibration;
use crate::units::{BytesPerSec, Count, FlopsPerCycle, FlopsPerSec, Hertz, Intensity, Measure};

const H100_SXM: &str = include_str!("../../../data/hardware/h100-sxm.json");

/// The tree of the hardware preset with this id, parsed and validated.
pub fn hardware(id: &str) -> Result<HwNode, CoreError> {
    preset(id).map(|p| p.tree)
}

/// How the software stack runs on the hardware preset with this id: the
/// parameters of the realistic time (design §4.4).
pub fn calibration(id: &str) -> Result<Calibration, CoreError> {
    preset(id).map(|p| p.calibration)
}

/// A hardware file: the component tree and, beside it, the calibration
/// (ADR 0014).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Preset {
    tree: HwNode,
    calibration: Calibration,
}

fn preset(id: &str) -> Result<Preset, CoreError> {
    match id {
        "h100-sxm" => parse(id, H100_SXM),
        _ => Err(CoreError::UnknownId {
            kind: "hardware",
            id: id.to_owned(),
        }),
    }
}

fn parse(name: &str, src: &str) -> Result<Preset, CoreError> {
    let preset: Preset =
        serde_json::from_str(src).map_err(|e| CoreError::InvalidData(format!("{name}: {e}")))?;
    preset.tree.validate()?;
    preset.calibration.validate()?;
    Ok(preset)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub enum Level {
    Board,
    Package,
    Die,
    Gpc,
    Tpc,
    Sm,
    Subpartition,
    Unit,
}

/// One component, repeated `count` times in its parent (ADR 0008).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct HwNode {
    /// Unique across the tree.
    pub id: String,
    pub name: String,
    pub level: Level,
    /// Instances in the parent; absent means 1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub count: Option<Quantity>,
    /// Instances that are enabled; absent means all of them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub enabled: Option<Quantity>,
    /// Values for one instance.
    #[serde(default)]
    pub specs: BTreeMap<String, Quantity>,
    /// The prose entry; variants of one component share it.
    pub content_id: String,
    #[serde(default)]
    pub children: Vec<HwNode>,
}

/// A tensor-core data type with a dense peak.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TensorPrecision {
    Bf16,
    Fp8,
}

impl TensorPrecision {
    fn spec_key(self) -> &'static str {
        match self {
            TensorPrecision::Bf16 => "bf16DensePerClock",
            TensorPrecision::Fp8 => "fp8DensePerClock",
        }
    }
}

impl HwNode {
    /// Instances in the parent.
    pub fn instances(&self) -> Result<Count, CoreError> {
        self.count_field("count", self.count.as_ref(), Count(1))
    }

    /// Enabled instances in the parent.
    pub fn enabled_instances(&self) -> Result<Count, CoreError> {
        self.count_field("enabled", self.enabled.as_ref(), self.instances()?)
    }

    fn count_field(
        &self,
        field: &str,
        q: Option<&Quantity>,
        default: Count,
    ) -> Result<Count, CoreError> {
        match q {
            None => Ok(default),
            Some(q) => q.get::<Count>().ok_or_else(|| {
                self.invalid(format!("{field} must be a whole number of \"count\""))
            }),
        }
    }

    /// A spec of one instance, checked to be in `M`'s unit.
    pub fn spec<M: Measure>(&self, key: &str) -> Result<(M, Provenance), CoreError> {
        let q = self
            .specs
            .get(key)
            .ok_or_else(|| self.invalid(format!("missing spec {key:?}")))?;
        let m = q.get::<M>().ok_or_else(|| {
            self.invalid(format!(
                "spec {key:?} is {} {:?}, expected {:?}",
                q.value(),
                q.unit(),
                M::UNIT
            ))
        })?;
        Ok((m, q.provenance()))
    }

    /// The node with this id in this subtree.
    pub fn find(&self, id: &str) -> Option<&HwNode> {
        if self.id == id {
            return Some(self);
        }
        self.children.iter().find_map(|c| c.find(id))
    }

    fn find_required(&self, id: &str) -> Result<&HwNode, CoreError> {
        self.find(id)
            .ok_or_else(|| CoreError::InvalidData(format!("{}: no node {id:?}", self.id)))
    }

    /// Physical instances of the matching nodes across the tree: the product
    /// of `count` along each path.
    pub fn total(&self, pred: impl Fn(&HwNode) -> bool) -> Result<Count, CoreError> {
        self.sum(false, &pred)
    }

    /// Enabled instances of the matching nodes: the product of `enabled`
    /// along each path, so the SMs of a disabled TPC do not count.
    pub fn enabled_total(&self, pred: impl Fn(&HwNode) -> bool) -> Result<Count, CoreError> {
        self.sum(true, &pred)
    }

    fn sum(&self, enabled: bool, pred: &impl Fn(&HwNode) -> bool) -> Result<Count, CoreError> {
        let mut total = Count(0);
        self.visit(enabled, Count(1), &mut |node, n| {
            if pred(node) {
                total = total + n;
            }
            Ok(())
        })?;
        Ok(total)
    }

    /// Calls `f` on every node with its number of instances in the tree.
    fn visit(
        &self,
        enabled: bool,
        parent: Count,
        f: &mut impl FnMut(&HwNode, Count) -> Result<(), CoreError>,
    ) -> Result<(), CoreError> {
        let own = if enabled {
            self.enabled_instances()?
        } else {
            self.instances()?
        };
        let here = parent * own;
        f(self, here)?;
        for child in &self.children {
            child.visit(enabled, here, f)?;
        }
        Ok(())
    }

    /// Dense tensor-core peak: Σ enabled tensor cores × FLOPs per cycle, at
    /// the die's tensor clock. The provenance of the counts is left out: the
    /// total (528 tensor cores) is documented even where the per-GPC split is
    /// `simplified`.
    pub fn peak_tensor(&self, p: TensorPrecision) -> Result<(FlopsPerSec, Provenance), CoreError> {
        let key = p.spec_key();
        let (clock, mut prov) = self.find_required("die")?.spec::<Hertz>("tensorClock")?;
        let mut per_cycle = FlopsPerCycle(0.0);
        let mut found = false;
        self.visit(true, Count(1), &mut |node, n| {
            if node.specs.contains_key(key) {
                let (f, fp) = node.spec::<FlopsPerCycle>(key)?;
                per_cycle = per_cycle + n * f;
                prov = prov.join(&fp);
                found = true;
            }
            Ok(())
        })?;
        if !found {
            return Err(CoreError::InvalidData(format!(
                "{}: no node has spec {key:?}",
                self.id
            )));
        }
        Ok((per_cycle * clock, prov))
    }

    pub fn hbm_bandwidth(&self) -> Result<(BytesPerSec, Provenance), CoreError> {
        self.find_required("package")?.spec("hbmBandwidth")
    }

    /// Intensity where the roofline turns from memory- to compute-bound.
    pub fn ridge(&self, p: TensorPrecision) -> Result<(Intensity, Provenance), CoreError> {
        let (peak, a) = self.peak_tensor(p)?;
        let (bw, b) = self.hbm_bandwidth()?;
        Ok((peak / bw, a.join(&b)))
    }

    /// Unique ids, valid counts, and a source on every value.
    fn validate(&self) -> Result<(), CoreError> {
        let mut ids = HashSet::new();
        self.validate_node(&mut ids)
    }

    fn validate_node<'a>(&'a self, ids: &mut HashSet<&'a str>) -> Result<(), CoreError> {
        if !ids.insert(&self.id) {
            return Err(self.invalid("duplicate id".to_owned()));
        }
        let (count, enabled) = (self.instances()?, self.enabled_instances()?);
        if enabled > count {
            return Err(self.invalid(format!("enabled {} > count {}", enabled.0, count.0)));
        }
        let fields = [
            ("count", self.count.as_ref()),
            ("enabled", self.enabled.as_ref()),
        ];
        let specs = self.specs.iter().map(|(k, q)| (k.as_str(), Some(q)));
        for (key, q) in fields.into_iter().chain(specs) {
            let Some(q) = q else { continue };
            if q.sources().is_empty() {
                return Err(self.invalid(format!("{key} has no source")));
            }
            if q.unit() == Count::UNIT && q.get::<Count>().is_none() {
                return Err(self.invalid(format!("{key} is not a whole number")));
            }
        }
        self.children.iter().try_for_each(|c| c.validate_node(ids))
    }

    fn invalid(&self, msg: String) -> CoreError {
        CoreError::InvalidData(format!("{}: {msg}", self.id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::quantity::Confidence;

    fn h100() -> HwNode {
        hardware("h100-sxm").expect("the embedded H100 preset is valid")
    }

    fn at(level: Level) -> impl Fn(&HwNode) -> bool {
        move |n| n.level == level
    }

    fn enabled(hw: &HwNode, pred: impl Fn(&HwNode) -> bool) -> Count {
        hw.enabled_total(pred).expect("valid counts")
    }

    fn total(hw: &HwNode, pred: impl Fn(&HwNode) -> bool) -> Count {
        hw.total(pred).expect("valid counts")
    }

    #[test]
    fn h100_counts_match_the_whitepaper() {
        let hw = h100();
        assert_eq!(enabled(&hw, at(Level::Gpc)), Count(8));
        assert_eq!(enabled(&hw, at(Level::Tpc)), Count(66));
        assert_eq!(enabled(&hw, at(Level::Sm)), Count(132));
        assert_eq!(total(&hw, at(Level::Tpc)), Count(72));
        assert_eq!(total(&hw, at(Level::Sm)), Count(144));
        let content = |id: &'static str| move |n: &HwNode| n.content_id == id;
        assert_eq!(enabled(&hw, content("tensor-core")), Count(528));
        assert_eq!(enabled(&hw, content("cuda-core")), Count(16896));
    }

    #[test]
    fn h100_memory_system() {
        let hw = h100();
        let id = |id: &'static str| move |n: &HwNode| n.id == id;
        assert_eq!(total(&hw, id("memory-controller")), Count(12));
        assert_eq!(enabled(&hw, id("memory-controller")), Count(10));
        assert_eq!(total(&hw, id("hbm-site")), Count(6));
        assert_eq!(enabled(&hw, id("hbm-site")), Count(5));
        assert_eq!(total(&hw, id("l2")), Count(2));

        // 5 enabled stacks hold the whole 80 GiB.
        let site = hw.find("hbm-site").expect("node exists");
        let (stack, _) = site.spec::<crate::units::Bytes>("capacity").expect("spec");
        let package = hw.find("package").expect("node exists");
        let (total, _) = package
            .spec::<crate::units::Bytes>("memoryCapacity")
            .expect("spec");
        assert_eq!(Count(5) * stack, total);
    }

    #[test]
    fn derived_peaks_and_ridge_points() {
        let hw = h100();
        let close = |got: f64, want: f64| (got / want - 1.0).abs() < 0.01;

        let (bf16, prov) = hw.peak_tensor(TensorPrecision::Bf16).expect("peak");
        assert!(close(bf16.0, 989e12), "{bf16:?}");
        // The clock is inferred, not published, so the peak cannot be
        // `documented`.
        assert_eq!(prov.confidence(), Confidence::Simplified);
        let (fp8, _) = hw.peak_tensor(TensorPrecision::Fp8).expect("peak");
        assert!(close(fp8.0, 1979e12), "{fp8:?}");

        let (ridge, _) = hw.ridge(TensorPrecision::Bf16).expect("ridge");
        assert!(close(ridge.0, 295.0), "{ridge:?}");
        let (ridge, _) = hw.ridge(TensorPrecision::Fp8).expect("ridge");
        assert!(close(ridge.0, 590.0), "{ridge:?}");
    }

    /// The two GPC variants differ only in ids, names and how many TPCs are
    /// enabled (ADR 0008): the SM below them must be identical.
    #[test]
    fn gpc_variants_share_the_sm_subtree() {
        fn strip_ids(v: &mut serde_json::Value) {
            if let Some(obj) = v.as_object_mut() {
                obj.remove("id");
                obj.values_mut().for_each(strip_ids);
            } else if let Some(arr) = v.as_array_mut() {
                arr.iter_mut().for_each(strip_ids);
            }
        }
        let hw = h100();
        let sm = |id: &str| {
            let mut v =
                serde_json::to_value(hw.find(id).expect("node exists")).expect("serializes");
            strip_ids(&mut v);
            v
        };
        assert_eq!(sm("gpc-8tpc/tpc/sm"), sm("gpc-9tpc/tpc/sm"));
    }

    #[test]
    fn unknown_id_is_an_error() {
        assert_eq!(
            hardware("b200"),
            Err(CoreError::UnknownId {
                kind: "hardware",
                id: "b200".to_owned()
            })
        );
    }

    fn leaf(extra: &str) -> String {
        format!(r#"{{"id": "x", "name": "X", "level": "unit", "contentId": "x"{extra}}}"#)
    }

    /// `tree` with the H100 calibration beside it.
    fn rejects(tree: &str, needle: &str) {
        let calibration = serde_json::to_string(&calibration("h100-sxm").expect("valid preset"))
            .expect("serializes");
        let src = format!(r#"{{"tree": {tree}, "calibration": {calibration}}}"#);
        match parse("test", &src) {
            Err(CoreError::InvalidData(msg)) => assert!(msg.contains(needle), "{msg}"),
            other => panic!("expected InvalidData containing {needle:?}, got {other:?}"),
        }
    }

    #[test]
    fn loader_rejects_bad_data() {
        let q = |v: &str, unit: &str, sources: &str| {
            format!(
                r#"{{"value": {v}, "unit": "{unit}", "confidence": "documented", "sources": [{sources}]}}"#
            )
        };
        rejects(&leaf(r#", "colour": "red""#), "unknown field");
        rejects(
            &leaf(&format!(r#", "count": {}"#, q("2", "count", ""))),
            "no source",
        );
        rejects(
            &leaf(&format!(r#", "count": {}"#, q("1.5", "count", r#""s""#))),
            "whole number",
        );
        rejects(
            &leaf(&format!(r#", "count": {}"#, q("2", "B", r#""s""#))),
            "whole number",
        );
        rejects(
            &leaf(&format!(
                r#", "count": {}, "enabled": {}"#,
                q("2", "count", r#""s""#),
                q("3", "count", r#""s""#)
            )),
            "enabled 3 > count 2",
        );
        rejects(
            &leaf(&format!(
                r#", "specs": {{"n": {}}}"#,
                q("0.5", "count", r#""s""#)
            )),
            "not a whole number",
        );
        let child = leaf("");
        rejects(
            &leaf(&format!(r#", "children": [{child}]"#)),
            "duplicate id",
        );
    }

    #[test]
    fn spec_checks_the_unit() {
        let hw = h100();
        let package = hw.find("package").expect("node exists");
        let err = package
            .spec::<Hertz>("hbmBandwidth")
            .expect_err("wrong unit");
        assert!(err.to_string().contains("expected Hertz"), "{err}");
        let err = package.spec::<Hertz>("nope").expect_err("missing");
        assert!(err.to_string().contains("missing spec"), "{err}");
    }
}
