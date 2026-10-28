import { writable } from 'svelte/store';
import type { OpenShiftWorkload } from '/@shared/src/types/OpenShiftDeploy';
import type { SimContainerInfo } from '/@shared/src/types/SimulationContainer';

export type SimulationTargetKind = 'local' | 'openshift';

/** Last active Simulation target, retained while route components remount. */
const TARGET_STORAGE_KEY = 'physical-ai.simulation.last-target';

function rememberedTarget(): SimulationTargetKind {
  try {
    return sessionStorage.getItem(TARGET_STORAGE_KEY) === 'openshift' ? 'openshift' : 'local';
  } catch {
    return 'local';
  }
}

export const lastSimulationTarget = writable<SimulationTargetKind>(rememberedTarget());
lastSimulationTarget.subscribe(target => {
  try {
    sessionStorage.setItem(TARGET_STORAGE_KEY, target);
  } catch {
    // Storage can be unavailable in restricted webviews; retain the in-memory value.
  }
});

/**
 * Cache lifetime is fetched from extension configuration by the Simulation views.
 * The store deliberately holds only a last-known-good snapshot; refresh failures
 * must not blank usable Local/OpenShift controls.
 */
export const SIMULATION_CACHE_MIN_SECONDS = 15;
export const SIMULATION_CACHE_MAX_SECONDS = 24 * 60 * 60;
export const SIMULATION_CACHE_DEFAULT_SECONDS = 5 * 60;

export interface OpenShiftSimulationSnapshot {
  namespace: string;
  selectedContext: string;
  workloads: OpenShiftWorkload[];
  robotsByWorkload: Record<string, unknown[]>;
  robotProfilesByWorkload: Record<string, unknown[]>;
  robotProfileSelectionsByWorkload: Record<string, unknown>;
  profileImageKeysByWorkload: Record<string, string>;
  profileLoadingByWorkload: Record<string, boolean>;
  profileLoadErrorsByWorkload: Record<string, string>;
  capturedAt: number;
}

let openShiftSnapshot: OpenShiftSimulationSnapshot | undefined;
let localSnapshot: { containers: SimContainerInfo[]; robots: unknown[]; capturedAt: number } | undefined;

export function getOpenShiftSimulationSnapshot(): OpenShiftSimulationSnapshot | undefined {
  return openShiftSnapshot;
}

export function setOpenShiftSimulationSnapshot(snapshot: OpenShiftSimulationSnapshot): void {
  openShiftSnapshot = snapshot;
}

export function getLocalSimulationSnapshot() {
  return localSnapshot;
}

export function setLocalSimulationSnapshot(snapshot: {
  containers: SimContainerInfo[];
  robots: unknown[];
  capturedAt: number;
}): void {
  localSnapshot = snapshot;
}

/** Clears ephemeral route snapshots; used by frontend tests between renders. */
export function clearSimulationViewState(): void {
  openShiftSnapshot = undefined;
  localSnapshot = undefined;
}
