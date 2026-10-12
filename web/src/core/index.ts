// Typed entry point to the Rust core. The rest of the app imports from here,
// never from ../wasm directly (design §5).
import init, {
  evaluate as wasmEvaluate,
  hardware as wasmHardware,
  initSync,
  models as wasmModels,
  version as wasmVersion,
} from '../wasm/gpuviz_wasm.js';
import type { HwNode } from '../generated/HwNode.ts';
import type { ModelConfig } from '../generated/ModelConfig.ts';
import type { Scenario } from '../generated/Scenario.ts';
import type { StepPlan } from '../generated/StepPlan.ts';

export type { HwNode, ModelConfig, Scenario, StepPlan };

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

// The casts below are the boundary ADR 0001 describes: the core serializes
// exactly the shapes ts-rs generates.

/** The component tree of a hardware preset. Throws on an unknown id. */
export function hardware(id: string): HwNode {
  return wasmHardware(id) as HwNode;
}

/** Every model preset. */
export function models(): ModelConfig[] {
  return wasmModels() as ModelConfig[];
}

/**
 * The plan of one step. Throws on an unknown id or an invalid scenario; a
 * batch that does not fit in HBM is not an error (`plan.memory.overflow`).
 */
export function evaluate(hw: string, model: string, scenario: Scenario): StepPlan {
  return wasmEvaluate(hw, model, scenario) as StepPlan;
}
