// Renders parsed content (`markdown.ts`). A `[[id]]` is a `<Term>` with its tooltip.
import { Term } from '../tooltip/Term.tsx';
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
            return <Term key={i} id={n.id} label={n.label} />;
        }
      })}
    </>
  );
}

/**
 * The blocks as paragraphs and lists. Inside a tooltip, which sits in the middle
 * of a paragraph, `phrasing` draws them as block-looking spans instead, because
 * a `<p>` can't be inside a `<p>`.
 */
export function Prose({ blocks, phrasing }: { blocks: Block[]; phrasing?: boolean }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === 'paragraph') {
          return phrasing ? (
            <span key={i} className="prose-p"><InlineText nodes={b.children} /></span>
          ) : (
            <p key={i}><InlineText nodes={b.children} /></p>
          );
        }
        const items = b.items.map((item, j) => (phrasing ? <span key={j} className="prose-li">• <InlineText nodes={item} /></span> : <li key={j}><InlineText nodes={item} /></li>));
        return phrasing ? <span key={i} className="prose-p">{items}</span> : <ul key={i}>{items}</ul>;
      })}
    </>
  );
}
