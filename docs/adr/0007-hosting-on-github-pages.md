# 0007 — Static hosting on GitHub Pages

Status: accepted
Date: 2026-10-09

## Context

The site is static, with no backend (brief D12, D15). D15 left two hosts open: GitHub Pages and Cloudflare Pages. The repo has no remote yet. The site serves an ES module and a `.wasm` file. It needs no special headers: no SharedArrayBuffer, so no COOP/COEP.

## Options

- **A — GitHub Pages,** deployed by a GitHub Actions workflow that runs the verify script and publishes `web/dist`.
- **B — Cloudflare Pages,** connected to the repo, with a build command and per-path header control.

## Decision

**A — GitHub Pages,** assuming the repo goes to GitHub. It needs no extra account, and the deploy runs in the same CI as the verify. We need none of Cloudflare's header control.

## Consequences

- The Vite `base` must match the Pages path (`/<repo>/`) unless a custom domain is used.
- Deploys are gated on the full verify passing in CI.
- If the repo ends up elsewhere, or we need headers, supersede with B. The build output is the same.
