import { create } from 'zustand';

/**
 * The leg the flow's pulse is on (ADR 0018): animation state, kept apart from
 * the app store and written only when the leg changes. Null while no flow runs.
 */
interface FlowStage {
  leg: number | null;
  setLeg: (leg: number | null) => void;
}

export const useFlowStage = create<FlowStage>((set) => ({
  leg: null,
  setLeg: (leg) => { set({ leg }); },
}));

/** True if stop `stop` (an index of FLOW_STAGES) is an end of leg `leg`. */
export const stopIsActive = (leg: number | null, stop: number): boolean =>
  leg !== null && (stop === leg || stop === leg + 1);
