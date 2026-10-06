/**
 * Catalog curated-repo matching.
 * Patterns are comma-separated in preferences; `*` is a wildcard within a name segment.
 * Examples: `ros2-*-base`, `ros2-humble-turtlebot3`
 */

import { defaultCatalogViewMode, defaultCuratedAllowlistFromCatalog } from '../config/platformDefaultsCatalog';

export const DEFAULT_CATALOG_VIEW_MODE = defaultCatalogViewMode();
export type CatalogViewMode = 'all' | 'curated';

export const DEFAULT_CURATED_ALLOWLIST = defaultCuratedAllowlistFromCatalog();

export function parseCuratedAllowlist(raw: string | undefined | null): string[] {
  if (!raw?.trim()) {
    return parseCuratedAllowlist(DEFAULT_CURATED_ALLOWLIST);
  }
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/** True if repo name matches any allowlist pattern (* = any chars). */
export function repoMatchesAllowlist(repoName: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  return patterns.some(pattern => {
    if (!pattern.includes('*')) {
      return repoName === pattern;
    }
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(repoName);
  });
}

export function filterCuratedRepos<T extends { name: string }>(
  repos: T[],
  allowlistRaw: string | undefined | null,
): T[] {
  const patterns = parseCuratedAllowlist(allowlistRaw);
  return repos.filter(r => repoMatchesAllowlist(r.name, patterns));
}
