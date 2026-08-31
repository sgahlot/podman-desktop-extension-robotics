import { PodmanCliError, runPodman } from './exec';

/**
 * Fail-fast equivalent of the extension's `#getRunningPodmanConnection` — the CLI has no
 * Podman Desktop provider registry to query, so it just confirms a live podman socket/binary.
 */
export async function assertPodmanAvailable(): Promise<void> {
  try {
    await runPodman(['info', '--format', 'json']);
  } catch (err) {
    const detail = err instanceof PodmanCliError ? err.stderrOutput || err.message : String(err);
    throw new Error(`No running Podman connection found (${detail.trim()}). Install/start Podman and try again.`);
  }
}
