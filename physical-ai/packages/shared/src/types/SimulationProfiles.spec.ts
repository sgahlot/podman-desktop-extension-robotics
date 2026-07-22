import { describe, it, expect } from 'vitest';
import {
  resolveSimulationProfile,
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
      resolveSimulationProfile({ ...supported, distro: 'jazzy' }),
    ).toBeUndefined();
    expect(
      resolveSimulationProfile({ ...supported, middleware: 'zenoh' }),
    ).toBeUndefined();
  });

  it('builds the image tag from the profile and base image preset', () => {
    expect(simulationImageTag('ecosystem-appeng', supported)).toBe(
      'quay.io/ecosystem-appeng/ros2-humble-turtlebot3:latest',
    );
    expect(
      simulationImageTag('ecosystem-appeng', { ...supported, baseImage: 'osrf' }),
    ).toBe('quay.io/ecosystem-appeng/ros2-humble-turtlebot3:osrf');
    expect(simulationImageTag('ecosystem-appeng', { ...supported, distro: 'jazzy' })).toBeUndefined();
  });

  it('formats config for error messages', () => {
    expect(formatSimulationConfig(supported)).toBe('humble/turtlebot3/dds/gazebo/sloretz');
  });

  it('has at least one buildable profile', () => {
    expect(SIMULATION_PROFILES.length).toBeGreaterThan(0);
  });
});
