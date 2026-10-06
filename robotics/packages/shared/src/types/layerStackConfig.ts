import type { BaseOsLayer, RosLayer } from './layerCompatibility';
import { CATALOG_BASE_OS_LAYERS, loadLayerRecipe } from './layerRecipe';

export interface BaseOsCapability {
  isBootc: boolean;
  packaging: 'apt' | 'dnf';
  requiresSubscription: boolean;
  supportedRosDistros: readonly string[];
  supportedSimDistros: readonly string[];
  hasRosRepo: boolean;
}

export const BASE_OS_CAPABILITY: Record<BaseOsLayer, BaseOsCapability> = {
  custom: {
    isBootc: false,
    packaging: 'apt',
    requiresSubscription: false,
    supportedRosDistros: ['jazzy', 'humble'],
    supportedSimDistros: ['jazzy', 'humble'],
    hasRosRepo: true,
  },
  ...Object.fromEntries(CATALOG_BASE_OS_LAYERS.map(id => [id, loadLayerRecipe(id).capability])),
} as unknown as Record<BaseOsLayer, BaseOsCapability>;

export const BASE_OS_IMAGE_REF: Record<Exclude<BaseOsLayer, 'custom'>, string> = Object.fromEntries(
  CATALOG_BASE_OS_LAYERS.map(id => [id, loadLayerRecipe(id).imageRef]),
) as Record<Exclude<BaseOsLayer, 'custom'>, string>;

export type RosDistro = 'jazzy' | 'humble' | 'lyrical';
export const ROS_DISTRO: Record<Exclude<RosLayer, 'none' | 'provided-by-parent'>, RosDistro> = {
  'ros2-jazzy': 'jazzy',
  'ros2-humble': 'humble',
  'ros2-lyrical': 'lyrical',
};

export const INSTALL_COMMAND: Record<BaseOsLayer, string> = {
  custom: 'apt-get update && apt-get install -y',
  ...(Object.fromEntries(CATALOG_BASE_OS_LAYERS.map(id => [id, loadLayerRecipe(id).installCommand])) as Record<
    Exclude<BaseOsLayer, 'custom'>,
    string
  >),
};
export const INSTALL_CLEANUP: Record<BaseOsLayer, string> = {
  custom: '',
  ...(Object.fromEntries(CATALOG_BASE_OS_LAYERS.map(id => [id, loadLayerRecipe(id).installCleanup])) as Record<
    Exclude<BaseOsLayer, 'custom'>,
    string
  >),
};

export const ROS_DESKTOP_PACKAGES: Record<RosDistro, readonly string[]> = {
  jazzy: loadLayerRecipe('ubuntu-noble').rosPackages.jazzy ?? [],
  humble: loadLayerRecipe('ubuntu-noble').rosPackages.humble ?? [],
  lyrical: loadLayerRecipe('fedora-bootc-43').rosPackages.lyrical ?? [],
};
export const SIMULATION_PACKAGES: Record<RosDistro, readonly string[]> = {
  jazzy: loadLayerRecipe('ubuntu-noble').simulationPackages.jazzy ?? [],
  humble: loadLayerRecipe('ubuntu-noble').simulationPackages.humble ?? [],
  lyrical: loadLayerRecipe('fedora-bootc-43').simulationPackages.lyrical ?? [],
};

export const FEDORA_LYRICAL_REPOSITORY = loadLayerRecipe('fedora-bootc-43').rosRepository ?? '';

/** Shell commands to write the Lyrical testing repo file (no `RUN` prefix). */
export function fedora43LyricalRepositoryShell(): string {
  const runIdx = FEDORA_LYRICAL_REPOSITORY.indexOf('RUN ');
  if (runIdx < 0) return '';
  return FEDORA_LYRICAL_REPOSITORY.slice(runIdx + 4).trim();
}
