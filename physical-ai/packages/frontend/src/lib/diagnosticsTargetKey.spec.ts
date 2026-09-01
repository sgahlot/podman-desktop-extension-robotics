import { describe, it, expect } from 'vitest';
import { localTargetKey, ocTargetKey } from './diagnosticsTargetKey';

describe('localTargetKey', () => {
  it('builds a podman-prefixed key from the container id', () => {
    expect(localTargetKey('c1')).toBe('podman:c1');
  });
});

describe('ocTargetKey', () => {
  it('builds an oc-prefixed key from namespace, workload and context', () => {
    expect(ocTargetKey('ns1', 'ros2-jazzy-sim', 'my-context')).toBe('oc:ns1/ros2-jazzy-sim/my-context');
  });

  it('falls back to an empty context segment when context is undefined', () => {
    expect(ocTargetKey('ns1', 'ros2-jazzy-sim', undefined)).toBe('oc:ns1/ros2-jazzy-sim/');
  });
});
