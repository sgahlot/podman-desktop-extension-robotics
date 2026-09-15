import { writable } from 'svelte/store';

export interface OpenShiftSelection {
  context: string;
  namespace: string;
}

/** Last-used OpenShift context+namespace on the Simulation page, kept in sync by
 * OpenShiftSimulation.svelte so Diagnostics.svelte can default to the same target instead of
 * re-deriving or prompting for one independently. */
export const lastOpenShiftSelection = writable<OpenShiftSelection | undefined>(undefined);
