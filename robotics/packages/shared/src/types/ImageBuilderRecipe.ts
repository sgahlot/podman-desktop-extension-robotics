import type { HardenedApp } from './layerCompatibility';
import { assertCustomBaseImageRef, type SupportedArchitecture } from './CustomSimulationTemplates';

export type BaseSource =
  | { kind: 'preset'; presetId: string }
  | {
      kind: 'custom';
      imageRef: string;
      osFamily: string;
      osVersion: string;
      rosDistro: string;
    };

export type SimulationSource =
  { kind: 'none' } | { kind: 'preset'; profileId: string } | { kind: 'template'; templateId: string };

export interface ImageBuilderRecipe {
  targetArch: SupportedArchitecture;
  base: BaseSource;
  simulation: SimulationSource;
  hardenedTools: HardenedApp[];
  generateSbom: boolean;
}

export const DEFAULT_IMAGE_BUILDER_RECIPE: ImageBuilderRecipe = {
  targetArch: 'amd64',
  base: { kind: 'preset', presetId: 'jazzy-noble' },
  simulation: { kind: 'preset', profileId: 'turtlebot3-jazzy-dds-gazebo' },
  hardenedTools: [],
  generateSbom: false,
};

export interface RecipeValidationIssue {
  field: string;
  message: string;
}

/** Validate only structural/user-controlled recipe data; compatibility is planner-owned. */
export function validateImageBuilderRecipe(recipe: ImageBuilderRecipe): RecipeValidationIssue[] {
  const issues: RecipeValidationIssue[] = [];
  if (recipe.base.kind === 'custom') {
    if (!recipe.base.imageRef.trim()) {
      issues.push({ field: 'base.imageRef', message: 'A custom base image reference is required.' });
    } else {
      try {
        assertCustomBaseImageRef(recipe.base.imageRef);
      } catch (error) {
        issues.push({
          field: 'base.imageRef',
          message: error instanceof Error ? error.message : 'Invalid custom base image reference.',
        });
      }
    }
    if (!recipe.base.osFamily.trim())
      issues.push({ field: 'base.osFamily', message: 'A custom base OS family is required.' });
    if (!recipe.base.osVersion.trim())
      issues.push({ field: 'base.osVersion', message: 'A custom base OS version is required.' });
    if (!recipe.base.rosDistro.trim())
      issues.push({ field: 'base.rosDistro', message: 'A custom base ROS distro is required.' });
  }
  if (recipe.simulation.kind === 'preset' && !recipe.simulation.profileId.trim()) {
    issues.push({ field: 'simulation.profileId', message: 'A simulation profile is required.' });
  }
  if (recipe.simulation.kind === 'template' && !recipe.simulation.templateId.trim()) {
    issues.push({ field: 'simulation.templateId', message: 'A simulation template is required.' });
  }
  return issues;
}
