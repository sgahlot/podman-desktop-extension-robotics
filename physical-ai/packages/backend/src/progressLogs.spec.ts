import { describe, it, expect } from 'vitest';
import {
  appendProgressLog,
  MAX_PROGRESS_LOG_LINES,
  PROGRESS_LOG_TRUNCATION_MARKER,
} from './progressLogs';

describe('appendProgressLog', () => {
  it('appends lines under the cap without a truncation marker', () => {
    const logs: string[] = [];
    appendProgressLog(logs, 'a');
    appendProgressLog(logs, 'b');
    expect(logs).toEqual(['a', 'b']);
  });

  it('keeps only the newest lines once the cap is exceeded', () => {
    const logs: string[] = [];
    for (let i = 0; i < MAX_PROGRESS_LOG_LINES + 25; i++) {
      appendProgressLog(logs, `line-${i}`);
    }

    expect(logs).toHaveLength(MAX_PROGRESS_LOG_LINES);
    expect(logs[0]).toBe(PROGRESS_LOG_TRUNCATION_MARKER);
    expect(logs[1]).toBe(`line-26`);
    expect(logs.at(-1)).toBe(`line-${MAX_PROGRESS_LOG_LINES + 24}`);
  });
});
