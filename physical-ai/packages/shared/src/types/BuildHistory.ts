/**
 * A persisted record of one completed (or failed) image build — survives navigating away
 * from the Image Builder page and Podman Desktop restarts (APPENG-6226). Written by the
 * backend after a build settles (see PhysicalAiApiImpl#recordBuildHistory); cancelled
 * builds are never recorded.
 *
 * Logs are intentionally never stored here — they stay ephemeral (BuildProgress.logs),
 * exactly as today.
 */
export interface BuildHistoryEntry {
  tag: string;
  arch: 'amd64' | 'arm64';
  /** Epoch ms when the build started. */
  startedAt: number;
  durationMs: number;
  success: boolean;
  /** Present only when `success` is false. */
  errorMessage?: string;
  /**
   * SPDX-JSON SBOM text from `syft dir:/ -o spdx-json` run against the built image.
   * Present only for builds that opted in (a Layers-wizard build with the `syft`
   * Hummingbird tool selected) and where SBOM generation succeeded.
   */
  sbom?: string;
}

/** Build history retention bounds (Preferences: physical-ai.buildHistoryLimit). */
export const BUILD_HISTORY_LIMIT_MIN = 1;
export const BUILD_HISTORY_LIMIT_MAX = 5;
export const BUILD_HISTORY_LIMIT_DEFAULT = 5;

/**
 * Validate a build history limit from settings. Throws a user-facing message when out of
 * range — mirrors ros/topicPeek.ts's assertPeekTimeoutSeconds convention.
 */
export function assertBuildHistoryLimit(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(
      `Build history limit must be a whole number between ${BUILD_HISTORY_LIMIT_MIN} and ${BUILD_HISTORY_LIMIT_MAX} (got ${String(value)}).`,
    );
  }
  if (n < BUILD_HISTORY_LIMIT_MIN) {
    throw new Error(
      `Build history limit must be at least ${BUILD_HISTORY_LIMIT_MIN} (got ${n}). ` +
        'Change Preferences → Physical AI → Build history limit.',
    );
  }
  if (n > BUILD_HISTORY_LIMIT_MAX) {
    throw new Error(
      `Build history limit must be at most ${BUILD_HISTORY_LIMIT_MAX} (got ${n}). ` +
        'Change Preferences → Physical AI → Build history limit.',
    );
  }
  return n;
}
