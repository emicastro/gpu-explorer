//! Analytical model of one LLM inference step on a GPU.
//!
//! Pure Rust with no I/O: hardware and model data are embedded at compile
//! time, and `evaluate` turns a scenario into a step plan (design §3–§4).

pub mod error;
pub mod hardware;
pub mod model;
pub mod quantity;
pub mod units;

/// Version of this crate, as declared in `Cargo.toml`.
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_semver() {
        let parts: Vec<&str> = version().split('.').collect();
        assert_eq!(parts.len(), 3, "{}", version());
        assert!(
            parts.iter().all(|p| p.parse::<u32>().is_ok()),
            "{}",
            version()
        );
    }
}
