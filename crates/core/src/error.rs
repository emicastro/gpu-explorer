//! The core's error type (design §3.3).

use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum CoreError {
    /// No preset with this id: `kind` is "hardware", "model", ….
    UnknownId { kind: &'static str, id: String },
    /// An embedded data file is malformed or breaks an invariant.
    InvalidData(String),
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CoreError::UnknownId { kind, id } => write!(f, "unknown {kind} id: {id:?}"),
            CoreError::InvalidData(msg) => write!(f, "invalid data: {msg}"),
        }
    }
}

impl std::error::Error for CoreError {}
