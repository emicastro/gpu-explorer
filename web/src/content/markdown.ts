// The small Markdown subset of ADR 0005: paragraphs, lists, emphasis, code and
// the explicit `[[id]]` / `[[id|label]]` term links (R15). Pure; the React side
// is `Prose.tsx`.

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'strong'; children: Inline[] }
  /** A link to a glossary term; `label` is null when the term's own name shows. */
  | { kind: 'term'; id: string; label: string | null };

export type Block =
  | { kind: 'paragraph'; children: Inline[] }
  | { kind: 'list'; items: Inline[][] };

// Order matters: a term link and code are tried before the emphasis marks.
const INLINE = /\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]|`([^`]+)`|\*\*(.+?)\*\*|\*(.+?)\*/g;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of src.matchAll(INLINE)) {
    if (m.index > last) out.push({ kind: 'text', text: src.slice(last, m.index) });
    const [, term, label, code, strong, em] = m;
    if (term !== undefined) out.push({ kind: 'term', id: term.trim(), label: label?.trim() ?? null });
    else if (code !== undefined) out.push({ kind: 'code', text: code });
    else if (strong !== undefined) out.push({ kind: 'strong', children: parseInline(strong) });
    else if (em !== undefined) out.push({ kind: 'em', children: parseInline(em) });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ kind: 'text', text: src.slice(last) });
  return out;
}

const BULLET = /^\s*[-*]\s+(.*)$/;

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of src.split(/\r?\n\s*\r?\n/)) {
    const lines = chunk.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length === 0) continue;
    if (lines.every((l) => BULLET.test(l))) {
      blocks.push({ kind: 'list', items: lines.map((l) => parseInline(BULLET.exec(l)?.[1] ?? '')) });
    } else {
      blocks.push({ kind: 'paragraph', children: parseInline(lines.map((l) => l.trim()).join(' ')) });
    }
  }
  return blocks;
}

/** Every term id some inline text links to. */
export function termsInInline(nodes: Inline[]): string[] {
  return nodes.flatMap((n) => {
    if (n.kind === 'term') return [n.id];
    if (n.kind === 'em' || n.kind === 'strong') return termsInInline(n.children);
    return [];
  });
}

/** Every term id a body links to. */
export function termsInBlocks(blocks: Block[]): string[] {
  return blocks.flatMap((b) => (b.kind === 'paragraph' ? termsInInline(b.children) : b.items.flatMap(termsInInline)));
}
