import { describe, it, expect } from 'vitest';
import { formatDurationSeconds } from './formatDuration';

describe('formatDurationSeconds', () => {
  it('formats sub-minute integer durations with no decimal', () => {
    expect(formatDurationSeconds(45)).toBe('45s');
  });

  it('formats sub-minute fractional durations with one decimal', () => {
    expect(formatDurationSeconds(12.3)).toBe('12.3s');
  });

  it('formats exactly one minute as "1m 0s"', () => {
    expect(formatDurationSeconds(60)).toBe('1m 0s');
  });

  it('formats a long build as minutes and seconds', () => {
    expect(formatDurationSeconds(1150.2)).toBe('19m 10s');
  });

  it('rounds the seconds remainder', () => {
    expect(formatDurationSeconds(125.6)).toBe('2m 6s');
  });
});
