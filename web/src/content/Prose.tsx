// Renders parsed content (`markdown.ts`). A `[[id]]` shows as a marked term;
// the tooltip stack of task 8.2 attaches to `.term` through its `data-term`.
import { content } from './index.ts';
import type { Block, Inline } from './markdown.ts';

export function InlineText({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.kind) {
          case 'text':
            return n.text;
          case 'code':
            return <code key={i}>{n.text}</code>;
          case 'em':
            return <em key={i}><InlineText nodes={n.children} /></em>;
          case 'strong':
            return <strong key={i}><InlineText nodes={n.children} /></strong>;
          case 'term':
            return <span key={i} className="term" data-term={n.id}>{n.label ?? content.glossary.get(n.id)?.name ?? n.id}</span>;
        }
      })}
    </>
  );
}

export function Prose({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) =>
        b.kind === 'paragraph' ? (
          <p key={i}><InlineText nodes={b.children} /></p>
        ) : (
          <ul key={i}>
            {b.items.map((item, j) => <li key={j}><InlineText nodes={item} /></li>)}
          </ul>
        ),
      )}
    </>
  );
}
