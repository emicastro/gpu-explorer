# 0004 — UI state in a zustand store

Status: accepted
Date: 2026-10-09

## Context

The 3D scene, the timeline, the roofline, the HBM bar and the knob panel share state: the current scenario, the `StepPlan`, the selected kernel or component, the playhead, and the hardware level. Selecting in one view highlights in all of them (brief §4.4). The playhead changes every frame. The R3F scene must read it inside `useFrame` without re-rendering the React tree 60 times a second.

## Options

- **A — zustand:** one store with selectors; `getState()` reads it outside React (inside `useFrame`).
- **B — React context + useReducer:** no dependency, but every consumer re-renders on any change unless the context is split, and per-frame reads go through refs.
- **C — jotai:** atoms, fine-grained subscriptions; per-frame reads outside React need `store.get` plumbing.

## Decision

**A — zustand.** The R3F docs recommend it, and it is from the same maintainers (pmndrs). Its selectors and its out-of-React `getState()` cover both access patterns, per frame and per event, with no extra plumbing.

## Consequences

- One store module, `web/src/state/`, split into slices: scenario, plan, selection, playback, navigation.
- Calling `evaluate` is a side effect of changing the scenario slice: when the scenario changes, `evaluate` runs and the plan slice is replaced. The plan is never mutated in place.
- Tests drive the store directly, with no rendering, for most UI logic.
