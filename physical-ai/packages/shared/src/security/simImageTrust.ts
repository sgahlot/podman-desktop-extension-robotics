/**
 * Trust boundary for simulation launch images.
 *
 * Local image *content* is trusted once selected: the extension runs
 * `/entrypoint-gazebo.sh` from that image. Tag/name matching is not
 * cryptographic verification — a malicious image retagged to match can
 * still run attacker scripts inside the container.
 *
 * Mitigations:
 * - Server-side allowlist (default: ros2-*-sim* / ros2-*-turtlebot3 repo names)
 * - Optional preference to pin exact tags or digests for demos
 * - Prefer images built via Image Builder or pulled from your Quay namespace
 */

import { repoMatchesAllowlist } from '../types/CatalogCurated';

/** Default when preference is empty — repo-name patterns only. */
export const DEFAULT_SIM_LAUNCH_ALLOWLIST = 'ros2-*-sim*,ros2-*-turtlebot3';

const UNSAFE_IMAGE_REF_RE = /[\s;|&`$()<>\\\0]/;
const DIGEST_SUFFIX_RE = /@sha256:[a-fA-F0-9]{64}$/;

export function parseSimLaunchAllowlist(raw: string | undefined | null): string[] {
  if (!raw?.trim()) {
    return DEFAULT_SIM_LAUNCH_ALLOWLIST.split(',').map(s => s.trim());
  }
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/** Repo name (last path segment), stripping tag or digest. */
export function extractImageRepoName(imageRef: string): string {
  let ref = imageRef.trim();
  const at = ref.indexOf('@');
  if (at >= 0) {
    ref = ref.slice(0, at);
  }
  const colon = ref.lastIndexOf(':');
  if (colon >= 0) {
    const after = ref.slice(colon + 1);
    // Tag (not registry port): no slash after colon, and not only digits
    if (!after.includes('/') && !/^\d+$/.test(after)) {
      ref = ref.slice(0, colon);
    }
  }
  const slash = ref.lastIndexOf('/');
  return slash >= 0 ? ref.slice(slash + 1) : ref;
}

function isFullImagePattern(pattern: string): boolean {
  return pattern.includes('/') || pattern.includes('@') || pattern.includes(':');
}

/** Match full image ref or repo-name pattern (* = any chars). */
export function imageRefMatchesAllowlist(imageRef: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const repoName = extractImageRepoName(imageRef);
  return patterns.some(pattern => {
    if (isFullImagePattern(pattern)) {
      if (!pattern.includes('*')) {
        return imageRef === pattern;
      }
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      return new RegExp(`^${escaped}$`).test(imageRef);
    }
    return repoMatchesAllowlist(repoName, [pattern]);
  });
}

/** True if a local tag should appear in the Simulation image picker. */
export function isSimLaunchImageRef(
  imageRef: string,
  allowlistRaw?: string | null,
): boolean {
  try {
    assertLaunchImageTag(imageRef, allowlistRaw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates imageTag for launchSimulation.
 * @param allowlistRaw preference value; empty/undefined → default name patterns
 */
export function assertLaunchImageTag(
  imageTag: string,
  allowlistRaw?: string | null,
): string {
  if (!imageTag || typeof imageTag !== 'string') {
    throw new Error('Simulation image tag is required.');
  }
  const trimmed = imageTag.trim();
  if (trimmed.length > 512) {
    throw new Error('Simulation image tag is too long.');
  }
  if (UNSAFE_IMAGE_REF_RE.test(trimmed)) {
    throw new Error(`Invalid simulation image tag "${trimmed}".`);
  }
  // If digest present, require well-formed sha256
  const at = trimmed.indexOf('@');
  if (at >= 0 && !DIGEST_SUFFIX_RE.test(trimmed.slice(at))) {
    throw new Error(
      `Invalid image digest in "${trimmed}". Use @sha256:<64 hex chars>.`,
    );
  }

  const patterns = parseSimLaunchAllowlist(allowlistRaw);
  if (!imageRefMatchesAllowlist(trimmed, patterns)) {
    throw new Error(
      `Image "${trimmed}" is not allowed for simulation launch. ` +
        `Use a ros2-*-sim* / ros2-*-turtlebot3 image, or set Preferences → ` +
        `Physical AI → Simulation image allowlist.`,
    );
  }
  return trimmed;
}
