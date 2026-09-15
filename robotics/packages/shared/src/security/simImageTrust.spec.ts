import { describe, it, expect } from 'vitest';
import {
  assertLaunchImageTag,
  extractImageRepoName,
  imageRefMatchesAllowlist,
  isSimLaunchImageRef,
  parseSimLaunchAllowlist,
  DEFAULT_SIM_LAUNCH_ALLOWLIST,
} from './simImageTrust';

describe('simImageTrust', () => {
  it('extracts repo names from tags and digests', () => {
    expect(extractImageRepoName('quay.io/ns/ros2-jazzy-sim:noble')).toBe('ros2-jazzy-sim');
    expect(
      extractImageRepoName(
        'quay.io/ns/ros2-jazzy-sim@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ),
    ).toBe('ros2-jazzy-sim');
    expect(extractImageRepoName('ros2-humble-turtlebot3:sloretz')).toBe('ros2-humble-turtlebot3');
  });

  it('defaults allowlist to sim / turtlebot3 patterns', () => {
    expect(parseSimLaunchAllowlist(undefined).join(',')).toBe(DEFAULT_SIM_LAUNCH_ALLOWLIST);
    expect(assertLaunchImageTag('quay.io/ns/ros2-jazzy-sim:noble')).toBe('quay.io/ns/ros2-jazzy-sim:noble');
    expect(assertLaunchImageTag('quay.io/ns/ros2-humble-turtlebot3:sloretz')).toContain('turtlebot3');
  });

  it('rejects non-sim images under default allowlist', () => {
    expect(() => assertLaunchImageTag('docker.io/library/nginx:latest')).toThrow(/not allowed/);
    expect(() => assertLaunchImageTag('quay.io/ns/ros2-jazzy-base:noble')).toThrow(/not allowed/);
    expect(isSimLaunchImageRef('quay.io/ns/malware-sim:latest')).toBe(false);
  });

  it('rejects unsafe characters in image refs', () => {
    expect(() => assertLaunchImageTag('ros2-jazzy-sim:noble;id')).toThrow(/Invalid/);
    expect(() => assertLaunchImageTag('ros2-jazzy-sim:$(id)')).toThrow(/Invalid/);
  });

  it('honors optional golden allowlist (exact tag / digest)', () => {
    const digest = 'quay.io/ns/ros2-jazzy-sim@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    expect(assertLaunchImageTag(digest, digest)).toBe(digest);
    expect(() => assertLaunchImageTag('quay.io/ns/ros2-jazzy-sim:noble', digest)).toThrow(/not allowed/);
    expect(imageRefMatchesAllowlist('quay.io/ns/ros2-jazzy-sim:noble', ['quay.io/ns/ros2-jazzy-sim:*'])).toBe(true);
  });
});
