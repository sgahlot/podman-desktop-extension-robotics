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
    assetDir: 'ros2-jazzy-sim',
    imageName: 'ros2-jazzy-sim',
    label: 'ROS2 Jazzy + TurtleBot3 + Gazebo + noVNC',
  },
  {
    robot: 'turtlebot3',
    distro: 'jazzy',
    middleware: 'zenoh',
    engine: 'gazebo',
    // Same image as the dds Jazzy profile above (APPENG-5775): rmw_zenoh_cpp is baked
    // into the ros2-jazzy-sim image alongside the default DDS RMW, so middleware is a
    // runtime choice (RMW_IMPLEMENTATION), not a separate build. No new asset dir/image.
    baseAssetDir: 'ros2-jazzy-base',
    baseImageName: 'ros2-jazzy-base',
    assetDir: 'ros2-jazzy-sim',
    imageName: 'ros2-jazzy-sim',
    label: 'ROS2 Jazzy + TurtleBot3 + Gazebo + noVNC (Zenoh)',
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

/**
 * Tag suffix distinguishing a cross-arch build from the native one.
 * `-amd64` when building amd64 (e.g. for an OpenShift/Linux cluster from a Mac);
 * empty otherwise (host-native build keeps the preset's plain tag).
 */
export function archTagSuffix(targetArch?: string): string {
  return targetArch === 'amd64' ? '-amd64' : '';
}

/** Container build platform string for a target arch, or undefined for host-native. */
export function platformForArch(targetArch?: string): string | undefined {
  if (targetArch === 'amd64') return 'linux/amd64';
  if (targetArch === 'arm64') return 'linux/arm64';
  return undefined;
}

export function baseImageTag(namespace: string, config: SimulationConfig): string | undefined {
  const profile = resolveSimulationProfile(config);
  if (!profile) return undefined;
  const base = resolveSimulationBaseImage(config.baseImage);
  return `quay.io/${namespace}/${profile.baseImageName}:${base.imageTag}${archTagSuffix(config.targetArch)}`;
}

export function hasSimulationSupport(profile: SimulationProfile): boolean {
  return !!profile.assetDir && !!profile.imageName;
}

export function simulationImageTag(namespace: string, config: SimulationConfig): string | undefined {
  const profile = resolveSimulationProfile(config);
  if (!profile?.imageName) return undefined;
  const base = resolveSimulationBaseImage(config.baseImage);
  return `quay.io/${namespace}/${profile.imageName}:${base.imageTag}${archTagSuffix(config.targetArch)}`;
}
