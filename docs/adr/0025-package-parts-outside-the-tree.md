# 0025 — Package parts outside the tree are web-side extras

Status: accepted
Date: 2026-10-13

## Context

Task 9.2d makes every visible part explain itself on hover and click. Four parts of the package are not nodes of the hardware tree: the substrate, the stiffener ring, the interposer and the micro-bump pads. They need a name, a definition and a panel, and `crossProblems` calls any `content/components/` file that no tree node's `contentId` names an orphan.

## Options

- **A — Add them to the tree:** four nodes under `package` in `data/`. They then count toward the tree's invariants, the plan's component lists and the "Inside" list, and a tree node wants specs and sources we only have as estimates (ADR 0021).
- **B — Extras list in the web:** a short fixed list (`scene/parts.ts`) of ids and names. Each gets a prose entry; `crossProblems` takes the list as a second set of legitimate ids. The panel and tooltip build a node-shaped value from it.
- **C — Exempt by front matter:** a flag in the entry (`part: true`) switches the orphan check off for that file. A typo in an id would then pass silently.

## Decision

**B.** The tree stays the model of the chip; the extras are scenery with words. The orphan check stays strict: a prose file must name a tree node's `contentId` or an id in the extras list, and every extra must have its file.

## Consequences

- The extras have no specs, count or children, so their panel shows prose only.
- Adding a fifth scenery part is a line in the list plus a file; forgetting either fails `pnpm test content`.
- `Placement` gains `infoId`: what hover and click explain. It is `nodeId` except for the extras.
