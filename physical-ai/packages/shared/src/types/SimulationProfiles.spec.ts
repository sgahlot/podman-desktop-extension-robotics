import { describe, it, expect } from 'vitest';
import {
  resolveSimulationProfile,
  hasSimulationSupport,
  simulationImageTag,
  baseImageTag,
  formatSimulationConfig,
  SIMULATION_PROFILES,
} from './SimulationProfiles';
import type { SimulationConfig } from './SimulationConfig';

describe('SimulationProfiles', () => {
  const supported: SimulationConfig = {
    robot: 'turtlebot3',
    distro: 'humble',
    middleware: 'dds',
    engine: 'gazebo',
    baseImage: 'sloretz',
  };

  it('resolves the humble turtlebot3 profile', () => {
    const profile = resolveSimulationProfile(supported);
    expect(profile).toBeDefined();
    expect(profile!.assetDir).toBe('ros2-humble-turtlebot3');
    expect(profile!.imageName).toBe('ros2-humble-turtlebot3');
  });

  it('returns undefined for unsupported combinations', () => {
    // Zenoh is only supported on the jazzy profile added below (APPENG-5775); humble +
    // zenoh has no profile and correctly stays unresolved.
    expect(resolveSimulationProfile({ ...supported, middleware: 'zenoh' })).toBeUndefined();
    expect(resolveSimulationProfile({ ...supported, distro: 'rolling' })).toBeUndefined();
  });

  it('resolves the jazzy zenoh simulation profile (APPENG-5775)', () => {
    // rmw_zenoh_cpp is baked into the same ros2-jazzy-sim image as the dds profile —
    // middleware is a runtime choice (RMW_IMPLEMENTATION), not a separate build, so
    // this profile shares assetDir/imageName with the jazzy dds profile.
    const profile = resolveSimulationProfile({
      ...supported,
      distro: 'jazzy',
      middleware: 'zenoh',
      baseImage: 'jazzy-noble',
    });
    expect(profile).toBeDefined();
    expect(profile!.baseAssetDir).toBe('ros2-jazzy-base');
    expect(profile!.baseImageName).toBe('ros2-jazzy-base');
    expect(profile!.assetDir).toBe('ros2-jazzy-sim');
    expect(profile!.imageName).toBe('ros2-jazzy-sim');
    expect(profile!.label).not.toBe(
      resolveSimulationProfile({ ...supported, distro: 'jazzy', baseImage: 'jazzy-noble' })!.label,
    );
  });

  it('resolves the jazzy simulation profile', () => {
    const profile = resolveSimulationProfile({
      ...supported,
      distro: 'jazzy',
      baseImage: 'jazzy-noble',
    });
    expect(profile).toBeDefined();
    expect(profile!.baseAssetDir).toBe('ros2-jazzy-base');
    expect(profile!.baseImageName).toBe('ros2-jazzy-base');
    expect(profile!.assetDir).toBe('ros2-jazzy-sim');
    expect(profile!.imageName).toBe('ros2-jazzy-sim');
  });

  it('reports simulation support correctly', () => {
    const humble = resolveSimulationProfile(supported)!;
    expect(hasSimulationSupport(humble)).toBe(true);

    const jazzy = resolveSimulationProfile({
      ...supported,
      distro: 'jazzy',
      baseImage: 'jazzy-noble',
    })!;
    expect(hasSimulationSupport(jazzy)).toBe(true);

    const jazzyZenoh = resolveSimulationProfile({
      ...supported,
      distro: 'jazzy',
      middleware: 'zenoh',
      baseImage: 'jazzy-noble',
    })!;
    expect(hasSimulationSupport(jazzyZenoh)).toBe(true);
  });

  it('builds the image tag from the profile and base image preset', () => {
    expect(simulationImageTag('ecosystem-appeng', supported)).toBe(
      'quay.io/ecosystem-appeng/ros2-humble-turtlebot3:sloretz',
    );
    expect(simulationImageTag('ecosystem-appeng', { ...supported, baseImage: 'osrf' })).toBe(
      'quay.io/ecosystem-appeng/ros2-humble-turtlebot3:osrf',
    );
    expect(
      simulationImageTag('ecosystem-appeng', {
        ...supported,
        distro: 'jazzy',
        baseImage: 'jazzy-noble',
      }),
    ).toBe('quay.io/ecosystem-appeng/ros2-jazzy-sim:noble');
    expect(
      baseImageTag('ecosystem-appeng', {
        ...supported,
        distro: 'jazzy',
        baseImage: 'jazzy-noble',
      }),
    ).toBe('quay.io/ecosystem-appeng/ros2-jazzy-base:noble');
    // Same image as the dds jazzy profile (APPENG-5775) — zenoh is a runtime
    // middleware choice, not a separate build, so both tags match.
    expect(
      simulationImageTag('ecosystem-appeng', {
        ...supported,
        distro: 'jazzy',
        middleware: 'zenoh',
        baseImage: 'jazzy-noble',
      }),
    ).toBe('quay.io/ecosystem-appeng/ros2-jazzy-sim:noble');
    expect(
      baseImageTag('ecosystem-appeng', {
        ...supported,
        distro: 'jazzy',
        middleware: 'zenoh',
        baseImage: 'jazzy-noble',
      }),
    ).toBe('quay.io/ecosystem-appeng/ros2-jazzy-base:noble');
  });

  it('formats config for error messages', () => {
    expect(formatSimulationConfig(supported)).toBe('humble/turtlebot3/dds/gazebo/sloretz');
  });

  it('has at least one buildable profile', () => {
    expect(SIMULATION_PROFILES.length).toBeGreaterThan(0);
  });
});
