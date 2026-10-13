import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { hardware, initCoreSync, type HwNode } from '../core/index.ts';
import { splitFrontmatter } from './frontmatter.ts';
import { EXTRA_PART_IDS } from '../scene/parts.ts';
import { content, crossProblems, readContent } from './index.ts';
import { parseInline, parseMarkdown, termsInBlocks, type Block } from './markdown.ts';

let contentIds: string[];

const idsOf = (n: HwNode): string[] => [n.contentId, ...n.children.flatMap(idsOf)];

beforeAll(() => {
  initCoreSync(readFileSync(new URL('../wasm/gpuviz_wasm_bg.wasm', import.meta.url)));
  contentIds = [...new Set(idsOf(hardware('h100-sxm')))];
});

describe('content files', () => {
  it('parse without problems', () => {
    expect(content.problems).toEqual([]);
  });

  it('link only to terms that exist, and every component of the tree has prose and none is an orphan', () => {
    expect(crossProblems(content, contentIds, EXTRA_PART_IDS)).toEqual([]);
  });

  it('seed a glossary and a prose entry per kind of node', () => {
    expect(content.glossary.size).toBeGreaterThan(30);
    expect(content.components.size).toBe(contentIds.length + EXTRA_PART_IDS.length);
  });
});

describe('content checks catch what is wrong', () => {
  const term = (extra: string, body = 'Body.') => `---\nid: t\nname: T\nshort: s\nrelated: []\nsources: []\n${extra}---\n\n${body}\n`;
  const sections = '\n\n## Why it exists\n\nW.\n\n## In a decode step\n\nD.';
  const check = (files: Record<string, string>, ids: string[] = [], extras: string[] = []) => {
    const c = readContent(files);
    return [...c.problems, ...crossProblems(c, ids, extras)];
  };

  it('an unknown [[term]] in a body, a short text or a related list', () => {
    const got = check({
      'content/glossary/t.md': term('', 'See [[nope]] and [[t|this]].'),
      'content/glossary/u.md': term('').replace('id: t', 'id: u').replace('short: s', 'short: see [[gone]]').replace('related: []', 'related: [missing]'),
    });
    expect(got).toEqual([
      'glossary/t: unknown term [[nope]]',
      'glossary/u: unknown term [[gone]]',
      'glossary/u: related term "missing" does not exist',
    ]);
  });

  it('missing fields, a wrong id and an empty body', () => {
    const got = check({
      'content/glossary/a.md': '---\nid: a\nname: A\n---\n\nBody.\n',
      'content/glossary/b.md': term('').replace('id: t', 'id: other'),
      'content/glossary/c.md': term('', '').replace('id: t', 'id: c'),
      'content/components/sm.md': `---\nid: sm\ndoes: x\n---\n\nBody.${sections}\n`,
      'content/glossary/d.md': 'no frontmatter',
    }, ['sm']);
    expect(got).toEqual([
      'content/components/sm.md: "stores" is missing or not a non-empty string',
      'content/glossary/a.md: "short" is missing or not a non-empty string',
      'content/glossary/a.md: "related" is missing or not a list of strings',
      'content/glossary/a.md: "sources" is missing or not a list of strings',
      'content/glossary/b.md: id "other" does not match the file name',
      'content/glossary/c.md: the body is empty',
      'content/glossary/d.md: no frontmatter block (the file must start with a --- line)',
    ]);
  });

  it('a component without its intro or a required section, with an empty, unknown or repeated heading, or an unknown term in a section', () => {
    const entry = (id: string, body: string) => `---\nid: ${id}\ndoes: d\nstores: s\n---\n\n${body}\n`;
    const got = check({
      'content/components/a.md': entry('a', '## Why it exists\n\nW.\n\n## In a decode step\n\nSee [[nope]].'),
      'content/components/b.md': entry('b', 'Intro.\n\n## Why it exists\n\nW.'),
      'content/components/c.md': entry('c', `Intro.${sections}\n\n## Think of it as\n\n## History\n\nH.`),
      'content/components/d.md': entry('d', `Intro.${sections}\n\n## Why it exists\n\nAgain.`),
    }, ['a', 'b', 'c', 'd']);
    expect(got).toEqual([
      'content/components/a.md: the intro before the first heading is empty',
      'content/components/b.md: no "## In a decode step" section',
      'content/components/c.md: unknown heading "## History" (expected one of: Why it exists, In a decode step, Think of it as)',
      'content/components/c.md: the "## Think of it as" section is empty',
      'content/components/d.md: the heading "## Why it exists" appears twice',
      'components/a: unknown term [[nope]]',
    ]);
  });

  it('a component\'s sections land in their fields, whatever their order', () => {
    const c = readContent({ 'content/components/a.md': '---\nid: a\ndoes: d\nstores: s\n---\n\nWhat.\n\n## Think of it as\n\nLike.\n\n## In a decode step\n\nDecode.\n\n## Why it exists\n\nWhy.\n' });
    expect(c.problems).toEqual([]);
    const a = c.components.get('a');
    const text = (blocks: Block[] | null | undefined) => blocks?.map((b) => (b.kind === 'paragraph' ? b.children.map((n) => (n.kind === 'text' ? n.text : '')).join('') : '')).join('|');
    expect([text(a?.intro), text(a?.why), text(a?.decode), text(a?.analogy)]).toEqual(['What.', 'Why.', 'Decode.', 'Like.']);
    expect(readContent({ 'content/components/a.md': `---\nid: a\ndoes: d\nstores: s\n---\n\nWhat.${sections}\n` }).components.get('a')?.analogy).toBeNull();
  });

  it('an extra part without its prose file', () => {
    expect(check({}, [], ['substrate'])).toEqual(['components/substrate: no prose for this component of the hardware tree']);
  });

  it('a component of the tree without prose, and prose that is no component', () => {
    const entry = (id: string) => `---\nid: ${id}\ndoes: d\nstores: s\n---\n\nBody.${sections}\n`;
    expect(check({ 'content/components/sm.md': entry('sm'), 'content/components/ghost.md': entry('ghost') }, ['sm', 'l2'])).toEqual([
      'components/ghost: orphan, no node of the hardware tree has this contentId',
      'components/l2: no prose for this component of the hardware tree',
    ]);
  });
});

describe('frontmatter and the Markdown subset', () => {
  it('splits the frontmatter from the body', () => {
    expect(splitFrontmatter('---\na: 1\n---\n\nHello\n')).toEqual({ data: { a: 1 }, body: 'Hello' });
    expect(() => splitFrontmatter('---\na: [1\n---\nx')).toThrow();
  });

  it('reads emphasis, code and both forms of term link', () => {
    expect(parseInline('a **b *c* d** `d` [[x]] [[y|why]]')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'strong', children: [{ kind: 'text', text: 'b ' }, { kind: 'em', children: [{ kind: 'text', text: 'c' }] }, { kind: 'text', text: ' d' }] },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'd' },
      { kind: 'text', text: ' ' },
      { kind: 'term', id: 'x', label: null },
      { kind: 'text', text: ' ' },
      { kind: 'term', id: 'y', label: 'why' },
    ]);
  });

  it('reads paragraphs and lists, and finds the terms inside both', () => {
    const blocks = parseMarkdown('One\ntwo [[a]].\n\n- item [[b]]\n- *item*\n');
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'list']);
    expect(termsInBlocks(blocks)).toEqual(['a', 'b']);
  });
});
