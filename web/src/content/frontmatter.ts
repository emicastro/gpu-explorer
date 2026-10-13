// Splits a content file into its YAML frontmatter and its Markdown body
// (design §7, ADR 0005).
import { parse } from 'yaml';

export interface Split {
  data: unknown;
  body: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;

/** Throws when the file has no frontmatter block or the YAML is malformed. */
export function splitFrontmatter(raw: string): Split {
  const m = FRONTMATTER.exec(raw);
  if (!m) throw new Error('no frontmatter block (the file must start with a --- line)');
  return { data: parse(m[1] ?? '') as unknown, body: (m[2] ?? '').trim() };
}
