import { describe, expect, it } from 'vitest';
import { MANAGED_SIM_CONTEXT_PATHS, MANAGED_SIM_VERIFY_HOOK } from './managedSimRuntime';
import { resolveStackConfig } from './stackConfigResolver';

const base = {
  hardened: 'none' as const,
  ros: 'ros2-jazzy' as const,
  sim: 'gazebo-nav2-tb3' as const,
};

describe('resolveStackConfig', () => {
  it('preserves the curated Ubuntu Jazzy stack contract', () => {
    const config = resolveStackConfig({ ...base, baseOs: 'ubuntu-noble' });
    expect(config.packaging).toBe('apt');
    expect(config.rosDistro).toBe('jazzy');
    expect(config.rosPackages).toEqual(['desktop']);
    expect(config.simulationPackages).toContain('ros-gz-sim');
    expect(config.managedSimEligible).toBe(true);
    expect(config.verifyHooks).toEqual([MANAGED_SIM_VERIFY_HOOK]);
    expect(config.copySources).toEqual([...MANAGED_SIM_CONTEXT_PATHS]);
    expect(config.repositoryFragments[0]).toContain('packages.ros.org/ros2/ubuntu');
  });

  it('resolves a Fedora Lyrical custom parent to dnf and Lyrical packages', () => {
    const config = resolveStackConfig({
      ...base,
      baseOs: 'custom',
      customBaseImage: 'quay.io/example/ros:f43-lyrical',
      customBaseOsFamily: 'Fedora',
      customBaseOsVersion: '43',
      customBaseRosDistro: 'lyrical',
      ros: 'ros2-lyrical',
    });
    expect(config.packaging).toBe('dnf');
    expect(config.installCommand).toBe('dnf --releasever=43 install -y');
    expect(config.installCleanup).toBe(' && dnf clean all');
    expect(config.rosPackages).toEqual(['desktop-runtime', 'desktop-devel']);
    expect(config.simulationPackages).toContain('navigation2-runtime');
    expect(config.repositoryFragments[0]).toContain('ros2-lyrical-testing.repo');
  });

  it('rejects an unknown custom OS without an explicit package manager', () => {
    expect(() =>
      resolveStackConfig({
        ...base,
        baseOs: 'custom',
        customBaseImage: 'quay.io/example/robot:latest',
        customBaseOsFamily: 'Acme Linux',
      }),
    ).toThrow('declare its packaging');
  });

  it('requires OS family or packaging when ROS layers are selected', () => {
    expect(() =>
      resolveStackConfig({
        ...base,
        baseOs: 'custom',
        customBaseImage: 'docker.io/library/ubuntu:24.04',
      }),
    ).toThrow('Declare the custom parent OS family or packaging');
  });
});
