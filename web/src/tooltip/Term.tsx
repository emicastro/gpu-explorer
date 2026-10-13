// A `[[id]]` in content: the term's own name, with the glossary entry in a
// tooltip (R15). The entry's text can hold terms, which open nested tooltips.
import { content } from '../content/index.ts';
import { InlineText, Prose } from '../content/Prose.tsx';
import { TipBox, useTip } from './Tip.tsx';

export function Term({ id, label }: { id: string; label: string | null }) {
  const tip = useTip();
  const entry = content.glossary.get(id);
  const text = label ?? entry?.name ?? id;
  if (!entry) return <span className="term">{text}</span>;
  return (
    <span className="tip-wrap" {...tip.props}>
      <span className="term" data-term={id} data-tip-trigger tabIndex={0} aria-describedby={tip.open ? `tip-${tip.id}` : undefined}>
        {text}
      </span>
      {tip.open && (
        <TipBox tip={tip} className="term-tip">
          <strong>{entry.name}</strong>
          <span className="tip-short"><InlineText nodes={entry.short} /></span>
          {tip.pinned && (
            <span className="tip-more">
              <Prose blocks={entry.body} phrasing />
              {entry.related.length > 0 && (
                <span className="tip-related">
                  Related:{' '}
                  {entry.related.map((r) => <Term key={r} id={r} label={null} />).flatMap((t, i) => (i === 0 ? [t] : [', ', t]))}
                </span>
              )}
            </span>
          )}
        </TipBox>
      )}
    </span>
  );
}
