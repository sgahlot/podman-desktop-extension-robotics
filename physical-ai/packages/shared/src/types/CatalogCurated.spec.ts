import { describe, it, expect } from 'vitest';
import {
  parseCuratedAllowlist,
  repoMatchesAllowlist,
  filterCuratedRepos,
  DEFAULT_CURATED_ALLOWLIST,
} from './CatalogCurated';

describe('CatalogCurated', () => {
  it('parses comma-separated patterns with trimming', () => {
    expect(parseCuratedAllowlist(' ros2-*-base , ros2-*-turtlebot3 , ros2-*-sim* ')).toEqual([
      'ros2-*-base',
      'ros2-*-turtlebot3',
      'ros2-*-sim*',
    ]);
  });

  it('falls back to default when empty', () => {
    // Genuine runtime null without writing the `null` literal (lint: no-null).
    const nullValue = JSON.parse('null') as null;
    expect(parseCuratedAllowlist('')).toEqual(parseCuratedAllowlist(DEFAULT_CURATED_ALLOWLIST));
    expect(parseCuratedAllowlist(nullValue)).toEqual(parseCuratedAllowlist(DEFAULT_CURATED_ALLOWLIST));
  });

  it('matches exact and wildcard patterns', () => {
    const patterns = parseCuratedAllowlist(DEFAULT_CURATED_ALLOWLIST);
    expect(repoMatchesAllowlist('ros2-humble-base', patterns)).toBe(true);
    expect(repoMatchesAllowlist('ros2-jazzy-base', patterns)).toBe(true);
    expect(repoMatchesAllowlist('ros2-humble-turtlebot3', patterns)).toBe(true);
    expect(repoMatchesAllowlist('ros2-jazzy-sim', patterns)).toBe(true);
    expect(repoMatchesAllowlist('aiobs-foo', patterns)).toBe(false);
  });

  it('filters repository lists', () => {
    const repos = [
      { name: 'ros2-humble-base' },
      { name: 'other-tool' },
      { name: 'ros2-humble-turtlebot3' },
      { name: 'ros2-jazzy-sim' },
    ];
    expect(filterCuratedRepos(repos, DEFAULT_CURATED_ALLOWLIST).map(r => r.name)).toEqual([
      'ros2-humble-base',
      'ros2-humble-turtlebot3',
      'ros2-jazzy-sim',
    ]);
  });
});
