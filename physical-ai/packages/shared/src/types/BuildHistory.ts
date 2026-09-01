/**
 * A persisted record of one completed (or failed) image build — survives navigating away
 * from the Image Builder page and Podman Desktop restarts (APPENG-6226). Written by the
 * backend after a build settles (see PhysicalAiApiImpl#recordBuildHistory); cancelled
 * builds are never recorded.
 *
 * Logs are intentionally never stored here — they stay ephemeral (BuildProgress.logs),
 * exactly as today.
 */
/**
 * SBOM output format passed to `syft -o <format>`. CycloneDX is recommended: for the same
 * content it's typically much smaller than SPDX, which generates many combinatorial CPE
 * (vulnerability-matching) string variants per package in `externalRefs` — for a real
 * multi-thousand-package image (ROS/Gazebo/Python/Ruby ecosystems all cataloged together)
 * this pushed a real SBOM to 84MB, well past a reasonable clipboard/render size, whereas
 * CycloneDX for the same content ran ~54% smaller in testing. SPDX remains selectable for
 * anyone specifically feeding this into SPDX-only downstream tooling.
 */
export type SbomFormat = 'cyclonedx-json' | 'spdx-json';
export const SBOM_FORMAT_DEFAULT: SbomFormat = 'cyclonedx-json';

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
   * SBOM text from `syft dir:/ -o <sbomFormat>` run against the built image. Present only
   * for builds that opted in (a Layers-wizard build with the `syft` Hummingbird tool
   * selected) and where SBOM generation succeeded.
   */
  sbom?: string;
  /** The format `sbom` was generated in — undefined only for pre-existing entries recorded
   * before this field existed, which are always SPDX (the only format that ever existed). */
  sbomFormat?: SbomFormat;
  /**
   * Package/component count parsed from `sbom` once, at record time — lets the polled
   * "list" view (see `PhysicalAiApi.getBuildHistory`, which strips `sbom` itself) show a
   * count without ever shipping the SBOM text, which can run tens of MB (APPENG-6265).
   * Absent for entries recorded before this field existed.
   */
  sbomPackageCount?: number;
}

/**
 * Package/component count from an SBOM's JSON — SPDX uses a `packages` array, CycloneDX
 * uses `components`. Checks by declared format first (entries recorded before `sbomFormat`
 * existed are always SPDX), falling back to whichever array is actually present.
 */
export function parseSbomPackageCount(sbom: string, format: SbomFormat | undefined): number | undefined {
  try {
    const parsed = JSON.parse(sbom) as { packages?: unknown[]; components?: unknown[] };
    const arr = format === 'cyclonedx-json' ? parsed.components : (parsed.packages ?? parsed.components);
    return Array.isArray(arr) ? arr.length : undefined;
  } catch {
    return undefined;
  }
}

/** "packages" for SPDX, "components" for CycloneDX — matches each format's own terminology. */
export function sbomItemLabel(format: SbomFormat | undefined): string {
  return format === 'cyclonedx-json' ? 'components' : 'packages';
}

/**
 * Build history retention bounds (Preferences: physical-ai.buildHistoryLimit). The max was
 * 5 originally because every retained entry could carry its full SBOM text — now that SBOM
 * text is fetched on demand rather than shipped with the list (APPENG-6265), a higher
 * ceiling mainly costs disk space, not UI payload; default stays low since most entries
 * never carry an SBOM at all (only Layers-wizard builds that opt in via the syft tool do).
 */
export const BUILD_HISTORY_LIMIT_MIN = 1;
export const BUILD_HISTORY_LIMIT_MAX = 20;
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
