# Performance budget (R12; design §6.7)

Budget per frame: **≤ 200 draw calls** and **≤ 500 000 triangles**, at every level.
`web/e2e/perf.spec.ts` walks the five levels through the store and fails past either number.

## Counts per level

Read from `renderInfo()` in the e2e run (SwiftShader, pixel ratio 1):

| Level         | Draw calls | Triangles |
| ------------- | ---------: | --------: |
| Package       |         20 |     6 000 |
| Die           |         16 |    68 720 |
| GPC           |          3 |     8 400 |
| SM            |          7 |     2 100 |
| Sub-partition |         16 |    23 100 |

The worst case is the die, at 14 % of the triangle budget and 10 % of the draw-call budget.

## Frame rate on an integrated GPU (manual)

Not measured yet: the e2e runs on a software renderer, so its timings say nothing about fps.
To fill this in: `pnpm build && pnpm preview`, open the page on a machine with an integrated GPU,
and read fps from the browser's performance overlay (Chrome DevTools → Rendering → Frame Rendering Stats)
for ~10 s at each level, while the playhead is playing.

| Level         | fps (avg) | fps (min) |
| ------------- | --------: | --------: |
| Package       |           |           |
| Die           |           |           |
| GPC           |           |           |
| SM            |           |           |
| Sub-partition |           |           |

Machine: _(GPU, browser, resolution, pixel ratio)_
