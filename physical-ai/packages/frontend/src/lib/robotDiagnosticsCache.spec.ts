import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCachedDiagnostics,
  setCachedDiagnostics,
  clearCachedDiagnostics,
  __resetRobotDiagnosticsCacheForTests,
  type CachedDiagnosticsSnapshot,
} from './robotDiagnosticsCache';

const SNAPSHOT: CachedDiagnosticsSnapshot = {
  // eslint-disable-next-line no-null/no-null -- matches CachedDiagnosticsSnapshot's declared `| null` contract
  tfResult: null,
  tfError: '',
  // eslint-disable-next-line no-null/no-null -- matches CachedDiagnosticsSnapshot's declared `| null` contract
  costmapResult: null,
  costmapError: '',
  // eslint-disable-next-line no-null/no-null -- matches CachedDiagnosticsSnapshot's declared `| null` contract
  laserResult: null,
  laserError: '',
};

describe('robotDiagnosticsCache', () => {
  beforeEach(() => {
    __resetRobotDiagnosticsCacheForTests();
  });

  it('returns undefined when nothing has been cached for a target+robot', () => {
    expect(getCachedDiagnostics('podman:c1', 'robot_1')).toBeUndefined();
  });

  it('returns what was set for the same target+robot', () => {
    setCachedDiagnostics('podman:c1', 'robot_1', SNAPSHOT);
    expect(getCachedDiagnostics('podman:c1', 'robot_1')).toBe(SNAPSHOT);
  });

  describe('clearCachedDiagnostics', () => {
    it('removes the cached entry, so a later get returns undefined', () => {
      setCachedDiagnostics('podman:c1', 'robot_1', SNAPSHOT);
      clearCachedDiagnostics('podman:c1', 'robot_1');
      expect(getCachedDiagnostics('podman:c1', 'robot_1')).toBeUndefined();
    });

    it('leaves other robots under the same target untouched', () => {
      setCachedDiagnostics('podman:c1', 'robot_1', SNAPSHOT);
      const other: CachedDiagnosticsSnapshot = { ...SNAPSHOT, tfError: 'other' };
      setCachedDiagnostics('podman:c1', 'robot_2', other);

      clearCachedDiagnostics('podman:c1', 'robot_1');

      expect(getCachedDiagnostics('podman:c1', 'robot_1')).toBeUndefined();
      expect(getCachedDiagnostics('podman:c1', 'robot_2')).toBe(other);
    });

    it('leaves the same robot name under a different target key untouched', () => {
      setCachedDiagnostics('podman:c1', 'robot_1', SNAPSHOT);
      const other: CachedDiagnosticsSnapshot = { ...SNAPSHOT, tfError: 'other-target' };
      setCachedDiagnostics('podman:c2', 'robot_1', other);

      clearCachedDiagnostics('podman:c1', 'robot_1');

      expect(getCachedDiagnostics('podman:c1', 'robot_1')).toBeUndefined();
      expect(getCachedDiagnostics('podman:c2', 'robot_1')).toBe(other);
    });

    it('is a no-op when clearing an entry that was never cached', () => {
      expect(() => clearCachedDiagnostics('podman:c1', 'robot_1')).not.toThrow();
    });
  });
});
