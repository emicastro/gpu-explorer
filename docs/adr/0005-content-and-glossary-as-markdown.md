# 0005 — Glossary and component prose as Markdown files with frontmatter

Status: accepted
Date: 2026-10-09

## Context

The glossary is data: `id`, name, short definition (the tooltip), long definition (the glossary page), related terms and sources (brief §5). Each hardware component has prose: what it does, what it stores, and what the LLM is doing there (§6.2). That prose lives apart from the numeric model. Both use explicit `[[term]]` markup, and a test must fail on an unknown term. The site is in English. Prose is the bulk of the content and will be edited often.

## Options

- **A — One Markdown file per entry, with YAML frontmatter,** under `content/glossary/` and `content/components/`. Frontmatter holds the structured fields; the body holds the long prose. Vite loads them with `import.meta.glob(..., { query: '?raw', eager: true })`.
- **B — One JSON (or YAML) file per collection,** with the prose as string fields.

## Decision

**A.** Long prose with links reads and diffs far better as Markdown than as escaped strings. Small per-entry files keep edits local. Loading them at build time keeps the site static.

## Consequences

- A small parser (frontmatter split + the `yaml` package) and a renderer for the `[[term]]` and `[[term|label]]` markup. The bodies use a deliberately small Markdown subset: paragraphs, emphasis, code, lists.
- A Vitest check walks every file and fails on unknown terms, missing required fields or orphan component ids, i.e. ids that are not in the hardware tree.
- The hardware tree (JSON, ADR 0002) refers to prose by `contentId`; the two never embed each other.
