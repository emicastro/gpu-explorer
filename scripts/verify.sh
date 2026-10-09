#!/usr/bin/env bash
# Full verify recipe (design §2). A step whose inputs do not exist yet is
# skipped with an explicit SKIP line, never silently.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

step() { printf '\n==> %s\n' "$*"; }
skip() { printf '\n==> SKIP: %s\n' "$*" >&2; }

step "cargo fmt --check"
cargo fmt --check
step "cargo clippy"
cargo clippy --all-targets -- -D warnings
step "cargo test"
cargo test

if grep -qE '^ts[[:space:]]*=' crates/core/Cargo.toml; then
  step "generated types drift check"
  cargo test -p gpuviz-core --features ts
  # status, not diff: a newly generated, untracked file is drift too.
  if [[ -n "$(git status --porcelain -- web/src/generated)" ]]; then
    git status --short -- web/src/generated >&2
    echo "verify: web/src/generated is out of date; commit the regenerated types" >&2
    exit 1
  fi
else
  skip "generated types drift check: gpuviz-core has no 'ts' feature yet (task 2.1)"
fi

step "build-wasm"
scripts/build-wasm.sh

cd web
step "pnpm install"
pnpm install --frozen-lockfile
step "pnpm typecheck"
pnpm typecheck
step "pnpm lint"
pnpm lint
step "pnpm test"
pnpm test
step "pnpm build"
pnpm build
step "pnpm e2e"
pnpm e2e

printf '\nverify: all steps passed\n'
