import type { SimulationConfig } from './SimulationConfig';

/**
 * Maps a wizard selection to a bundled Containerfile asset.
 * Only combinations with a real asset directory are buildable.
 */
export interface SimulationProfile {
  robot: string;
  distro: string;
  middleware: string;
  engine: string;
  /** Directory under packages/backend/assets/ */
  assetDir: string;
  /** Image repository name (without registry/namespace/tag) */
  imageName: string;
  label: string;
}

export const SIMULATION_PROFILES: readonly SimulationProfile[] = [
  {
    robot: 'turtlebot3',
    distro: 'humble',
    middleware: 'dds',
    engine: 'gazebo',
    assetDir: 'ros2-humble-turtlebot3',
    imageName: 'ros2-humble-turtlebot3',
    label: 'ROS2 Humble + TurtleBot3 + Gazebo (DDS)',
  },
];

export function resolveSimulationProfile(config: SimulationConfig): SimulationProfile | undefined {
  return SIMULATION_PROFILES.find(
    p =>
      p.robot === config.robot &&
      p.distro === config.distro &&
      p.middleware === config.middleware &&
      p.engine === config.engine,
  );
}

export function formatSimulationConfig(config: SimulationConfig): string {
  return `${config.distro}/${config.robot}/${config.middleware}/${config.engine}`;
}

export function simulationImageTag(namespace: string, config: SimulationConfig): string | undefined {
  const profile = resolveSimulationProfile(config);
  if (!profile) return undefined;
  return `quay.io/${namespace}/${profile.imageName}:latest`;
}
