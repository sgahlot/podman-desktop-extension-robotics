/**
 * Catalog curated-repo matching.
 * Patterns are comma-separated; `*` is a wildcard within a name. A pattern without `*`
 * matches repository names containing that term, which is convenient for registry-specific
 * names such as `box` matching `busybox`.
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
  const normalizedRepoName = repoName.toLowerCase();
  return patterns.some(pattern => {
    const normalizedPattern = pattern.toLowerCase();
    if (!pattern.includes('*')) {
      return normalizedRepoName.includes(normalizedPattern);
    }
    const escaped = normalizedPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(normalizedRepoName);
  });
}

export function filterCuratedRepos<T extends { name: string }>(
  repos: T[],
  allowlistRaw: string | undefined | null,
): T[] {
  const patterns = parseCuratedAllowlist(allowlistRaw);
  return repos.filter(r => repoMatchesAllowlist(r.name, patterns));
}
