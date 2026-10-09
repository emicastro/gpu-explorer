#!/usr/bin/env bash
# Builds crates/wasm into an ES module in web/src/wasm/ (ADR 0003).
# The wasm-bindgen CLI must match the exact version pinned in crates/wasm/Cargo.toml.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

pin="$(sed -nE 's/^wasm-bindgen = "=([0-9]+\.[0-9]+\.[0-9]+)".*/\1/p' crates/wasm/Cargo.toml)"
if [[ -z $pin ]]; then
  echo "build-wasm: crates/wasm/Cargo.toml has no exact wasm-bindgen pin (wasm-bindgen = \"=X.Y.Z\")" >&2
  exit 1
fi

install="cargo install wasm-bindgen-cli --version $pin --locked"
if ! command -v wasm-bindgen >/dev/null; then
  echo "build-wasm: wasm-bindgen CLI not found. Install it with:" >&2
  echo "  $install" >&2
  exit 1
fi
have="$(wasm-bindgen --version | awk '{print $2}')"
if [[ $have != "$pin" ]]; then
  echo "build-wasm: wasm-bindgen CLI is $have but the crate pins $pin. Install the pinned version with:" >&2
  echo "  $install" >&2
  exit 1
fi

cargo build -p gpuviz-wasm --target wasm32-unknown-unknown --release

out=web/src/wasm
rm -rf "$out"
wasm-bindgen --target web --out-dir "$out" \
  "${CARGO_TARGET_DIR:-target}/wasm32-unknown-unknown/release/gpuviz_wasm.wasm"
echo "build-wasm: wrote $out"
