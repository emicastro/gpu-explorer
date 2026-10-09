//! Analytical model of one LLM inference step on a GPU.
//!
//! Pure Rust with no I/O: hardware and model data are embedded at compile
//! time, and `evaluate` turns a scenario into a step plan (design §3–§4).
