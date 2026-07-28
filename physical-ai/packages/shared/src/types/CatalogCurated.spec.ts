import { describe, it, expect } from 'vitest';
import {
  parseCuratedAllowlist,
  repoMatchesAllowlist,
  filterCuratedRepos,
  DEFAULT_CURATED_ALLOWLIST,
} from './CatalogCurated';

describe('CatalogCurated', () => {
  it('parses comma-separated patterns with trimming', () => {
    expect(parseCuratedAllowlist(' ros2-*-base , ros2-*-turtlebot3 , ros2-*-sim-* ')).toEqual([
      'ros2-*-base',
      'ros2-*-turtlebot3',
      'ros2-*-sim-*',
    ]);
  });

  it('falls back to default when empty', () => {
    expect(parseCuratedAllowlist('')).toEqual(parseCuratedAllowlist(DEFAULT_CURATED_ALLOWLIST));
    expect(parseCuratedAllowlist(null)).toEqual(parseCuratedAllowlist(DEFAULT_CURATED_ALLOWLIST));
  });

  it('matches exact and wildcard patterns', () => {
    const patterns = parseCuratedAllowlist(DEFAULT_CURATED_ALLOWLIST);
    expect(repoMatchesAllowlist('ros2-humble-base', patterns)).toBe(true);
    expect(repoMatchesAllowlist('ros2-jazzy-base', patterns)).toBe(true);
    expect(repoMatchesAllowlist('ros2-humble-turtlebot3', patterns)).toBe(true);
    expect(repoMatchesAllowlist('ros2-jazzy-sim-arm64', patterns)).toBe(true);
    expect(repoMatchesAllowlist('aiobs-foo', patterns)).toBe(false);
  });

  it('filters repository lists', () => {
    const repos = [
      { name: 'ros2-humble-base' },
      { name: 'other-tool' },
      { name: 'ros2-humble-turtlebot3' },
      { name: 'ros2-jazzy-sim-arm64' },
    ];
    expect(filterCuratedRepos(repos, DEFAULT_CURATED_ALLOWLIST).map(r => r.name)).toEqual([
      'ros2-humble-base',
      'ros2-humble-turtlebot3',
      'ros2-jazzy-sim-arm64',
    ]);
  });
});
