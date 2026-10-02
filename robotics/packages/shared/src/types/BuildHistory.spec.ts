import { describe, it, expect } from 'vitest';
import {
  assertBuildHistoryLimit,
  BUILD_HISTORY_LIMIT_MIN,
  BUILD_HISTORY_LIMIT_MAX,
  formatSbomScanErrorMessage,
  upsertBuildHistoryEntry,
} from './BuildHistory';
import type { BuildHistoryEntry } from './BuildHistory';

describe('formatSbomScanErrorMessage', () => {
  it('maps libpod image export EOF to a Podman Desktop quit message', () => {
    const raw =
      'Command execution failed with exit code 125: Error: Get "http://d/v6.0.2/libpod/images/export?references=quay.io%2Ffoo%3Abar": EOF';
    expect(formatSbomScanErrorMessage(raw)).toContain('Podman Desktop');
    expect(formatSbomScanErrorMessage(raw)).not.toContain('libpod/images/export');
  });
});

describe('upsertBuildHistoryEntry', () => {
  const base = (overrides: Partial<BuildHistoryEntry> = {}): BuildHistoryEntry => ({
    tag: 'img:latest',
    arch: 'amd64',
    startedAt: 100,
    durationMs: 1,
    success: true,
    ...overrides,
  });

  it('prepends a new row when the key is absent', () => {
    const entry = base({ tag: 'new:latest', startedAt: 200 });
    const next = upsertBuildHistoryEntry([base()], entry);
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual(entry);
  });

  it('merges into an existing row for the same tag and startedAt', () => {
    const existing = base({ success: false, errorMessage: 'old' });
    const updated = base({ success: true, bundledTools: ['cosign'] });
    const next = upsertBuildHistoryEntry([existing], updated);
    expect(next).toHaveLength(1);
    expect(next[0]).toEqual(expect.objectContaining({ success: true, bundledTools: ['cosign'], errorMessage: 'old' }));
  });
});

describe('assertBuildHistoryLimit', () => {
  it('accepts integers in range', () => {
    expect(assertBuildHistoryLimit(1)).toBe(1);
    expect(assertBuildHistoryLimit(3)).toBe(3);
    expect(assertBuildHistoryLimit(BUILD_HISTORY_LIMIT_MAX)).toBe(BUILD_HISTORY_LIMIT_MAX);
  });

  it('rejects values below the minimum', () => {
    expect(() => assertBuildHistoryLimit(0)).toThrow(new RegExp(`at least ${BUILD_HISTORY_LIMIT_MIN}`));
  });

  it('rejects values above the maximum', () => {
    expect(() => assertBuildHistoryLimit(BUILD_HISTORY_LIMIT_MAX + 1)).toThrow(
      new RegExp(`at most ${BUILD_HISTORY_LIMIT_MAX}`),
    );
  });

  it('rejects non-integers', () => {
    expect(() => assertBuildHistoryLimit(2.5)).toThrow(/whole number/);
    expect(() => assertBuildHistoryLimit('abc')).toThrow(/whole number/);
  });
});
