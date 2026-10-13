# 0021 — Real proportions on the package

Status: accepted
Date: 2026-10-12

## Context

`layoutPackage` (design §6.3) places the die, the six HBM sites, the interposer, the substrate and the stiffener by hand-picked numbers. They make a readable sketch, but it is far from the real package. Taking the die width as 1, the sketch has a substrate 3.33 wide where the real one is about 2.06, HBM stacks 0.33 × 0.50 where they are about 0.32 × 0.36, a column of three stacks 1.76 times the die's depth where it is about 1.2, and a gap of 0.25 between the die and the HBM where the real gap is under 0.03. The user wants the package as close to the real thing as possible.

What the sources give:

- **Die area:** 814 mm², `documented` (NVIDIA Hopper whitepaper). No published side lengths.
- **Everything else:** no published drawing. The user's own Blender model of the board (outside the repo) was built from the ServeTheHome photos the brief already cites for the package (brief, references). Its dimensions are: package substrate 58.4 × 55.2 mm, HBM3 stacks 9.6 × 10.6 mm, a 0.75 mm gap between the die and each HBM column, 0.55 mm between stacks, and a stiffener opening of 52.4 × 38.6 mm. These are `estimated`.

The worry is readability: with a real gap, the die and the HBM almost touch.

## Options

- **A — real proportions, real gap:** every footprint and gap at its real size, scaled from millimetres.
- **B — real footprints, exaggerated gap:** the same, but the gap is about 3 times the real one, flagged `simplified`.
- **C — real proportions plus a hover highlight:** A, plus the chip under the pointer lights up so the click target is clear.
- **D — keep the sketch:** the status quo. It is readable, but it misteaches the package's shape.

## Decision

**A.** In the package view, the real gap is about 10 px of dark channel between glossy silicon and the HBM's metal, and the user's real-proportion renders read fine at that size. B misteaches the one thing this level shows, which is how tightly HBM sits against the die. C adds a feature that the panel and tooltips (tasks 5.2 and 8.2) already partly cover. If screenshots don't read, it can come back as its own task.

## Decision mechanics

- `layout.ts` keeps the package dimensions in millimetres, with their source, and converts them with one scale. The scale keeps the die 1.2 units wide, so `DIE_FRAME` keeps its scale and the die level keeps its size. The frame only drops to the thinner die's top.
- The die keeps the die plate's aspect (4.2 : 3.9) at 814 mm², so it is about 29.6 × 27.5 mm. The aspect is `simplified`.
- The HBM tops are flush with the die's top, as on the real part, where one cold plate covers both.
- Chips are about 3 times their real 0.78 mm thickness (`simplified`), so their sides still show. The old sketch had them about 10 times too thick.
- The interposer is the bounding box of the chips plus 1 mm (`simplified`). The micro-bump fringe shrinks below half the gap so neighbouring pads never overlap.
- The overview camera moves closer, so that the smaller package fills the view as before.

## Consequences

- The package level now teaches the real layout: a large die, six stacks pressed against it, and a package not much bigger than what it carries.
- Gaps are narrow click targets. Picking still works, because each chip is its own mesh, but clicking the gap misses both chips.
- The numbers not marked `documented` come from photos through the user's model. If a published drawing appears, the millimetre constants are the only thing to change.
- Labels sit closer together. The label layout is checked with screenshots, not with a test.
