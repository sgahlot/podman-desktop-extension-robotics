import type { SimulationConfig } from './SimulationConfig';
import { resolveSimulationBaseImage } from './SimulationBaseImages';

/**
 * Maps a wizard selection to a bundled Containerfile asset.
 * Only combinations with a real asset directory are buildable.
 */
export interface SimulationProfile {
  robot: string;
  distro: string;
  middleware: string;
  engine: string;
  /** Directory under packages/backend/assets/ for the base image */
  baseAssetDir: string;
  /** Base image repository name (without registry/namespace/tag) */
  baseImageName: string;
  /** Directory under packages/backend/assets/ for the simulation image (undefined = not yet available) */
  assetDir?: string;
  /** Simulation image repository name (without registry/namespace/tag) */
  imageName?: string;
  label: string;
}

export const SIMULATION_PROFILES: readonly SimulationProfile[] = [
  {
    robot: 'turtlebot3',
    distro: 'humble',
    middleware: 'dds',
    engine: 'gazebo',
    baseAssetDir: 'ros2-humble-base',
    baseImageName: 'ros2-humble-base',
    assetDir: 'ros2-humble-turtlebot3',
    imageName: 'ros2-humble-turtlebot3',
    label: 'ROS2 Humble + TurtleBot3 + Gazebo (DDS)',
  },
  {
    robot: 'turtlebot3',
    distro: 'jazzy',
    middleware: 'dds',
    engine: 'gazebo',
    baseAssetDir: 'ros2-jazzy-base',
    baseImageName: 'ros2-jazzy-base',
    label: 'ROS2 Jazzy Base (simulation not yet available)',
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
  return `${config.distro}/${config.robot}/${config.middleware}/${config.engine}/${config.baseImage}`;
}

export function baseImageTag(namespace: string, config: SimulationConfig): string | undefined {
  const profile = resolveSimulationProfile(config);
  if (!profile) return undefined;
  const base = resolveSimulationBaseImage(config.baseImage);
  return `quay.io/${namespace}/${profile.baseImageName}:${base.imageTag}`;
}

export function hasSimulationSupport(profile: SimulationProfile): boolean {
  return !!profile.assetDir && !!profile.imageName;
}

export function simulationImageTag(namespace: string, config: SimulationConfig): string | undefined {
  const profile = resolveSimulationProfile(config);
  if (!profile || !profile.imageName) return undefined;
  const base = resolveSimulationBaseImage(config.baseImage);
  return `quay.io/${namespace}/${profile.imageName}:${base.imageTag}`;
}
