import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { initCoreSync, version } from './index.ts';

beforeAll(() => {
  // Built by scripts/build-wasm.sh.
  initCoreSync(readFileSync(new URL('../wasm/gpuviz_wasm_bg.wasm', import.meta.url)));
});

describe('core', () => {
  it('reports the crate version across the WASM boundary', () => {
    expect(version()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
