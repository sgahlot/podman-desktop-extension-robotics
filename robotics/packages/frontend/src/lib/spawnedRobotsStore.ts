import { writable } from 'svelte/store';

/** Currently-known spawned robot names per diagnostics target key (lib/diagnosticsTargetKey.ts),
 * kept live by LocalSimulation.svelte/OpenShiftSimulation.svelte's own reconciliation — shared so
 * RobotDiagnosticsPanel doesn't rely solely on its own one-shot fetch to notice a robot that
 * spawned after it last checked. */
export const spawnedRobotsByTarget = writable<Record<string, string[]>>({});

export function setSpawnedRobotsForTarget(targetKey: string, names: string[]): void {
  spawnedRobotsByTarget.update(m => ({ ...m, [targetKey]: names }));
}
