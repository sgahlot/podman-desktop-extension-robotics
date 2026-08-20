/** Max lines retained per in-memory build/push progress log. */
export const MAX_PROGRESS_LOG_LINES = 500;

export const PROGRESS_LOG_TRUNCATION_MARKER = '… earlier log lines truncated …';

/**
 * Append a log line, keeping only the most recent {@link MAX_PROGRESS_LOG_LINES}.
 * Mutates `logs` in place so callers sharing the array (progress Maps) stay in sync.
 * Prefixes the line with an HH:MM:SS timestamp captured at ingestion.
 */
export function appendProgressLog(logs: string[], line: string): void {
  const timestamp = new Date().toISOString().substring(11, 19);
  logs.push(`[${timestamp}] ${line}`);
  if (logs.length <= MAX_PROGRESS_LOG_LINES) {
    return;
  }

  const kept = logs.slice(-(MAX_PROGRESS_LOG_LINES - 1));
  logs.length = 0;
  logs.push(PROGRESS_LOG_TRUNCATION_MARKER, ...kept);
}
