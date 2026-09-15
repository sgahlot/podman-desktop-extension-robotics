/** Max lines retained per in-memory build/push progress log. */
export const MAX_PROGRESS_LOG_LINES = 500;

export const PROGRESS_LOG_TRUNCATION_MARKER = '… earlier log lines truncated …';

/**
 * Format a Date as a zero-padded 24-hour `HH:MM:SS` string in the machine's
 * local timezone (the extension host and the UI both run on the same
 * machine, so "local" here is the timezone of the host running Podman
 * Desktop). Deliberately avoids `toISOString()` (always UTC) and
 * `toLocaleTimeString()` (locale/ICU dependent, may return 12-hour output).
 */
function formatLocalHms(date: Date): string {
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Append a log line, keeping only the most recent {@link MAX_PROGRESS_LOG_LINES}.
 * Mutates `logs` in place so callers sharing the array (progress Maps) stay in sync.
 * Prefixes the line with an HH:MM:SS timestamp (local timezone) captured at ingestion.
 */
export function appendProgressLog(logs: string[], line: string): void {
  const timestamp = formatLocalHms(new Date());
  logs.push(`[${timestamp}] ${line}`);
  if (logs.length <= MAX_PROGRESS_LOG_LINES) {
    return;
  }

  const kept = logs.slice(-(MAX_PROGRESS_LOG_LINES - 1));
  logs.length = 0;
  logs.push(PROGRESS_LOG_TRUNCATION_MARKER, ...kept);
}
