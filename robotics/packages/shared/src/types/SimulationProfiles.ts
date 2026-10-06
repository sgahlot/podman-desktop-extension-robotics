import type { SimulationConfig } from './SimulationConfig';
import { CUSTOM_SIMULATION_BASE_IMAGE, resolveSimulationBaseImage } from './SimulationBaseImages';
import {
  type SimulationProfile,
  SIMULATION_PROFILES,
  resolveSimulationProfile,
  resolveSimulationProfileById,
} from '../config/simulationProfileCatalog';

export type { SimulationProfile };
export { SIMULATION_PROFILES, resolveSimulationProfile, resolveSimulationProfileById };

export function formatSimulationConfig(config: SimulationConfig): string {
  return `${config.distro}/${config.robot}/${config.middleware}/${config.engine}/${config.baseImage}`;
}

export function archTagSuffix(targetArch?: string): string {
  return targetArch === 'amd64' ? '-amd64' : '';
}

export function platformForArch(targetArch?: string): string | undefined {
  if (targetArch === 'amd64') return 'linux/amd64';
  if (targetArch === 'arm64') return 'linux/arm64';
  return undefined;
}

export function baseImageTag(namespace: string, config: SimulationConfig): string | undefined {
  const profile = resolveSimulationProfile(config);
  if (!profile) return undefined;
  const tag =
    config.baseImage === CUSTOM_SIMULATION_BASE_IMAGE
      ? 'custom'
      : resolveSimulationBaseImage(config.baseImage).imageTag;
  return `quay.io/${namespace}/${profile.baseImageName}:${tag}${archTagSuffix(config.targetArch)}`;
}

export function hasSimulationSupport(profile: SimulationProfile): boolean {
  return !!profile.assetDir && !!profile.imageName;
}

export function simulationImageTag(namespace: string, config: SimulationConfig): string | undefined {
  const profile = resolveSimulationProfile(config);
  if (!profile?.imageName) return undefined;
  const tag =
    config.baseImage === CUSTOM_SIMULATION_BASE_IMAGE
      ? 'custom'
      : resolveSimulationBaseImage(config.baseImage).imageTag;
  return `quay.io/${namespace}/${profile.imageName}:${tag}${archTagSuffix(config.targetArch)}`;
}

export function hardenedImageTag(namespace: string, config: SimulationConfig): string | undefined {
  const profile = resolveSimulationProfile(config);
  if (!profile?.hardenedImageName) return undefined;
  const tag =
    config.baseImage === CUSTOM_SIMULATION_BASE_IMAGE
      ? 'custom'
      : resolveSimulationBaseImage(config.baseImage).imageTag;
  return `quay.io/${namespace}/${profile.hardenedImageName}:${tag}${archTagSuffix(config.targetArch)}`;
}
