import { runPodman } from './exec';

/**
 * Returns the local image's architecture (e.g. `amd64`, `arm64`) as reported by podman. Used
 * so `build:sim` can build its own layer for whatever arch `--base-tag` actually is, instead
 * of trusting a separately-specified flag that could silently drift out of sync with it.
 */
export async function getImageArchitecture(tag: string): Promise<string> {
  const { stdout } = await runPodman(['image', 'inspect', '--format', '{{.Architecture}}', tag]);
  return stdout.trim();
}
