/**
 * A number that claims nothing about the hardware or the model, so it has no
 * confidence to show (ADR 0022). Allowed for:
 *
 * - the roofline's axis ticks;
 * - the playhead's axis seconds and the speed multipliers;
 * - the knob values, which the user typed;
 * - ordinals and progress of the view itself (`layer 5`, `wave 2 of 3`).
 *
 * Anything the core computes or a data file states is a `Quantity` and goes
 * through `<Q>`. It renders bare text, so it also fits SVG and `<option>`.
 */
export function Num({ value, format }: { value: number; format?: (n: number) => string }) {
  return <>{format ? format(value) : String(value)}</>;
}
