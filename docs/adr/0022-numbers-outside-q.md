# 0022 — Numbers outside `<Q>`: scene labels, presentation numbers and the sources popover

Status: accepted
Date: 2026-10-13

## Context

R16 says every number in the UI shows its confidence and, on request, its sources. Design §6.9 says this is done by `<Q value={Quantity} />`, the only component that renders numbers, with an ESLint rule that bans rendering a `number` in JSX anywhere else. Task 7.4 builds both. By then the UI had grown three kinds of numbers that §6.9 did not foresee:

- **Counts in the 3D labels** (`scene/labels.ts`, ADR 0018): `SM ×132 (+12 off)`, `TPC ×9`. They come from the hardware tree's `count` and `enabled` quantities, through the placements, and lose their confidence on the way. They are not all `documented`: how the TPCs are spread over the GPCs is `simplified` (task 2.2). The label overlay never takes pointer events, so a click through a label still reaches the part below it (ADR 0018).
- **Numbers that claim nothing about the hardware or the model:**
  - the roofline's axis ticks;
  - the playhead's axis seconds and the speed multipliers;
  - the knob values, which the user typed;
  - ordinals such as `layer 5`, `wave 2 of 3` and `3 of 4`.

  None of them has a source or a confidence to show.
- **Numbers the front derived from quantities:** the roofline's FLOP/s per kernel was `flops / time` computed in the front, and the HBM bar's `gb()` reformats `memory.*` quantities into a string. The rule cannot see either, because a string built from a number is no longer a `number`. The attained FLOP/s now comes from the core as `KernelPlan.attained`, a `Quantity` whose confidence is the worse of the FLOPs' and the time's.

§6.9 also says the sources open "with the same tooltip system as the glossary". That system is task 8.2, which comes after 7.4.

## Options

**1. Confidence in the 3D labels**

- **A — a confidence dot on the label; sources in the component panel:** the label shows the worst confidence of the nodes it counts. Clicking the part opens the component panel (task 5.2), which shows the same count through `<Q>`, sources included. ADR 0018 stands.
- **B — the count is a pointer target:** only the count chip takes pointer events and opens the sources on hover. This reverses part of ADR 0018, and a click on the chip no longer reaches the part beneath it.
- **C — no counts in the labels:** the counts move to the panel. Task 4.6 added the counts so a level can be read at a glance, and they have tests.

**2. Numbers that are not quantities**

- **A — an explicit `<Num>` for presentation numbers:** a second component the lint rule allows, with no confidence mark, only for the kinds listed under Context. Anything the core computes or a data file states is a `Quantity` and goes through `<Q>`.
- **B — synthetic quantities:** wrap ticks, seconds and knob values in a `Quantity` so that `<Q>` is the only path. It would have to choose a confidence: an axis tick is neither `documented` nor `estimated`, so the mark would mislead.
- **C — `eslint-disable` comments at each site:** no new component. Every exception needs its own justification, and nothing distinguishes a real exception from a missed migration.

**3. The sources popover before task 8.2**

- **A — a minimal popover inside `<Q>` now:** it opens on hover or focus and closes on Escape or blur. Task 8.2 swaps its internals for the tooltip stack without changing `<Q>`'s props.
- **B — the native `title`:** no code, but it does not open on focus, and R16 asks for focus.
- **C — move task 8.2 ahead of 7.4:** the tooltip stack comes first and `<Q>` uses it from the start. The stack is designed around glossary content (8.1) that does not exist yet.

## Decision

**1A, 2A and 3A.**

- **1A** keeps the confidence visible where the number is, and puts the sources one click away, through the panel the click already opens. It also leaves ADR 0018's click-through intact, which the milestone e2e tests.
- **2A** puts the boundary in the code, where review can see it: `<Num>` means "this number claims nothing". A synthetic confidence would teach the wrong thing, and scattered disables are invisible.
- **3A** meets R16 now, without building the tooltip stack ahead of the content it was designed for.

## Decision mechanics

- **Label confidence.** Each `SceneLabel` gains `confidence: Confidence`. It is the worst of the `count` and `enabled` confidences on the tree path from the level's node down to each counted placement's node (`Placement.nodeId`). The path matters, because an SM's own `count` (2 per TPC) is `documented`, but whether it is on comes from its TPC's `enabled`, which is `simplified`. Uncounted labels have none. The overlay renders the confidence as the same dot `<Q>` uses, through a shared class, with no pointer events. The panel's counts (`countText` in `panel/facts.ts`) go through `<Q>`.
- **`<Num>`.** `<Num value={number} />` takes an optional format, and its doc comment lists the allowed kinds. It is used for axis ticks, axis seconds, speeds, knob values and ordinals. Kernel and layer labels that hold an ordinal render it through `<Num>` or leave it out.
- **Config values.** A number read from a model's `config` (for example the KV heads in the split-KV lesson) becomes a `Quantity` with the model file's `provenance`, as ADR 0010 says. One helper builds it, and it is the only place the front builds a `Quantity`.
- **Formatting belongs to `<Q>`.** `formatQuantity` and the byte formatters are called only inside `<Q>` and `<Num>`. `<Q>` takes a compact variant for tight spots (the HBM legend, the roofline's tooltips). `gb()` goes away.
- **The lint rule** is a local, type-aware rule in the ESLint config. In JSX children, it flags:
  - a `number`- or `bigint`-typed expression;
  - a string-typed expression computed from a number-typed operand: a template literal with a number-typed interpolation, or a call with a number-typed argument or receiver (`gb(bytes)`, `x.toFixed(1)`, `String(n)`).

  The modules of `<Q>` and `<Num>` are exempt. Attributes are not checked: `style`, SVG geometry and `aria-*` carry numbers that are not visible text, and an ordinal in a `title` (`layer 5`) is fine.
- **Titles.** Quantities leave `title` attributes, by review rather than by the rule. Where a hover showed one (the HBM segments), the same number appears through `<Q>` in the element's text or legend.

## Consequences

- R16 holds for every visible number, and one grep for `<Num` lists every number that claims nothing.
- The 3D labels tell `documented` counts from `simplified` ones. Their sources are a click away, in the panel, not on hover.
- The die's `SM ×132 (+12 off)` reads `simplified`, even though 132 and 144 are `documented`, because the label adds up the simplified split over the GPCs. It is the core's worst-of rule applied honestly. If it misleads in review, the fix is to take a documented total from the level node's specs, not to relax the rule.
- The lint rule depends on types, so it runs only under typed linting (already on: `strictTypeChecked`). It catches the common ways of formatting a number in JSX children, not every one: a helper that takes an object and returns a formatted string slips through, and so does a quantity in a `title`. Review has to catch those.
- Task 8.2 inherits a `<Q>` popover to fold into the tooltip stack. Its trigger timings (600 ms hover, pin on click or after 1.5 s) apply to `<Q>` from then on.
- The front still builds quantities in one place, the config helper, and nowhere else. Anything new that the UI shows has to come from the core.
