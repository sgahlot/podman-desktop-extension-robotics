import type { CostmapSummaryResult, RobotSensorDiagnosticsResult, TfTreeResult } from './RobotDiagnostics';

export interface DiagnosticsExportSnapshot {
  capturedAt: string;
  target: { kind: 'local'; identity: string } | { kind: 'openshift'; identity: string; context?: string };
  robot: string;
  tfResult: TfTreeResult | undefined;
  tfError: string;
  costmapResult: CostmapSummaryResult | undefined;
  costmapError: string;
  sensorResult: RobotSensorDiagnosticsResult | undefined;
  sensorError: string;
}

/** Stable, bounded v1 document for an already-captured diagnostics refresh. */
export function serializeDiagnosticsSnapshot(snapshot: DiagnosticsExportSnapshot): string {
  return JSON.stringify(
    {
      version: 1,
      capturedAt: snapshot.capturedAt,
      target: snapshot.target,
      robot: snapshot.robot,
      tf: snapshot.tfResult ?? { unavailable: snapshot.tfError || 'No TF result captured.' },
      costmap: snapshot.costmapResult ?? { unavailable: snapshot.costmapError || 'No costmap result captured.' },
      sensors: snapshot.sensorResult ?? { unavailable: snapshot.sensorError || 'No sensor result captured.' },
    },
    undefined,
    2,
  );
}
