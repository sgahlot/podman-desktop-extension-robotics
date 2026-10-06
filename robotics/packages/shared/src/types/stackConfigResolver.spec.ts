import { describe, expect, it } from 'vitest';
import { MANAGED_SIM_CONTEXT_PATHS, MANAGED_SIM_VERIFY_HOOK } from './managedSimRuntime';
import { resolveStackConfig } from './stackConfigResolver';
import { validateLayerRecipe } from './layerRecipe';

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
    expect(config.simRuntimeAssetDir).toBe('ros2-jazzy-sim');
    expect(config.repositoryFragments[0]).toContain('packages.ros.org/ros2/ubuntu');
    expect(config.repositoryFragments[0]).toContain('# ROS 2 apt repository');
  });

  it('loads Fedora 43 lyrical sim from the external recipe catalog', () => {
    const config = resolveStackConfig({
      hardened: 'none',
      baseOs: 'fedora-bootc-43',
      ros: 'ros2-lyrical',
      sim: 'gazebo-nav2-tb3',
    });
    expect(config.rosDistro).toBe('lyrical');
    expect(config.installCommand).toBe('dnf --releasever=43 install -y');
    expect(config.simulationPackages).toContain('ros-gz-sim-runtime');
    expect(config.repositoryFragments[0]).toContain('ros2-lyrical-testing.repo');
    expect(config.simRuntimeAssetDir).toBe('ros2-jazzy-sim');
    expect(config.verifyHooks).toEqual([MANAGED_SIM_VERIFY_HOOK]);
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

  it('rejects an invalid external recipe with its id and field', () => {
    expect(() =>
      validateLayerRecipe('fedora-bootc-43', {
        ui: { label: 'Fedora', note: 'test' },
        imageRef: 'fedora',
        capability: {
          isBootc: true,
          packaging: 'dnf',
          requiresSubscription: false,
          supportedRosDistros: [],
          supportedSimDistros: [],
          hasRosRepo: true,
        },
        installCleanup: '',
        rosPackages: {},
        simulationPackages: {},
      }),
    ).toThrow(/Invalid layer recipe "fedora-bootc-43": installCommand/);
  });
});
