import type { HwNode } from '../core/index.ts';
import { InlineText, Prose } from '../content/Prose.tsx';
import type { Block } from '../content/markdown.ts';
import { sceneSubject } from '../plan/kernels.ts';
import { findNode, nodeAtLevel } from '../scene/layout.ts';
import { findPart } from '../scene/parts.ts';
import { levelLabel } from '../nav/machine.ts';
import { useStore } from '../state/store.ts';
import { Num } from '../quantity/Num.tsx';
import { Q } from '../quantity/Q.tsx';
import { countOf, llmHere, proseFor, specFacts, type Fact } from './facts.ts';

function FactRow({ fact }: { fact: Fact }) {
  return (
    <>
      <dt>{fact.label}</dt>
      <dd>
        {'value' in fact ? (
          <Q value={fact.value} />
        ) : (
          fact.text
        )}
      </dd>
    </>
  );
}

/** `×132 (+12 off)`, the counts through `<Q>`. */
function Count({ node }: { node: HwNode }) {
  const count = countOf(node);
  if (!count) return null;
  return (
    <>
      ×<Q value={count.on} />
      {count.off > 0 && <> (+<Num value={count.off} /> off)</>}
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

function ProseSection({ title, blocks }: { title: string; blocks: Block[] }) {
  return (
    <section>
      <h3>{title}</h3>
      <Prose blocks={blocks} />
    </section>
  );
}

/**
 * The panel of a component (design §6.4, R9, R22): what it is, why it exists and
 * what it does in decode (ADR 0026), its numbers, and what
 * the LLM does there for the kernel on the scene. It opens for the level you
 * are on, and the parts inside it are listed to open in turn: no raycast on
 * detail (ADR 0017), and no click taken from entering a level.
 */
export function ComponentPanel({ hardware }: { hardware: HwNode }) {
  const path = useStore((s) => s.path);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const plan = useStore((s) => s.plan);
  const ref = useStore((s) => s.sceneKernel);
  const summary = useStore((s) => s.summary);

  const here = path.length === 0 ? nodeAtLevel(hardware, 'package') : findNode(hardware, path[path.length - 1] ?? '');
  const open = selection?.kind === 'component' ? findPart(hardware, selection.id) : null;

  if (!open) {
    const place = levelLabel(path.length).toLowerCase();
    return (
      <button type="button" className="panel-open" onClick={() => { select({ kind: 'component', id: here.id }); }}>
        About this {place}
      </button>
    );
  }
  const kernel = plan ? sceneSubject(plan, ref, summary) : null;
  const prose = proseFor(open);
  return (
    <aside className="component-panel" aria-label="Component" data-testid="component-panel">
      <header>
        <h2>{open.name}{countOf(open) && <span className="panel-count"> <Count node={open} /></span>}</h2>
        <button type="button" aria-label="Close panel" onClick={() => { select(null); }}>×</button>
      </header>
      {prose && (
        <div className="panel-prose">
          <Prose blocks={prose.intro} />
          <p><strong>What it stores:</strong> <InlineText nodes={prose.stores} /></p>
          <ProseSection title="Why it exists" blocks={prose.why} />
          <ProseSection title="In a decode step" blocks={prose.decode} />
          {prose.analogy && <ProseSection title="Think of it as" blocks={prose.analogy} />}
        </div>
      )}
      <Facts title="Specs (one instance)" facts={specFacts(open)} />
      <Facts title="What the LLM does here" facts={llmHere(open, kernel)} />
      {open.children.length > 0 && (
        <section>
          <h3>Inside</h3>
          <ul className="panel-children">
            {open.children.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => { select({ kind: 'component', id: c.id }); }}>{c.name}</button>
                {countOf(c) && <> <Count node={c} /></>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
