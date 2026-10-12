# 0019 — Nested level frames, and the instance picked at each level

Status: accepted
Date: 2026-10-12

## Context

Task 5.1 adds the GPC, SM and sub-partition levels. Two forks:

1. **Which GPC did the user enter?** The path is a list of tree node ids (design §6.2), and the 8 GPCs are two nodes (`gpc-8tpc` ×6, `gpc-9tpc` ×2). The same goes for the 18 SMs of a GPC and the 4 sub-partitions of an SM. An id says what kind of thing it is, not which one.
2. **Where does a deeper level live in space?** The camera must fly into the part, and the die level already sits on the package's die through `DIE_FRAME` (ADR 0017).

## Options

Instance:

- **A — `picks: number[]` next to `path`:** same length, one instance index per level. The path stays tree ids.
- **B — encode it in the id (`gpc-8tpc#3`):** one list, but ids are no longer tree ids, and every consumer (breadcrumbs, the panel of 5.2, content lookup of 8.1) must strip it.
- **C — a separate `focus` in the store:** the machine can't keep it consistent with `back` and `goto`.

Space:

- **D — each level in world units, centered at the origin:** simple, but the swap on landing jumps in size and position, and the flight has no destination in the parent.
- **E — each level in its own normalized frame, placed over its tile in the parent:** the plate of level N covers the tile of level N+1 in level N's layout, so landing swaps the tile for the plate with no jump (as `DIE_FRAME` does). Camera poses are written once per level in local units and mapped to the world through the frame chain.

## Decision

**A and E.**

- `NavState` gains `picks`, with the invariant `picks.length === path.length`. `enter(id, instance = 0)`; `goto` keeps the picks of the prefix it shares with the current path and fills 0 elsewhere. Moving to the same node with a different pick is a move.
- `scene/frames.ts` (pure) gives the world frame of a level from the path and picks: `{ scale, position }`, composed down the chain. Each level's plate has width 4.2 in its own units, and its depth follows the tile it covers.
- The camera's near and far planes follow the camera-to-target distance. Four nested frames make the deepest level about 0.004 world units across, far below the default near plane.

## Consequences

- The state machine, the store and the tests of 4.2 change shape: `{ path, from }` becomes `{ path, picks, from }`.
- Per-level poses are in local units, so adding a level or changing a plate doesn't touch the others.
- Doubles as the key 5.2's panel needs (`path` + `picks` names one physical component).
