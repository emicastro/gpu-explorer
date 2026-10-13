import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import rule from '../../eslint-rules/no-bare-numbers.js';

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      projectService: { allowDefaultProject: ['fixture.tsx'], defaultProject: 'tsconfig.app.json' },
      tsconfigRootDir: new URL('../..', import.meta.url).pathname,
    },
  },
});

const filename = 'fixture.tsx';
const head = `
declare const n: number;
declare const x: number;
declare const bytes: number;
declare const gb: (b: number) => string;
declare const Q: (p: { value: number }) => unknown;
declare const Num: (p: { value: number }) => unknown;
declare const label: string;
`;
const code = (jsx: string): string => `${head}export const el = ${jsx};`;

// The rule of R16 (ADR 0022): numbers reach JSX children only through <Q> or <Num>.
describe('quantity lint rule', () => {
  tester.run('no-bare-numbers', rule, {
    valid: [
      { filename, code: code('<p><Q value={n} /></p>') },
      { filename, code: code('<p><Num value={n} /></p>') },
      { filename, code: code('<p>{label}</p>') },
      { filename, code: code('<p>plain words</p>') },
      // Attributes carry geometry and aria text, not visible numbers.
      { filename, code: code('<div style={{ width: n }} title={`layer ${n}`} data-x={x} />') },
      { filename, code: code('<p>{n > 3 ? "many" : "few"}</p>') },
    ],
    invalid: [
      { filename, code: code('<p>{n}</p>'), errors: [{ messageId: 'bare' }] },
      { filename, code: code('<p>{x.toFixed(1)}</p>'), errors: [{ messageId: 'bare' }] },
      { filename, code: code('<p>{gb(bytes)}</p>'), errors: [{ messageId: 'bare' }] },
      { filename, code: code('<p>{`${n} B`}</p>'), errors: [{ messageId: 'bare' }] },
      { filename, code: code('<p>{String(n)}</p>'), errors: [{ messageId: 'bare' }] },
      { filename, code: code('<p>{n > 3 ? `${n}` : ""}</p>'), errors: [{ messageId: 'bare' }] },
      { filename, code: code('<p>{label + n}</p>'), errors: [{ messageId: 'bare' }] },
    ],
  });
});
