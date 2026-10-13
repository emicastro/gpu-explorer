// The site's content: glossary entries and component prose, read from
// `content/` at build time (design §7, ADR 0005). `readContent` is pure so the
// content test can run it on fixtures; `content` is the real files.
import { splitFrontmatter } from './frontmatter.ts';
import { parseInline, parseMarkdown, termsInBlocks, termsInInline, type Block, type Inline } from './markdown.ts';

export interface GlossaryEntry {
  id: string;
  name: string;
  /** The tooltip text. */
  short: Inline[];
  related: string[];
  sources: string[];
  /** The long definition. */
  body: Block[];
}

export interface ComponentEntry {
  /** The `contentId` of the hardware nodes it describes. */
  id: string;
  does: Inline[];
  stores: Inline[];
  body: Block[];
}

export interface Content {
  glossary: ReadonlyMap<string, GlossaryEntry>;
  components: ReadonlyMap<string, ComponentEntry>;
  /** What is wrong with the files, in reading order; empty when they are fine. */
  problems: string[];
}

const PATH = /(?:^|\/)content\/(glossary|components)\/([^/]+)\.md$/;

type Fields = Record<string, unknown>;

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** A frontmatter field that must be a non-empty string. */
function text(data: Fields, key: string, file: string, problems: string[]): string {
  const v = data[key];
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  problems.push(`${file}: "${key}" is missing or not a non-empty string`);
  return '';
}

/** A frontmatter field that must be a list of strings (it may be empty). */
function list(data: Fields, key: string, file: string, problems: string[]): string[] {
  const v = data[key];
  if (isStrings(v)) return v;
  problems.push(`${file}: "${key}" is missing or not a list of strings`);
  return [];
}

/** Parse `files` (path → raw text) into entries, collecting what is wrong with them. */
export function readContent(files: Readonly<Record<string, string>>): Content {
  const glossary = new Map<string, GlossaryEntry>();
  const components = new Map<string, ComponentEntry>();
  const problems: string[] = [];

  for (const [file, raw] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const m = PATH.exec(file);
    if (!m) {
      problems.push(`${file}: not under content/glossary/ or content/components/`);
      continue;
    }
    const [, dir, slug = ''] = m;
    let data: Fields;
    let body: string;
    try {
      const split = splitFrontmatter(raw);
      if (typeof split.data !== 'object' || split.data === null || Array.isArray(split.data)) throw new Error('the frontmatter is not a mapping');
      data = split.data as Fields;
      body = split.body;
    } catch (e) {
      problems.push(`${file}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const id = text(data, 'id', file, problems);
    if (id !== '' && id !== slug) problems.push(`${file}: id "${id}" does not match the file name`);
    const blocks = parseMarkdown(body);
    if (blocks.length === 0) problems.push(`${file}: the body is empty`);

    if (dir === 'glossary') {
      glossary.set(slug, {
        id,
        name: text(data, 'name', file, problems),
        short: parseInline(text(data, 'short', file, problems)),
        related: list(data, 'related', file, problems),
        sources: list(data, 'sources', file, problems),
        body: blocks,
      });
    } else {
      components.set(slug, {
        id,
        does: parseInline(text(data, 'does', file, problems)),
        stores: parseInline(text(data, 'stores', file, problems)),
        body: blocks,
      });
    }
  }
  return { glossary, components, problems };
}

/**
 * What is wrong with the content once the hardware tree is known: a link or a
 * `related` to a term that does not exist, a component of the tree without
 * prose, and prose for a component the tree doesn't have.
 */
export function crossProblems(content: Content, treeIds: readonly string[], extraIds: readonly string[] = []): string[] {
  const contentIds = [...treeIds, ...extraIds];
  const problems: string[] = [];
  const unknown = (where: string, ids: string[]) => {
    for (const id of ids) if (!content.glossary.has(id)) problems.push(`${where}: unknown term [[${id}]]`);
  };
  for (const [slug, e] of content.glossary) {
    const where = `glossary/${slug}`;
    unknown(where, [...termsInInline(e.short), ...termsInBlocks(e.body)]);
    for (const id of e.related) if (!content.glossary.has(id)) problems.push(`${where}: related term "${id}" does not exist`);
  }
  for (const [slug, e] of content.components) {
    unknown(`components/${slug}`, [...termsInInline(e.does), ...termsInInline(e.stores), ...termsInBlocks(e.body)]);
    if (!contentIds.includes(slug)) problems.push(`components/${slug}: orphan, no node of the hardware tree has this contentId`);
  }
  for (const id of contentIds) if (!content.components.has(id)) problems.push(`components/${id}: no prose for this component of the hardware tree`);
  return problems;
}

const files = import.meta.glob<string>('../../../content/**/*.md', { query: '?raw', import: 'default', eager: true });

export const content: Content = readContent(files);
