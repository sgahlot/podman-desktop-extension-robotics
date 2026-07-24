import { describe, it, expect } from 'vitest';
import {
  resolveSimulationProfile,
  hasSimulationSupport,
  simulationImageTag,
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
    expect(
      resolveSimulationProfile({ ...supported, middleware: 'zenoh' }),
    ).toBeUndefined();
    expect(
      resolveSimulationProfile({ ...supported, distro: 'rolling' }),
    ).toBeUndefined();
  });

  it('resolves the jazzy base-only profile', () => {
    const profile = resolveSimulationProfile({ ...supported, distro: 'jazzy', baseImage: 'jazzy' });
    expect(profile).toBeDefined();
    expect(profile!.baseAssetDir).toBe('ros2-jazzy-base');
    expect(profile!.baseImageName).toBe('ros2-jazzy-base');
    expect(profile!.assetDir).toBeUndefined();
    expect(profile!.imageName).toBeUndefined();
  });

  it('reports simulation support correctly', () => {
    const humble = resolveSimulationProfile(supported)!;
    expect(hasSimulationSupport(humble)).toBe(true);

    const jazzy = resolveSimulationProfile({ ...supported, distro: 'jazzy', baseImage: 'jazzy' })!;
    expect(hasSimulationSupport(jazzy)).toBe(false);
  });

  it('builds the image tag from the profile and base image preset', () => {
    expect(simulationImageTag('ecosystem-appeng', supported)).toBe(
      'quay.io/ecosystem-appeng/ros2-humble-turtlebot3:latest',
    );
    expect(
      simulationImageTag('ecosystem-appeng', { ...supported, baseImage: 'osrf' }),
    ).toBe('quay.io/ecosystem-appeng/ros2-humble-turtlebot3:osrf');
    expect(simulationImageTag('ecosystem-appeng', { ...supported, distro: 'jazzy', baseImage: 'jazzy' })).toBeUndefined();
  });

  it('formats config for error messages', () => {
    expect(formatSimulationConfig(supported)).toBe('humble/turtlebot3/dds/gazebo/sloretz');
  });

  it('has at least one buildable profile', () => {
    expect(SIMULATION_PROFILES.length).toBeGreaterThan(0);
  });
});
