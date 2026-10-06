import * as catalogModule from './platform-defaults.json';
import { invalidCatalog, loadJsonCatalog } from './loadJsonCatalog';
import type { CatalogViewMode } from '../types/CatalogCurated';

interface PlatformDefaults {
  catalog?: { defaultViewMode?: string; defaultCuratedAllowlist?: string };
  managedSimRuntime?: {
    defaultVerifyHook?: string;
    defaultBundleAssetDir?: string;
    contextPaths?: string[];
  };
  imageBuilder?: {
    defaultBaseImagePresetId?: string;
    defaultQuickStartId?: string;
    legacyBaseImagePresetIds?: Record<string, string>;
  };
}

const catalog = loadJsonCatalog<PlatformDefaults>(catalogModule);

interface ManagedSimRuntimeConfig {
  defaultVerifyHook: string;
  defaultBundleAssetDir: string;
  contextPaths: string[];
}

interface ImageBuilderDefaultsConfig {
  defaultBaseImagePresetId: string;
  defaultQuickStartId: string;
  legacyBaseImagePresetIds: Record<string, string>;
}

function managedSim(): ManagedSimRuntimeConfig {
  const runtime = catalog.managedSimRuntime;
  if (!runtime?.defaultVerifyHook || !runtime.defaultBundleAssetDir || !Array.isArray(runtime.contextPaths)) {
    invalidCatalog('platform-defaults.json', 'managedSimRuntime');
  }
  return runtime as ManagedSimRuntimeConfig;
}

function imageBuilderDefaults(): ImageBuilderDefaultsConfig {
  const ib = catalog.imageBuilder;
  if (!ib?.defaultBaseImagePresetId || !ib.defaultQuickStartId || !ib.legacyBaseImagePresetIds) {
    invalidCatalog('platform-defaults.json', 'imageBuilder');
  }
  return ib as ImageBuilderDefaultsConfig;
}

export function defaultCatalogViewMode(): CatalogViewMode {
  const mode = catalog.catalog?.defaultViewMode;
  return mode === 'curated' ? 'curated' : 'all';
}

export function defaultCuratedAllowlistFromCatalog(): string {
  const raw = catalog.catalog?.defaultCuratedAllowlist;
  if (!raw?.trim()) invalidCatalog('platform-defaults.json', 'catalog.defaultCuratedAllowlist');
  return raw;
}

export const MANAGED_SIM_VERIFY_HOOK = managedSim().defaultVerifyHook;
export const SIM_RUNTIME_BUNDLE_ASSET_DIR = managedSim().defaultBundleAssetDir;
export const MANAGED_SIM_CONTEXT_PATHS = Object.freeze(managedSim().contextPaths) as readonly string[];

export const DEFAULT_SIMULATION_BASE_IMAGE_PRESET_ID = imageBuilderDefaults().defaultBaseImagePresetId;
export const DEFAULT_QUICK_START_ID_FROM_CATALOG = imageBuilderDefaults().defaultQuickStartId;
export const LEGACY_BASE_IMAGE_PRESET_IDS: Readonly<Record<string, string>> =
  imageBuilderDefaults().legacyBaseImagePresetIds;
