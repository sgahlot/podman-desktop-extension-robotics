import type { SupportedArchitecture } from './CustomSimulationTemplates';
import type { ImageBuilderRecipe } from './ImageBuilderRecipe';

export type QuickStartId = 'local-jazzy' | 'openshift-jazzy-amd64';

export interface QuickStartDefinition {
  id: QuickStartId;
  label: string;
  /** Undefined means preserve the page's host-native/current target. */
  targetArch?: SupportedArchitecture;
  recipe: Pick<ImageBuilderRecipe, 'base' | 'simulation' | 'hardenedTools' | 'generateSbom'>;
}

export const QUICK_STARTS: readonly QuickStartDefinition[] = [
  {
    id: 'local-jazzy',
    label: 'TurtleBot3 Sim (Jazzy)',
    recipe: {
      base: { kind: 'preset', presetId: 'jazzy-noble' },
      simulation: { kind: 'preset', profileId: 'turtlebot3-jazzy-dds-gazebo' },
      hardenedTools: [],
      generateSbom: false,
    },
  },
  {
    id: 'openshift-jazzy-amd64',
    label: 'TurtleBot3 Sim (Jazzy · amd64)',
    targetArch: 'amd64',
    recipe: {
      base: { kind: 'preset', presetId: 'jazzy-noble' },
      simulation: { kind: 'preset', profileId: 'turtlebot3-jazzy-dds-gazebo' },
      hardenedTools: [],
      generateSbom: false,
    },
  },
];

export const QUICK_START_DEFINITIONS = QUICK_STARTS;

export function resolveQuickStart(id: string): QuickStartDefinition | undefined {
  return QUICK_STARTS.find(quickStart => quickStart.id === id);
}

/** Apply a Quick Start without mutating the caller or carrying stale selections forward. */
export function applyQuickStart(recipe: ImageBuilderRecipe, id: QuickStartId): ImageBuilderRecipe {
  const quickStart = resolveQuickStart(id);
  if (!quickStart) throw new Error(`Unknown Quick Start: ${id}`);
  return { ...recipe, ...quickStart.recipe, targetArch: quickStart.targetArch ?? recipe.targetArch };
}
