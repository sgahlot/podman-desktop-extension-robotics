import type { RobotEntry } from '../RobotControls.types';

/** Consecutive-miss threshold before a tracked robot is pruned as stale (APPENG-6149) —
 * `listSpawnedRobotsIn*` never throws, returning [] both for a genuinely empty world AND
 * for a transient exec failure, so a single empty poll can't be trusted to mean "this
 * robot is really gone". Requiring the same robot to be confirmed missing across this many
 * consecutive polls keeps one blip from wiping an actively-driven robot's nav state. */
export const PRUNE_MISS_THRESHOLD = 2;

/** Startup grace period (ms) before a freshly-tracked robot is eligible for pruning —
 * mainly for Humble, which has no `warming` phase at all, so its ROS nodes still take a
 * moment to register after a Gazebo spawn (the same raw latency the backend's own
 * pre-warm pose-poll accounts for). A robot with `warmStatus === 'warming'` is skipped
 * entirely regardless of this window — its own state machine already owns resolving that. */
export const PRUNE_GRACE_PERIOD_MS = 30_000;

/**
 * Appends a bare entry (idle, navTarget 0/0, navReached null — x/y aren't recoverable
 * from `ros2 node list`) for each `liveName` not already in `existing` (APPENG-6105/6250).
 * Never overwrites or removes an already-tracked entry, so it can't clobber live
 * navStatus/navTarget state. Returns the same array reference when nothing is missing,
 * so callers can skip a reactive-state write.
 */
export function reconcileAdd(existing: RobotEntry[], liveNames: string[]): RobotEntry[] {
  const tracked = new Set(existing.map(r => r.name));
  const missing = liveNames.filter(n => !tracked.has(n));
  if (missing.length === 0) return existing;
  return [
    ...existing,
    ...missing.map((n): RobotEntry => ({
      name: n,
      navStatus: 'idle',
      navTarget: { x: '0', y: '0' },
      // eslint-disable-next-line no-null/no-null -- matches RobotEntry's declared `| null` contract
      navReached: null,
    })),
  ];
}

export interface PruneStaleParams {
  tracked: RobotEntry[];
  liveNames: string[];
  /** Consecutive-miss counters, mutated in place. */
  missingStreaks: Map<string, number>;
  /** Wall-clock time each robot was first tracked, mutated in place (entries for pruned
   * robots are deleted). */
  trackedSince: Map<string, number>;
  /** Map-key shape for `missingStreaks`/`trackedSince` — lets callers that track more
   * than one collection (e.g. OpenShift, keyed by workload) namespace their keys, while
   * single-collection callers (e.g. local sim) can just use the bare robot name. */
  keyOf: (robotName: string) => string;
  now?: number;
}

/**
 * Removes tracked robots that no longer actually exist in the running world (APPENG-6149)
 * — e.g. a pod/container crash resets the world to empty, but a robot spawned before the
 * crash would otherwise sit in the tracked list forever, failing every subsequent action
 * against a robot that's gone.
 *
 * Only ever checks robots whose phase actually warrants it: a `'warming'` robot is
 * skipped (its own state machine already owns resolving that), an unconfirmed robot still
 * within its startup grace period is skipped, and only a robot confirmed missing across
 * `PRUNE_MISS_THRESHOLD` consecutive polls is actually removed. Returns the same array
 * reference when nothing was pruned.
 */
export function pruneStale(params: PruneStaleParams): RobotEntry[] {
  const { tracked, liveNames, missingStreaks, trackedSince, keyOf, now = Date.now() } = params;
  const live = new Set(liveNames);
  const keep: RobotEntry[] = [];
  for (const robot of tracked) {
    const key = keyOf(robot.name);
    if (robot.warmStatus === 'warming') {
      // Still initializing — its own state machine will resolve to 'ready'/'failed';
      // don't count this tick's absence against it.
      keep.push(robot);
      continue;
    }
    if (live.has(robot.name)) {
      missingStreaks.delete(key);
      keep.push(robot);
      continue;
    }
    const since = trackedSince.get(key);
    if (since !== undefined && now - since < PRUNE_GRACE_PERIOD_MS) {
      // Still within its startup grace window — not suspicious yet.
      keep.push(robot);
      continue;
    }
    const streak = (missingStreaks.get(key) ?? 0) + 1;
    if (streak >= PRUNE_MISS_THRESHOLD) {
      missingStreaks.delete(key);
      trackedSince.delete(key);
    } else {
      missingStreaks.set(key, streak);
      keep.push(robot);
    }
  }
  return keep.length === tracked.length ? tracked : keep;
}
