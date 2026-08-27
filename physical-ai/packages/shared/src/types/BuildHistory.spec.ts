import { describe, it, expect } from 'vitest';
import { assertBuildHistoryLimit, BUILD_HISTORY_LIMIT_MIN, BUILD_HISTORY_LIMIT_MAX } from './BuildHistory';

describe('assertBuildHistoryLimit', () => {
  it('accepts integers in range', () => {
    expect(assertBuildHistoryLimit(1)).toBe(1);
    expect(assertBuildHistoryLimit(3)).toBe(3);
    expect(assertBuildHistoryLimit(5)).toBe(5);
  });

  it('rejects values below the minimum', () => {
    expect(() => assertBuildHistoryLimit(0)).toThrow(new RegExp(`at least ${BUILD_HISTORY_LIMIT_MIN}`));
  });

  it('rejects values above the maximum', () => {
    expect(() => assertBuildHistoryLimit(6)).toThrow(new RegExp(`at most ${BUILD_HISTORY_LIMIT_MAX}`));
  });

  it('rejects non-integers', () => {
    expect(() => assertBuildHistoryLimit(2.5)).toThrow(/whole number/);
    expect(() => assertBuildHistoryLimit('abc')).toThrow(/whole number/);
  });
});
