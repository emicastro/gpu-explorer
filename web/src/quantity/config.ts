import type { ModelConfig } from '../generated/ModelConfig.ts';
import type { Quantity } from '../generated/Quantity.ts';
import type { Unit } from '../generated/Unit.ts';

/**
 * A number read from a model's `config`, with the model file's provenance
 * (ADR 0010). The only place the front builds a `Quantity` (ADR 0022).
 */
export const configQuantity = (model: ModelConfig, value: number, unit: Unit = 'count'): Quantity => ({
  value,
  unit,
  confidence: model.provenance.confidence,
  sources: model.provenance.sources,
});
