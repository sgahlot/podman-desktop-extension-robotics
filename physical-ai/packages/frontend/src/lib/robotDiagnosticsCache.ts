import type { TfTreeResult, CostmapSummaryResult, LaserScanSummary } from '/@shared/src/types/RobotDiagnostics';

export interface CachedDiagnosticsSnapshot {
  tfResult: TfTreeResult | null;
  tfError: string;
  costmapResult: CostmapSummaryResult | null;
  costmapError: string;
  laserResult: LaserScanSummary | null;
  laserError: string;
}

/**
 * Last-known diagnostics snapshot per target+robot, kept in module state (not persisted across
 * a full extension reload) so navigating away from and back to the Diagnostics page — or
 * switching robots and back — doesn't discard the last "Refresh diagnostics" results. Read-only
 * rehydration: never triggers a fetch, so it doesn't affect the feature's "always manual" invariant.
 */
const cache = new Map<string, CachedDiagnosticsSnapshot>();

function cacheKey(targetKey: string, robotName: string): string {
  return `${targetKey}::${robotName}`;
}

export function getCachedDiagnostics(targetKey: string, robotName: string): CachedDiagnosticsSnapshot | undefined {
  return cache.get(cacheKey(targetKey, robotName));
}

export function setCachedDiagnostics(targetKey: string, robotName: string, snapshot: CachedDiagnosticsSnapshot): void {
  cache.set(cacheKey(targetKey, robotName), snapshot);
}

/** Test-only: this cache is deliberately a module-level singleton (see comment above) so
 * specs reusing the same target/robot ids across cases must reset it in beforeEach. */
export function __resetRobotDiagnosticsCacheForTests(): void {
  cache.clear();
}
