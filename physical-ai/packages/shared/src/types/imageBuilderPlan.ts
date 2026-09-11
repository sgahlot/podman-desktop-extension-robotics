import type { CustomSimulationTemplate, SupportedArchitecture } from './CustomSimulationTemplates';
import { CUSTOM_SIMULATION_TEMPLATES, resolveCustomSimulationTemplate } from './CustomSimulationTemplates';
import type { BaseSource, ImageBuilderRecipe } from './ImageBuilderRecipe';
import { validateImageBuilderRecipe } from './ImageBuilderRecipe';

export type CompatibilityKind = 'compatible' | 'user-declared-compatible' | 'packages-only' | 'blocked';

export interface CompatibilityResult {
  kind: CompatibilityKind;
  buildable: boolean;
  reason: string;
}

export interface BuildPlanStep {
  kind: 'base' | 'simulation';
  request: { kind: 'preset' | 'containerfile'; sourceId: string; parentImage?: string };
}

export interface ImageBuilderPlan {
  compatibility: CompatibilityResult;
  parentImage: string | undefined;
  outputTag: string | undefined;
  steps: readonly BuildPlanStep[];
  capabilities: readonly string[];
}

function customBaseMatchesTemplate(
  base: Extract<BaseSource, { kind: 'custom' }>,
  template: CustomSimulationTemplate,
): boolean {
  return (
    base.osFamily.toLowerCase() === template.osFamily.toLowerCase() &&
    base.osVersion === template.osVersion &&
    base.rosDistro.toLowerCase() === template.rosDistro.toLowerCase()
  );
}

function presetProfileMatchesDistro(profileId: string, distro: string): boolean {
  return profileId.toLowerCase().includes(distro.toLowerCase());
}

export function evaluateImageBuilderCompatibility(recipe: ImageBuilderRecipe): CompatibilityResult {
  const issues = validateImageBuilderRecipe(recipe);
  if (issues.length > 0) return { kind: 'blocked', buildable: false, reason: issues[0].message };
  if (recipe.simulation.kind === 'none') {
    return recipe.base.kind === 'custom'
      ? { kind: 'user-declared-compatible', buildable: true, reason: 'The custom parent metadata is user-declared.' }
      : { kind: 'compatible', buildable: true, reason: 'The curated base can be built without a simulation layer.' };
  }
  if (recipe.simulation.kind === 'template') {
    const template = resolveCustomSimulationTemplate(recipe.simulation.templateId);
    if (!template)
      return { kind: 'blocked', buildable: false, reason: 'The selected simulation template is not registered.' };
    if (!template.architectures.includes(recipe.targetArch)) {
      return {
        kind: 'blocked',
        buildable: false,
        reason: `Template ${template.id} does not support ${recipe.targetArch}.`,
      };
    }
    if (recipe.base.kind === 'preset' && template.osFamily.toLowerCase() !== 'ubuntu') {
      return {
        kind: 'blocked',
        buildable: false,
        reason: `Template ${template.id} requires ${template.osFamily} ${template.osVersion}; the selected preset parent is Ubuntu.`,
      };
    }
    if (recipe.base.kind === 'custom' && !customBaseMatchesTemplate(recipe.base, template)) {
      return {
        kind: 'blocked',
        buildable: false,
        reason: 'The custom parent OS or ROS metadata does not match the template.',
      };
    }
    return {
      kind: 'packages-only',
      buildable: true,
      reason: `${template.label} adds fixed packages only; managed runtime features are not provided.`,
    };
  }
  if (recipe.base.kind === 'custom') {
    if (
      recipe.simulation.kind === 'preset' &&
      !presetProfileMatchesDistro(recipe.simulation.profileId, recipe.base.rosDistro)
    ) {
      return {
        kind: 'blocked',
        buildable: false,
        reason: 'The managed simulation profile does not match the custom parent ROS distro.',
      };
    }
    return {
      kind: 'user-declared-compatible',
      buildable: true,
      reason: 'The managed recipe relies on the user-declared custom parent contract.',
    };
  }
  if (recipe.simulation.kind === 'preset' && presetProfileMatchesDistro(recipe.simulation.profileId, 'jazzy')) {
    return {
      kind: 'compatible',
      buildable: true,
      reason: 'The curated base and managed simulation profile are compatible.',
    };
  }
  return {
    kind: 'blocked',
    buildable: false,
    reason: 'The selected preset base and simulation profile are incompatible.',
  };
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}

export function customSimulationImageTag(
  namespace: string,
  baseImage: string,
  template: Pick<CustomSimulationTemplate, 'id' | 'version'>,
  targetArch?: SupportedArchitecture,
): string {
  const identity = `${baseImage.trim()}|${template.id}|${template.version}`;
  const suffix = targetArch === 'amd64' ? '-amd64' : targetArch === 'arm64' ? '-arm64' : '';
  return `quay.io/${namespace}/custom-sim:${template.id}-${stableHash(identity)}${suffix}`;
}

export function buildImageBuilderPlan(recipe: ImageBuilderRecipe, namespace: string): ImageBuilderPlan {
  const compatibility = evaluateImageBuilderCompatibility(recipe);
  const parentImage = recipe.base.kind === 'custom' ? recipe.base.imageRef.trim() : recipe.base.presetId;
  const template =
    recipe.simulation.kind === 'template' ? resolveCustomSimulationTemplate(recipe.simulation.templateId) : undefined;
  const outputTag = template
    ? customSimulationImageTag(namespace, parentImage, template, recipe.targetArch)
    : undefined;
  const steps: BuildPlanStep[] = [];
  if (recipe.base.kind === 'preset' && recipe.simulation.kind !== 'template') {
    steps.push({ kind: 'base', request: { kind: 'preset', sourceId: recipe.base.presetId } });
  }
  if (recipe.simulation.kind === 'preset') {
    steps.push({
      kind: 'simulation',
      request: { kind: 'preset', sourceId: recipe.simulation.profileId, parentImage },
    });
  } else if (recipe.simulation.kind === 'template') {
    steps.push({
      kind: 'simulation',
      request: { kind: 'containerfile', sourceId: recipe.simulation.templateId, parentImage },
    });
  }
  return {
    compatibility,
    parentImage,
    outputTag,
    steps,
    capabilities: template ? [template.capability] : recipe.simulation.kind === 'none' ? [] : ['managed'],
  };
}

export function templatesFor(recipe: ImageBuilderRecipe): readonly CustomSimulationTemplate[] {
  return CUSTOM_SIMULATION_TEMPLATES.filter(template => template.architectures.includes(recipe.targetArch));
}
