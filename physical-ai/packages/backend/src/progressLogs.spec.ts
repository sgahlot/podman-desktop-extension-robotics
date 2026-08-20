import { describe, it, expect } from 'vitest';
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
