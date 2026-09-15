import { describe, it, expect } from 'vitest';
import { reconcileAdd, pruneStale, PRUNE_MISS_THRESHOLD, PRUNE_GRACE_PERIOD_MS } from './robotReconcile';
import type { RobotEntry } from '../RobotControls.types';

function robot(name: string, overrides: Partial<RobotEntry> = {}): RobotEntry {
  return {
    name,
    navStatus: 'idle',
    navTarget: { x: '0', y: '0' },
    // eslint-disable-next-line no-null/no-null -- matches RobotEntry's declared `| null` contract
    navReached: null,
    ...overrides,
  };
}

describe('reconcileAdd', () => {
  it('appends robots present live but not yet tracked', () => {
    const result = reconcileAdd([], ['robot_1', 'robot_2']);
    expect(result.map(r => r.name)).toEqual(['robot_1', 'robot_2']);
    // eslint-disable-next-line no-null/no-null -- matches RobotEntry's declared `| null` contract
    expect(result[0]).toMatchObject({ navStatus: 'idle', navTarget: { x: '0', y: '0' }, navReached: null });
  });

  it('never overwrites or removes an already-tracked robot', () => {
    const existing = [robot('robot_1', { navStatus: 'navigating', x: '1', y: '2' })];
    const result = reconcileAdd(existing, ['robot_1']);
    expect(result).toBe(existing);
    expect(result[0]).toMatchObject({ navStatus: 'navigating', x: '1', y: '2' });
  });

  it('only adds the names missing from the tracked set', () => {
    const existing = [robot('robot_1')];
    const result = reconcileAdd(existing, ['robot_1', 'robot_2']);
    expect(result.map(r => r.name)).toEqual(['robot_1', 'robot_2']);
  });

  it('returns the same array reference when nothing is missing', () => {
    const existing = [robot('robot_1')];
    expect(reconcileAdd(existing, [])).toBe(existing);
  });
});

describe('pruneStale', () => {
  const keyOf = (n: string) => n;

  it('keeps robots that are still live and resets their miss streak', () => {
    const missingStreaks = new Map([['robot_1', 1]]);
    const trackedSince = new Map<string, number>();
    const tracked = [robot('robot_1')];
    const result = pruneStale({ tracked, liveNames: ['robot_1'], missingStreaks, trackedSince, keyOf });
    expect(result).toBe(tracked);
    expect(missingStreaks.has('robot_1')).toBe(false);
  });

  it('always keeps a warming robot regardless of liveness', () => {
    const tracked = [robot('robot_1', { warmStatus: 'warming' })];
    const result = pruneStale({
      tracked,
      liveNames: [],
      missingStreaks: new Map(),
      trackedSince: new Map(),
      keyOf,
    });
    expect(result).toBe(tracked);
  });

  it('keeps a missing robot within its startup grace period', () => {
    const now = 1_000_000;
    const trackedSince = new Map([['robot_1', now - (PRUNE_GRACE_PERIOD_MS - 1)]]);
    const tracked = [robot('robot_1')];
    const result = pruneStale({
      tracked,
      liveNames: [],
      missingStreaks: new Map(),
      trackedSince,
      keyOf,
      now,
    });
    expect(result).toBe(tracked);
  });

  it('prunes a robot only after PRUNE_MISS_THRESHOLD consecutive misses', () => {
    const missingStreaks = new Map<string, number>();
    const trackedSince = new Map<string, number>();
    let tracked = [robot('robot_1')];

    for (let i = 1; i < PRUNE_MISS_THRESHOLD; i++) {
      tracked = pruneStale({ tracked, liveNames: [], missingStreaks, trackedSince, keyOf });
      expect(tracked).toHaveLength(1);
    }

    tracked = pruneStale({ tracked, liveNames: [], missingStreaks, trackedSince, keyOf });
    expect(tracked).toHaveLength(0);
    expect(missingStreaks.has('robot_1')).toBe(false);
  });

  it('resets the miss streak once a robot reappears live', () => {
    const missingStreaks = new Map<string, number>();
    const trackedSince = new Map<string, number>();
    let tracked = [robot('robot_1')];

    tracked = pruneStale({ tracked, liveNames: [], missingStreaks, trackedSince, keyOf });
    expect(missingStreaks.get('robot_1')).toBe(1);

    tracked = pruneStale({ tracked, liveNames: ['robot_1'], missingStreaks, trackedSince, keyOf });
    expect(missingStreaks.has('robot_1')).toBe(false);
    expect(tracked).toHaveLength(1);
  });

  it('namespaces map keys via keyOf, so identical robot names in different collections do not collide', () => {
    const missingStreaks = new Map<string, number>();
    const trackedSince = new Map<string, number>();
    const trackedA = [robot('robot_1')];
    const trackedB = [robot('robot_1')];

    pruneStale({ tracked: trackedA, liveNames: [], missingStreaks, trackedSince, keyOf: n => `a::${n}` });
    pruneStale({ tracked: trackedB, liveNames: ['robot_1'], missingStreaks, trackedSince, keyOf: n => `b::${n}` });

    expect(missingStreaks.get('a::robot_1')).toBe(1);
    expect(missingStreaks.has('b::robot_1')).toBe(false);
  });

  it('returns the same array reference when nothing was pruned', () => {
    const tracked = [robot('robot_1')];
    const result = pruneStale({
      tracked,
      liveNames: ['robot_1'],
      missingStreaks: new Map(),
      trackedSince: new Map(),
      keyOf,
    });
    expect(result).toBe(tracked);
  });
});
