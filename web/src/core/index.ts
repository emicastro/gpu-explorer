// Typed entry point to the Rust core. The rest of the app imports from here,
// never from ../wasm directly (design §5).
import init, { initSync, version as wasmVersion } from '../wasm/gpuviz_wasm.js';

/** Fetches and instantiates the WASM module. Call once before any other export. */
export async function initCore(): Promise<void> {
  await init();
}

/** Instantiates the WASM module from bytes already in memory (tests, Node). */
export function initCoreSync(module: BufferSource): void {
  initSync({ module });
}

/** Version of the `gpuviz-core` crate. */
export function version(): string {
  return wasmVersion();
}
