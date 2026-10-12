# 0018 — Fixed labels per part kind, and a staged data flow on visible paths

Status: accepted
Date: 2026-10-12

## Context

After task 4.5, the user reviewed screenshots of both levels and could not read them:

- **Nothing is named.** Parts differ only by color. The component panel (5.2) and the tooltips on the 3D (8.2) are tasks away.
- **The data flow reads as a cloud.** The flow of 4.4 (design §6.6, ADR 0016) sends particles along all 80 (controller, GPC) pairs, with phases spread evenly over the loop and no drawn path. No direction shows, and nothing in the scene says which stop (HBM, L2, SM) the bytes are at. Since 4.5 the SM tiles cover the GPC, so the particles vanish into a GPC instead of landing anywhere.

Constraints: ADR 0017 keeps raycasting to the parts a click acts on, and holds the frame budget (≤ 200 draw calls). Visible text is in English (R17). Counts shown must be the tree's (R8).

## Options

Labels:

- **A — DOM labels anchored in 3D:** one fixed label per part kind at a chosen part, with the count from the layout. No draw calls, no raycast, and plain text that e2e can read.
- **B — SDF text in the scene:** drei `<Text>`. It needs a font file (fetched or shipped) and adds a draw call per label.
- **C — names on hover:** needs raycasting on parts no click acts on (against ADR 0017), and overlaps the tooltips of 8.2.

Flow:

- **D — keep continuous streams:** the status quo of §6.6, maybe with fewer routes.
- **E — staged flow on visible paths:** draw the shared legs as faint lines, move the particles in waves so a whole pulse is on one leg at a time, highlight the current leg in the label and in the scene, and end each particle on an enabled SM.

## Decision

**A and E.** Both were the user's picks after reviewing the screenshots. A names every kind for the cost of a few DOM nodes. E turns "where are the bytes now" into something the scene shows, which is the point of the flow (R11). D can't show a stage, because with phases spread over the loop every leg is busy all the time.

## Decision mechanics

- **Labels.** `scene/labels.ts` is a pure function from a level's placements to labels: a name, the count of that kind and the disabled ones (`SM ×132 (+12 off)`), and an anchor part. Kinds that don't help reading (micro-bumps, the stiffener) get none. Each level renders its labels into one DOM overlay next to the canvas (its own React root), and a frame callback projects each anchor to the screen. Not one drei `<Html>` per label: each of those is a React root, and under StrictMode the first one came up empty and unmounting them threw `removeChild` errors. The overlay never takes pointer events, so a click through a label still reaches the die. Labels stay mounted and show only while the camera is settled on their level. The level you are inside has no label of its own.
- **Paths.** The visible legs are the shared trunks: controller → L2 half (one per active controller) and L2 half → a hub above each GPC (two halves × eight GPCs). One `lineSegments`, one draw call. Particles follow these lines with a small spread, then fan out from the hub down onto one enabled SM each.
- **Waves.** One clock for the whole flow. Each particle's phase is jittered by a small spread around the wave, so a pulse travels as a cluster. The current leg is a pure function of the clock (`legAt`). The DOM label highlights the leg's two stops, and the die-level labels of those stops light up.
- **Animation state.** The current leg lives in a tiny store of its own (`flow/stage.ts`), written only when the leg changes (three times a loop), not in the app store: it is animation state, not app state, and task 6.2's playhead will drive it.
- The bytes and the particle counts don't change: same streams, same log scale (§6.6).

## Consequences

- Both levels say what each part is and how many there are. The labels are the anchor 8.2's tooltips can hang from later, and 5.2's panel opens from the same parts.
- The flow reads as a sequence: out of HBM, into L2, out to the SMs. The trade-off is that the loop now shows one leg at a time instead of the steady state. The label keeps the exact bytes.
- The 80 routes stay as data (every active controller reaches every GPC); only 26 lines are drawn.
- Task 5.3 narrows the landing SMs to the ones the wave occupies, using the same "end on an SM" step.
