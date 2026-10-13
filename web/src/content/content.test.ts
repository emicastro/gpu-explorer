import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { hardware, initCoreSync, type HwNode } from '../core/index.ts';
import { splitFrontmatter } from './frontmatter.ts';
import { content, crossProblems, readContent } from './index.ts';
import { parseInline, parseMarkdown, termsInBlocks } from './markdown.ts';

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
    expect(crossProblems(content, contentIds)).toEqual([]);
  });

  it('seed a glossary and a prose entry per kind of node', () => {
    expect(content.glossary.size).toBeGreaterThan(30);
    expect(content.components.size).toBe(contentIds.length);
  });
});

describe('content checks catch what is wrong', () => {
  const term = (extra: string, body = 'Body.') => `---\nid: t\nname: T\nshort: s\nrelated: []\nsources: []\n${extra}---\n\n${body}\n`;
  const check = (files: Record<string, string>, ids: string[] = []) => {
    const c = readContent(files);
    return [...c.problems, ...crossProblems(c, ids)];
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
      'content/components/sm.md': '---\nid: sm\ndoes: x\n---\n\nBody.\n',
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

  it('a component of the tree without prose, and prose that is no component', () => {
    const entry = (id: string) => `---\nid: ${id}\ndoes: d\nstores: s\n---\n\nBody.\n`;
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
