import type { CostmapSummaryResult, LaserScanSummary, TfTreeResult } from '../types/RobotDiagnostics';

export type VerdictLevel = 'ok' | 'warning' | 'error';

export interface DiagnosticVerdict {
  level: VerdictLevel;
  headline: string;
  detail?: string;
}

/**
 * Above this unknown-cell percentage, the global costmap is judged "mostly unexplored" rather
 * than degraded. Best-effort default, not validated against real degraded-sensor captures —
 * ship as hardcoded for this pass, not a new Preferences setting (overkill before real usage
 * data).
 */
export const MOSTLY_UNEXPLORED_PCT = 80;

/**
 * Above this occupied-cell percentage, the global costmap is judged "unusually high obstacle
 * coverage" — same best-effort/hardcoded caveat as MOSTLY_UNEXPLORED_PCT.
 */
export const HIGH_OCCUPIED_PCT = 50;

/**
 * Above this NaN-ratio of LaserScan readings, the scan is judged degraded (error tier). NaN
 * readings are weighted more heavily than `inf` readings here: `inf` is a legitimate LaserScan
 * reading meaning "no return within range" (e.g. open space, a hole in the environment), not
 * necessarily a fault, whereas a NaN reading has no such benign interpretation.
 */
export const NAN_DEGRADED_RATIO = 0.2;

/**
 * Above this combined (NaN + inf) ratio of LaserScan readings, the scan is flagged as a
 * warning — most readings out of range or invalid, though this can be entirely normal in open
 * space (long corridors, outdoor-scale maps), hence "warning" rather than "error".
 */
export const BAD_WARNING_RATIO = 0.8;

/**
 * Plain-language read of a TF tree snapshot. `map`→`odom` is the localization-critical pair
 * (AMCL/localization publishes it): if it's missing, navigation has no idea where the robot is,
 * which is worth calling out distinctly from any other missing pair in the curated chain.
 */
export function tfTreeVerdict(result: TfTreeResult): DiagnosticVerdict {
  const mapToOdom = result.frames.find(frame => frame.parentFrame === 'map' && frame.childFrame === 'odom');
  if (mapToOdom && !mapToOdom.available) {
    return {
      level: 'error',
      headline: "Localization lost — the robot doesn't know where it is on the map.",
      detail: mapToOdom.error,
    };
  }

  const otherMissing = result.frames.find(
    frame => !(frame.parentFrame === 'map' && frame.childFrame === 'odom') && !frame.available,
  );
  if (otherMissing) {
    return {
      level: 'warning',
      headline: `TF frame ${otherMissing.parentFrame} → ${otherMissing.childFrame} is missing.`,
      detail: otherMissing.error,
    };
  }

  return { level: 'ok', headline: 'Localization OK.' };
}

/**
 * Plain-language read of a costmap snapshot, keyed off the global costmap only — "has the robot
 * explored the map" is a global-map question; the local costmap is a rolling window around the
 * robot and doesn't carry that signal. Deliberately avoids claiming the robot "just spawned"
 * when the map is mostly unexplored: no spawn timestamp is available here to justify that, so
 * the wording stays to what the data actually supports ("expected if it hasn't driven far yet").
 */
export function costmapVerdict(result: CostmapSummaryResult): DiagnosticVerdict {
  const global = result.global;
  if (!global) {
    return { level: 'error', headline: 'No global costmap data available.' };
  }
  if (global.timedOut) {
    return {
      level: 'warning',
      headline: 'Global map not available yet — try again after Navigate has run once.',
      detail: global.error,
    };
  }
  if (global.error) {
    return { level: 'error', headline: 'Could not read the global costmap.', detail: global.error };
  }

  const unknownPct = global.totalCells > 0 ? (global.unknownCells / global.totalCells) * 100 : 0;
  const occupiedPct = global.totalCells > 0 ? (global.occupiedCells / global.totalCells) * 100 : 0;

  if (unknownPct > MOSTLY_UNEXPLORED_PCT) {
    return {
      level: 'ok',
      headline: "Global map is mostly unexplored — expected if the robot hasn't driven far yet.",
    };
  }
  if (occupiedPct > HIGH_OCCUPIED_PCT) {
    return { level: 'warning', headline: 'Unusually high obstacle coverage in the global map.' };
  }
  return { level: 'ok', headline: 'Global map looks normal.' };
}

/**
 * Plain-language read of a LaserScan snapshot. See NAN_DEGRADED_RATIO for why NaN and `inf`
 * readings are weighted differently.
 */
export function laserScanVerdict(result: LaserScanSummary): DiagnosticVerdict {
  if (result.timedOut) {
    return {
      level: 'warning',
      headline: 'No laser scan received yet — the topic may be idle.',
      detail: result.error,
    };
  }
  if (result.error) {
    return { level: 'error', headline: 'Could not read the laser scan.', detail: result.error };
  }

  const total = result.totalCount;
  const nanRatio = total > 0 ? result.nanCount / total : 0;
  const badRatio = total > 0 ? (result.nanCount + result.infCount) / total : 0;

  if (nanRatio > NAN_DEGRADED_RATIO) {
    return { level: 'error', headline: 'Many invalid (NaN) readings in the laser scan.' };
  }
  if (badRatio > BAD_WARNING_RATIO) {
    return {
      level: 'warning',
      headline: 'Most readings are out-of-range or invalid — this can be normal in open space.',
    };
  }
  return { level: 'ok', headline: 'Laser scan looks normal.' };
}
