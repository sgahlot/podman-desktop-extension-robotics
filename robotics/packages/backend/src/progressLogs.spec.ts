import { describe, it, expect, vi } from 'vitest';
import { appendProgressLog, MAX_PROGRESS_LOG_LINES, PROGRESS_LOG_TRUNCATION_MARKER } from './progressLogs';

describe('appendProgressLog', () => {
  it('appends lines under the cap without a truncation marker', () => {
    const logs: string[] = [];
    appendProgressLog(logs, 'a');
    appendProgressLog(logs, 'b');
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatch(/a$/);
    expect(logs[1]).toMatch(/b$/);
  });

  it('prefixes each line with an HH:MM:SS timestamp', () => {
    const logs: string[] = [];
    appendProgressLog(logs, 'hello');
    expect(logs[0]).toMatch(/^\[\d{2}:\d{2}:\d{2}\] hello$/);
  });

  it('formats the timestamp using the local time-of-day, not UTC', () => {
    // Regression test: the timestamp must come from getHours()/getMinutes()/getSeconds()
    // (local timezone), not toISOString() (always UTC). Fake a fixed instant and compare
    // against both possible sources so the assertion holds regardless of the machine's
    // configured timezone offset (including offsets where local and UTC coincide).
    const fixed = new Date('2026-08-19T15:59:37.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(fixed);

    const logs: string[] = [];
    appendProgressLog(logs, 'hello');

    const pad = (n: number): string => n.toString().padStart(2, '0');
    const expectedLocal = `${pad(fixed.getHours())}:${pad(fixed.getMinutes())}:${pad(fixed.getSeconds())}`;
    expect(logs[0]).toBe(`[${expectedLocal}] hello`);

    vi.useRealTimers();
  });

  it('keeps only the newest lines once the cap is exceeded', () => {
    const logs: string[] = [];
    for (let i = 0; i < MAX_PROGRESS_LOG_LINES + 25; i++) {
      appendProgressLog(logs, `line-${i}`);
    }

    expect(logs).toHaveLength(MAX_PROGRESS_LOG_LINES);
    expect(logs[0]).toBe(PROGRESS_LOG_TRUNCATION_MARKER);
    expect(logs[1]).toMatch(/line-26$/);
    expect(logs.at(-1)).toMatch(new RegExp(`line-${MAX_PROGRESS_LOG_LINES + 24}$`));
  });
});
