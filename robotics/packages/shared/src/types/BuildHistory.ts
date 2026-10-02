import type { HardenedApp } from './layerCompatibility';
import { isBundledToolSmokeCheckSupported } from '../build/bundledToolSmokeCheck';

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

/** Per composition-layer cache outcome for a Layers-wizard build (APPENG-6298 / S10-4). */
export interface LayerCacheStatusEntry {
  /** Display label, e.g. "Base OS", "ROS". */
  layer: string;
  /** True when every Containerfile step for this layer was a Podman cache hit. */
  cached: boolean;
  /**
   * True when this layer came from the parent image (`FROM` local base/hardened) and was
   * not built by the Dockerfile for this build step (preset hardened/sim middle images).
   */
  reused?: boolean;
}

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
   * SBOM text from the external Syft scan run against the built image. Present only for
   * builds that opted in with the Syft companion selected and where generation succeeded.
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
  /**
   * Present when the build succeeded and SBOM generation was requested but failed — the
   * image build itself is unaffected. Shown in Recent Builds separately from `errorMessage`.
   */
  sbomErrorMessage?: string;
  /**
   * Per-layer Podman cache summary for Layers-wizard containerfile builds. Absent for
   * preset-path builds, bundled asset builds, and entries recorded before APPENG-6298.
   */
  layerCacheStatus?: LayerCacheStatusEntry[];
  /** Bundled Hummingbird tools present in this image. Absent for legacy entries. */
  bundledTools?: HardenedApp[];
  /** True only when this entry represents the user-facing final customized image. */
  isFinalArtifact?: boolean;
  /**
   * Smoke-check results for bake-in Hummingbird tools (e.g. `cosign version` inside the image).
   * Not signature verification or other tool-specific workflows — those stay future work.
   */
  bundledToolVerifications?: BundledToolVerificationResult[];
}

export interface BundledToolVerificationResult {
  tool: HardenedApp;
  success: boolean;
  /** Command stdout on success (may be large; still small for smoke checks). */
  output?: string;
  /** User-facing failure when the smoke check did not succeed. */
  errorMessage?: string;
  /** Epoch ms when the check last ran. */
  verifiedAt: number;
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

export function verifiableBundledTools(entry: BuildHistoryEntry): HardenedApp[] {
  return (entry.bundledTools ?? []).filter(tool => isBundledToolSmokeCheckSupported(tool));
}

export function bundledToolVerificationFor(
  entry: BuildHistoryEntry,
  tool: HardenedApp,
): BundledToolVerificationResult | undefined {
  return entry.bundledToolVerifications?.find(v => v.tool === tool);
}

/**
 * User-facing SBOM scan error for Recent Builds — raw Podman/libpod messages (EOF on export,
 * exit 125, long API URLs) are normalized without changing the logged backend error.
 */
export function formatSbomScanErrorMessage(raw: string): string {
  const normalized = raw.replace(/\s+/g, ' ').trim();
  const lower = normalized.toLowerCase();
  if (lower.includes('eof') && (lower.includes('libpod/images/export') || lower.includes('images/export'))) {
    return (
      'Podman Desktop or the Podman engine stopped before the SBOM scan finished ' +
      '(image export was interrupted). Keep Podman Desktop open until Recent Builds shows the SBOM, ' +
      'or rebuild with Syft selected to try again.'
    );
  }
  if (
    lower.includes('connection refused') ||
    lower.includes('cannot connect to') ||
    (lower.includes('podman machine') && lower.includes('not running'))
  ) {
    return (
      'Could not reach Podman while generating the SBOM. Ensure Podman Desktop is running, ' +
      'then rebuild with Syft selected.'
    );
  }
  if (normalized.length > 240) {
    return `${normalized.slice(0, 237)}…`;
  }
  return normalized;
}

/** Stable id for one build attempt — `${tag}` and `startedAt` are both required (rebuilds reuse tag). */
export function buildHistoryRecordKey(tag: string, startedAt: number): string {
  return `${tag}\u0000${startedAt}`;
}

/**
 * Insert or replace one build row by `(tag, startedAt)`. Never drops an entry silently —
 * callers persist the returned array.
 */
export function upsertBuildHistoryEntry(history: BuildHistoryEntry[], entry: BuildHistoryEntry): BuildHistoryEntry[] {
  const idx = history.findIndex(e => e.tag === entry.tag && e.startedAt === entry.startedAt);
  if (idx === -1) {
    return [entry, ...history];
  }
  const next = [...history];
  next[idx] = { ...next[idx], ...entry };
  return next;
}

/**
 * Build history retention bounds (Preferences: physical-ai.build.historyLimit). The max was
 * 5 originally because every retained entry could carry its full SBOM text — now that SBOM
 * text is fetched on demand rather than shipped with the list (APPENG-6265), a higher
 * ceiling mainly costs disk space, not UI payload; default stays low since most entries
 * never carry an SBOM at all (only builds that opt in via the Syft companion do).
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
