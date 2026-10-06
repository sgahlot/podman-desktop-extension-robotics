import * as recipesModule from '../config/layer-recipes.json';
import type { BaseOsCapability, RosDistro } from './layerStackConfig';

const recipes =
  (recipesModule as unknown as { default?: unknown }).default ?? (recipesModule as unknown as Record<string, unknown>);

export interface LayerRecipe {
  ui: { label: string; note: string };
  imageRef: string;
  capability: BaseOsCapability;
  rosRepository?: string;
  installCommand: string;
  installCleanup: string;
  rosPackages: Partial<Record<RosDistro, readonly string[]>>;
  simulationPackages: Partial<Record<RosDistro, readonly string[]>>;
  layer5Bundle?: { assetDir: string; verifyHook: string };
}

function invalid(id: string, field: string): never {
  throw new Error(`Invalid layer recipe "${id}": ${field} is required or has an invalid value.`);
}

function validateRecipe(id: string, value: unknown): LayerRecipe {
  if (!value || typeof value !== 'object') invalid(id, 'recipe');
  const recipe = value as Record<string, unknown>;
  const ui = recipe.ui as Record<string, unknown> | undefined;
  if (!ui || typeof ui.label !== 'string' || !ui.label.trim() || typeof ui.note !== 'string') invalid(id, 'ui');
  if (typeof recipe.imageRef !== 'string' || !recipe.imageRef.trim()) invalid(id, 'imageRef');
  if (typeof recipe.installCommand !== 'string' || !recipe.installCommand.trim()) invalid(id, 'installCommand');
  if (typeof recipe.installCleanup !== 'string') invalid(id, 'installCleanup');
  if (!recipe.capability || typeof recipe.capability !== 'object') invalid(id, 'capability');
  const capability = recipe.capability as Record<string, unknown>;
  if (
    typeof capability.isBootc !== 'boolean' ||
    (capability.packaging !== 'apt' && capability.packaging !== 'dnf') ||
    typeof capability.requiresSubscription !== 'boolean' ||
    typeof capability.hasRosRepo !== 'boolean' ||
    !Array.isArray(capability.supportedRosDistros) ||
    !Array.isArray(capability.supportedSimDistros)
  )
    invalid(id, 'capability');
  if (recipe.rosRepository !== undefined && typeof recipe.rosRepository !== 'string') invalid(id, 'rosRepository');
  if (!recipe.rosPackages || typeof recipe.rosPackages !== 'object') invalid(id, 'rosPackages');
  if (!recipe.simulationPackages || typeof recipe.simulationPackages !== 'object') invalid(id, 'simulationPackages');
  if (recipe.layer5Bundle !== undefined) {
    const bundle = recipe.layer5Bundle as Record<string, unknown>;
    if (typeof bundle.assetDir !== 'string' || typeof bundle.verifyHook !== 'string') invalid(id, 'layer5Bundle');
  }
  return recipe as unknown as LayerRecipe;
}

function recipeCatalog(): Record<string, unknown> {
  const raw = (recipes as { version?: unknown; recipes?: Record<string, unknown> }).recipes;
  if (!raw || typeof raw !== 'object') throw new Error('Invalid layer recipe catalog: recipes is required.');
  return raw;
}

/** Base OS layer ids backed by `layer-recipes.json` (excludes `custom`). */
export const CATALOG_BASE_OS_LAYERS = Object.freeze(Object.keys(recipeCatalog()));

export function loadLayerRecipe(baseOs: string): LayerRecipe {
  const raw = recipeCatalog();
  if (!(baseOs in raw)) {
    throw new Error(`Invalid layer recipe "${baseOs}": recipe is required or has an invalid value.`);
  }
  return validateRecipe(baseOs, raw[baseOs]);
}

export function validateLayerRecipe(id: string, recipe: unknown): LayerRecipe {
  return validateRecipe(id, recipe);
}
