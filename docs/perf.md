# Performance budget (R12; design §6.7)

Budget per frame: **≤ 200 draw calls** and **≤ 500 000 triangles**, at every level.
`web/e2e/perf.spec.ts` walks the five levels through the store and fails past either number.

## Counts per level

Read from `renderInfo()` in the e2e run (SwiftShader, pixel ratio 1). Copied by hand from the
test's log; rerun `pnpm e2e perf` to refresh them.

| Level                   | Draw calls | Triangles |
| ----------------------- | ---------: | --------: |
| Package                 |         20 |     6 000 |
| Die                     |         16 |    68 720 |
| GPC (8 or 9 TPCs)       |          3 |     8 400 |
| SM                      |          7 |     2 100 |
| Sub-partition           |         16 |    23 100 |

The two GPC variants give the same counts: both draw nine TPC slabs, and the 8-TPC one greys out
the fused slab. The most draw calls are at the package (20, 10 % of the budget); the most
triangles are at the die (68 720, 14 %).

## Frame rate on an integrated GPU (manual)

The e2e runs on a software renderer, so its timings say nothing about fps. Measure by hand:

1. On a machine with an integrated GPU (laptop on battery is the honest case), from `web/`:
   `pnpm build --mode test && pnpm preview`. The test build is the production build plus
   `window.__gpuviz`, which the steps below read.
2. Open the URL in Chrome, window maximised. DevTools → ⋮ → More tools → Rendering → tick
   **Frame Rendering Stats**; the overlay shows the current fps.
3. Press play, so particles and the occupancy colors move.
4. At each level (click down, Escape up), wait ~10 s and note the average fps and the lowest you see.
5. Note the pixel ratio at each level: in the console, `__gpuviz.renderInfo().pixelRatio`. The
   scene drops it from 2 to 1 when fps falls (`PerformanceMonitor` in `web/src/scene/Scene.tsx`),
   so a 1 on a HiDPI screen means the frame rate was low enough for that to happen.

Target (R12): 60 fps on a modern integrated GPU. A level that stays under 60, or only reaches it
after the pixel ratio drops to 1, goes in a new task.

| Level         | fps (avg) | fps (min) | Pixel ratio |
| ------------- | --------: | --------: | ----------: |
| Package       |           |           |             |
| Die           |           |           |             |
| GPC           |           |           |             |
| SM            |           |           |             |
| Sub-partition |           |           |             |

Machine: _(CPU/GPU, browser and version, screen resolution, device pixel ratio)_
