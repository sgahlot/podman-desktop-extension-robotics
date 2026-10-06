import * as catalogModule from './simulation-profiles.json';
import { invalidCatalog, loadJsonCatalog } from './loadJsonCatalog';
import type { SimulationConfig } from '../types/SimulationConfig';

export interface SimulationProfile {
  id: string;
  robot: string;
  distro: string;
  middleware: string;
  engine: string;
  baseAssetDir: string;
  baseImageName: string;
  assetDir?: string;
  imageName?: string;
  hardenedImageName?: string;
  label: string;
}

const catalog = loadJsonCatalog<{ profiles?: SimulationProfile[] }>(catalogModule);

function profiles(): SimulationProfile[] {
  if (!Array.isArray(catalog.profiles) || catalog.profiles.length === 0) {
    invalidCatalog('simulation-profiles.json', 'profiles');
  }
  for (const profile of catalog.profiles) {
    if (!profile.id?.trim() || !profile.robot || !profile.distro || !profile.label) {
      invalidCatalog('simulation-profiles.json', `profile ${profile.id ?? 'unknown'}`);
    }
  }
  return catalog.profiles;
}

export const SIMULATION_PROFILES: readonly SimulationProfile[] = Object.freeze(profiles());

export function resolveSimulationProfile(config: SimulationConfig): SimulationProfile | undefined {
  return SIMULATION_PROFILES.find(
    p =>
      p.robot === config.robot &&
      p.distro === config.distro &&
      p.middleware === config.middleware &&
      p.engine === config.engine,
  );
}

export function resolveSimulationProfileById(id: string): SimulationProfile | undefined {
  return SIMULATION_PROFILES.find(p => p.id === id);
}
