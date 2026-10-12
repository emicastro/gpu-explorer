import type { HwNode } from '../core/index.ts';
import { FLOW_OP, findKernel } from '../flow/flow.ts';
import { findNode, nodeAtLevel } from '../scene/layout.ts';
import { levelLabel } from '../nav/machine.ts';
import { useStore } from '../state/store.ts';
import { countText, formatQuantity, llmHere, proseFor, specFacts, type Fact } from './facts.ts';

function FactRow({ fact }: { fact: Fact }) {
  return (
    <>
      <dt>{fact.label}</dt>
      <dd>
        {'value' in fact ? (
          <>
            {formatQuantity(fact.value)}{' '}
            <span
              className={`confidence confidence-${fact.value.confidence}`}
              title={`${fact.value.confidence}${fact.value.sources.length ? ` · ${fact.value.sources.join('; ')}` : ''}`}
              aria-label={fact.value.confidence}
            />
          </>
        ) : (
          fact.text
        )}
      </dd>
    </>
  );
}

function Facts({ title, facts }: { title: string; facts: Fact[] }) {
  if (facts.length === 0) return null;
  return (
    <section>
      <h3>{title}</h3>
      <dl>
        {facts.map((f) => <FactRow key={f.label} fact={f} />)}
      </dl>
    </section>
  );
}

/**
 * The panel of a component (design §6.4, R9): what it is, its numbers, and what
 * the LLM does there for the kernel on the scene. It opens for the level you
 * are on, and the parts inside it are listed to open in turn: no raycast on
 * detail (ADR 0017), and no click taken from entering a level.
 */
export function ComponentPanel({ hardware }: { hardware: HwNode }) {
  const path = useStore((s) => s.path);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const plan = useStore((s) => s.plan);

  const here = path.length === 0 ? nodeAtLevel(hardware, 'package') : findNode(hardware, path[path.length - 1] ?? '');
  const open = selection?.kind === 'component' ? findNode(hardware, selection.id) : null;

  if (!open) {
    return (
      <button type="button" className="panel-open" onClick={() => { select({ kind: 'component', id: here.id }); }}>
        About this {levelLabel(path.length).toLowerCase()}
      </button>
    );
  }
  const kernel = plan ? findKernel(plan, FLOW_OP) : null;
  const prose = proseFor(open);
  const count = countText(open);
  return (
    <aside className="component-panel" aria-label="Component" data-testid="component-panel">
      <header>
        <h2>{open.name}{count ? <span className="panel-count"> {count}</span> : null}</h2>
        <button type="button" aria-label="Close panel" onClick={() => { select(null); }}>×</button>
      </header>
      <p className={prose.stub ? 'panel-prose panel-stub' : 'panel-prose'}>{prose.text}</p>
      <Facts title="Specs (one instance)" facts={specFacts(open)} />
      <Facts title="What the LLM does here" facts={llmHere(open, kernel)} />
      {open.children.length > 0 && (
        <section>
          <h3>Inside</h3>
          <ul className="panel-children">
            {open.children.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => { select({ kind: 'component', id: c.id }); }}>
                  {c.name}{countText(c) ? ` ${countText(c) ?? ''}` : ''}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
