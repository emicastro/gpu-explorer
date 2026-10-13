# 0026 — Learner-facing component entries: fixed sections in the body

Status: accepted
Date: 2026-10-13

## Context

Task 9.4 rewrites every `content/components/` entry for someone who is new to the hardware. Each entry should say what the part is, why it exists, and what it does during a decode step. Where it helps, it should also give an everyday analogy. The content test has to require these parts, so each one needs a place the parser can find.

Today an entry has two one-line frontmatter fields: `does`, which is the 3D tooltip and the panel's first line, and `stores`. After them comes a free-form body. ADR 0005 put structured short fields in the frontmatter and long prose in the Markdown body, because prose with `[[term]]` links reads and diffs badly as YAML strings. The new parts are each a paragraph or more, not one line.

## Options

- **A — More frontmatter fields:** `why`, `decode` and an optional `analogy` as YAML block scalars, with the body kept for the "what it is" text. Easy to check, but most of each entry becomes YAML strings. A plain scalar that starts with `[[` also parses as a YAML list.
- **B — Fixed headed sections in the body:** the body opens with the "what it is" text. After it come `## Why it exists`, `## In a decode step` and, optionally, `## Think of it as`. The loader splits the body on these headings, and an unknown or repeated heading is a problem.
- **C — Free body, checked by length or keywords:** no structure, only a minimum word count or required phrases. It can't really check that a section is there, and the panel can't label the parts.

## Decision

**B.** The prose stays Markdown, as ADR 0005 intended, and the headings give the test and the panel the same structure. `does` and `stores` stay in the frontmatter as the one-liners for the tooltip and the panel.

## Decision mechanics

- The heading split applies only to component entries. Glossary bodies keep the flat subset. Inside each section, the Markdown subset doesn't change.
- `ComponentEntry` replaces `body` with `intro`, `why`, `decode` and `analogy` (the last one `null` when there is none). The panel shows `intro` under the title, then the `stores` line, then each section under its heading, in a fixed order whatever the file's order. The tooltip keeps `does`. The panel stops showing `does`, because `intro` covers it at greater length.
- Problems: an empty intro, a missing `why` or `decode` section, an empty section, an unknown heading, and a repeated heading.
- The prose states no hardware quantities. Capacities, bandwidths, rates and counts are in the panel's specs through `<Q>` (R16, ADR 0022). The prose says "a few", "thousands", "several TB/s" at most. The one exception is a count that defines the part, like the pair of SMs in a TPC or the four sub-partitions of an SM.

## Consequences

- Each entry reads the same way, and a missing section fails `pnpm test content`.
- An author writing a new section heading has to add it to the loader's list, on purpose.
- The analogy stays optional. The test can't judge whether an analogy helps, so whether a part has one is decided in review.
