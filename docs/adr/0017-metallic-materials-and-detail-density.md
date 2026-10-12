# 0017 — Metallic materials and dense procedural detail, under the frame budget

Status: accepted
Date: 2026-10-12

## Context

Task 4.3 draws the package and the die as flat-colored boxes: one `meshStandardMaterial` per part, an ambient light and a directional light, nothing else (design §6.3). That meets brief D13 ("clean and stylized, color by function, not photorealistic"), but it reads as generic cubes, far from the visual reference the brief names: the video "How do Graphics Cards Work? Exploring GPU Architecture" (YouTube `h9Z4oGN89MU`).

What the user wants from that reference, in order: **metallic materials** and **detail density** (many small, real-looking parts at every level). Lighting and glow matter less. Fluidity and interactivity come before aesthetics: R12 (60 fps on a modern integrated GPU, ≤ 200 draw calls) stays the hard limit.

Other constraints:

- R19: all geometry is our own and procedural. No third-party models, images or HDRIs.
- R8: counts come from the hardware tree. A repeated shape that looks countable teaches a number, so it has to be the true one.
- The sibling fade (task 4.2) writes `material.opacity` on every material under the fading group.
- Levels 5.1 and below are not drawn yet. A style set now is inherited by them. A style set after them means redoing five levels.

## Options

- **A — keep flat colors:** the status quo; cheapest, but it misses the reference.
- **B — stylized PBR with procedural detail, no post-processing:** shared metallic/rough materials tinted by the function palette, an environment map built in code once, beveled shapes, instanced sub-parts whose counts come from the tree, and surface detail in runtime-generated textures. Adaptive resolution protects the frame rate.
- **C — B plus a post-processing chain:** add SSAO, bloom and tone mapping via `@react-three/postprocessing`.
- **D — baked assets:** model and render the parts offline (for example in Blender, as our own work) and ship GLB files with baked textures.

## Decision

**B.** It delivers the two things the user ranked first (metal and detail) at a cost the budget can absorb: the environment map is built once, instanced detail adds triangles but not draw calls, and textures are generated once. C adds full-screen passes every frame, which is the first thing to drop a frame on an integrated GPU, for glow and contact shading the user ranked last. It can come back later as an opt-in quality toggle with its own ADR. D breaks the "layout from the tree" rule (R8): baked assets can't follow the counts, so they can't follow a future GPU either. It also adds an asset pipeline.

## Decision mechanics

- **Materials.** One module, `web/src/scene/materials.ts`, builds every material. `palette.ts` stays the only place with colors. A small set of surface classes: substrate (dielectric, rough), silicon (dark, glossy), metal (high metalness: HBM lids, stiffener), contacts (gold-like), and function blocks (palette color over a semi-metallic base, so color by function survives). Disabled parts keep the dimmed color (R8).
- **Fading.** Shared materials are shared within one group only. Each group that fades owns its own set (a factory, not module-level singletons), so fading the package's siblings never touches the die.
- **Lighting.** An environment map rendered once in code (drei `<Environment frames={1}>` with `<Lightformer>` panels, no preset and no file). Plus a key light. No shadow maps, no per-frame environment.
- **Shape.** Big parts get bevels from one shared rounded-box geometry with low segment counts. Instanced parts reuse it.
- **Detail rule.** A repeated sub-shape that looks countable is geometry, and its count comes from the tree, for example the SM tiles inside each GPC on the die (disabled ones dimmed). If the tree doesn't have the count, either the tree gains it with a source and a confidence, or the detail becomes surface texture that doesn't read as countable (traces, micro-bumps, logic grain).
- **Surface textures.** Generated at startup from code (canvas or data textures, normal and roughness maps), cached and shared, at most 1024² each. No image files in the repo (R19).
- **Picking.** Detail meshes don't raycast. Only the parts a click can act on do, so hover and click cost the same as before.
- **Budgets** (checked in e2e through `window.__gpuviz.renderInfo()`, at every level drawn so far): ≤ 200 draw calls (R12) and ≤ 500 000 triangles per frame. Device pixel ratio is capped at 2 and drops toward 1 when drei's `<PerformanceMonitor>` sees the frame rate fall.

## Consequences

- The scene looks closer to the reference, and 5.1 inherits a ready-made vocabulary (materials, bevels, detail rule) instead of inventing one per level.
- Detail can't lie: the detail rule turns every countable-looking shape into a tested count, which means more layout tests and, now and then, a new field in the hardware tree.
- `window.__gpuviz.renderInfo()` arrives in task 4.5 instead of 9.1. Task 9.1 keeps the walk over all levels and the manual fps measurement.
- The fragment cost goes up (PBR + environment). The adaptive pixel ratio is the safety valve. If fps on integrated GPUs is still short, detail drops before frame rate does.
- No glow, no ambient occlusion. Revisiting that is a new ADR (option C as an opt-in).
- Brief D13 still holds ("stylized, not photorealistic"). This ADR makes "stylized" concrete: metallic and dense.
