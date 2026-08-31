/** Formats a duration given in seconds as "Ns" under a minute, "Mm Ss" at or above. */
export function formatDurationSeconds(seconds: number): string {
  if (seconds < 60) {
    const s = seconds % 1 === 0 ? String(seconds) : seconds.toFixed(1);
    return `${s}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}
