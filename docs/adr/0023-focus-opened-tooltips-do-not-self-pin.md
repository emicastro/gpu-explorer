# 0023 — Focus-opened tooltips do not pin themselves

Status: accepted
Date: 2026-10-13

## Context

A tooltip pins itself 1.5 s after it opens (design §7), so a mouse user can move into its box. `useTip` starts that timer on any open, including the one from keyboard focus. A keyboard user who focuses a trigger, waits 1.5 s and presses Tab sees the tooltip stay open: blur only closes an unpinned tooltip. Under load the same race makes `panel.spec.ts` flaky.

## Options

- **A — Self-pin on every open:** keep the behaviour; tests and users must blur before 1.5 s.
- **B — Self-pin only on hover opens:** focus opens it unpinned and blur always closes it. Enter/click still pins.
- **C — Blur closes even a pinned tooltip:** a pinned tooltip would then vanish whenever focus leaves, which breaks click-to-pin for mouse users.

## Decision

**B.** The pin timer exists to cross the pointer gap into the box; focus has no such gap, because the box is inside the trigger's element and Tab goes into it without blurring the wrapper.

## Consequences

- Keyboard users get a tooltip that follows focus, with no time dependence.
- The test is deterministic: blur closes a focus-opened tooltip at any delay.
- A focus-opened tooltip is not pinned, so a pointer leaving later closes it after the grace period. Click or Enter pins it.
