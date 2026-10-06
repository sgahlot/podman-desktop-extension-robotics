import * as catalogModule from './simulation-base-images.json';
import { invalidCatalog, loadJsonCatalog } from './loadJsonCatalog';
import { DEFAULT_SIMULATION_BASE_IMAGE_PRESET_ID, LEGACY_BASE_IMAGE_PRESET_IDS } from './platformDefaultsCatalog';

export type SimulationBaseImageId = 'sloretz' | 'osrf' | 'jazzy' | 'jazzy-noble';
export const CUSTOM_SIMULATION_BASE_IMAGE = 'custom' as const;
export type SimulationBaseImageSelection = SimulationBaseImageId | typeof CUSTOM_SIMULATION_BASE_IMAGE;

export interface SimulationBaseImagePreset {
  id: SimulationBaseImageId;
  label: string;
  description: string;
  imageRef: string;
  distro: string;
  architectures: readonly ('amd64' | 'arm64')[];
  imageTag: string;
}

const catalog = loadJsonCatalog<{ presets?: SimulationBaseImagePreset[] }>(catalogModule);

function presets(): SimulationBaseImagePreset[] {
  if (!Array.isArray(catalog.presets) || catalog.presets.length === 0) {
    invalidCatalog('simulation-base-images.json', 'presets');
  }
  return catalog.presets as SimulationBaseImagePreset[];
}

export const SIMULATION_BASE_IMAGES: readonly SimulationBaseImagePreset[] = Object.freeze(presets());

export const DEFAULT_SIMULATION_BASE_IMAGE = DEFAULT_SIMULATION_BASE_IMAGE_PRESET_ID as SimulationBaseImageId;

export function resolveSimulationBaseImage(id: string | undefined | null): SimulationBaseImagePreset {
  const normalized = id ? (LEGACY_BASE_IMAGE_PRESET_IDS[id] ?? id) : undefined;
  const preset = SIMULATION_BASE_IMAGES.find(p => p.id === normalized);
  const fallback = SIMULATION_BASE_IMAGES.find(p => p.id === DEFAULT_SIMULATION_BASE_IMAGE);
  if (!fallback) invalidCatalog('simulation-base-images.json', 'default preset missing');
  return preset ?? fallback;
}

export function baseImagesForDistro(distro: string): readonly SimulationBaseImagePreset[] {
  return SIMULATION_BASE_IMAGES.filter(p => p.distro === distro);
}

export function defaultBaseImageForDistro(distro: string): SimulationBaseImageId {
  const matches = baseImagesForDistro(distro);
  return matches.length > 0 ? matches[0].id : DEFAULT_SIMULATION_BASE_IMAGE;
}
