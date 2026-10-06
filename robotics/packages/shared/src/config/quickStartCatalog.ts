import * as catalogModule from './quick-starts.json';
import { invalidCatalog, loadJsonCatalog } from './loadJsonCatalog';
import type { ImageBuilderRecipe } from '../types/ImageBuilderRecipe';
import type { SupportedArchitecture } from './customSimulationTemplateCatalog';
import { DEFAULT_QUICK_START_ID_FROM_CATALOG } from './platformDefaultsCatalog';

export type QuickStartId = 'ubuntu-jazzy-arm64' | 'ubuntu-jazzy-amd64' | 'fedora-bootc43-lyrical-amd64';
export type QuickStartBuildMode = 'ubuntu-preset' | 'fedora-layers';

export interface QuickStartDefinition {
  id: QuickStartId;
  label: string;
  description: string;
  targetArch: SupportedArchitecture;
  buildMode: QuickStartBuildMode;
  recipeSummary: readonly string[];
  recipe: Pick<ImageBuilderRecipe, 'base' | 'simulation' | 'hardenedTools' | 'generateSbom'>;
  layerPreset?: {
    baseOs: 'fedora-bootc-43';
    ros: 'ros2-lyrical';
    sim: 'gazebo-nav2-tb3';
  };
  inferFromSimulationConfig?: {
    baseImagePresetId: string;
    distro: string;
    targetArch: SupportedArchitecture;
  };
}

const catalog = loadJsonCatalog<{ quickStarts?: QuickStartDefinition[] }>(catalogModule);

function quickStarts(): QuickStartDefinition[] {
  if (!Array.isArray(catalog.quickStarts) || catalog.quickStarts.length === 0) {
    invalidCatalog('quick-starts.json', 'quickStarts');
  }
  return catalog.quickStarts as QuickStartDefinition[];
}

export const QUICK_STARTS: readonly QuickStartDefinition[] = Object.freeze(quickStarts());
export const QUICK_START_DEFINITIONS = QUICK_STARTS;
export const DEFAULT_QUICK_START_ID = DEFAULT_QUICK_START_ID_FROM_CATALOG as QuickStartId;

export function resolveQuickStart(id: string): QuickStartDefinition | undefined {
  return QUICK_STARTS.find(quickStart => quickStart.id === id);
}

export function inferQuickStartIdFromSimulationConfig(config: {
  baseImage?: string;
  distro?: string;
  targetArch?: SupportedArchitecture;
  quickStartId?: string;
}): QuickStartId | undefined {
  if (config.quickStartId && resolveQuickStart(config.quickStartId)) {
    return config.quickStartId as QuickStartId;
  }
  for (const quickStart of QUICK_STARTS) {
    const rule = quickStart.inferFromSimulationConfig;
    if (!rule) continue;
    if (
      config.baseImage === rule.baseImagePresetId &&
      config.distro === rule.distro &&
      config.targetArch === rule.targetArch
    ) {
      return quickStart.id;
    }
  }
  return undefined;
}

export function applyQuickStart(recipe: ImageBuilderRecipe, id: QuickStartId): ImageBuilderRecipe {
  const quickStart = resolveQuickStart(id);
  if (!quickStart) throw new Error(`Unknown Quick Start: ${id}`);
  return { ...recipe, ...quickStart.recipe, targetArch: quickStart.targetArch };
}
