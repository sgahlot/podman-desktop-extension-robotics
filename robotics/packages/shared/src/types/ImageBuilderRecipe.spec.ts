import { describe, expect, it } from 'vitest';
import { applyQuickStart, QUICK_STARTS } from './QuickStarts';
import { DEFAULT_IMAGE_BUILDER_RECIPE, validateImageBuilderRecipe } from './ImageBuilderRecipe';
import {
  buildImageBuilderPlan,
  customSimulationImageTag,
  evaluateImageBuilderCompatibility,
  templatesFor,
} from './imageBuilderPlan';
import { resolveCustomSimulationTemplate } from './CustomSimulationTemplates';

describe('shared Image Builder foundation', () => {
  it('applies both shared Quick Starts as complete recipe values', () => {
    expect(applyQuickStart(DEFAULT_IMAGE_BUILDER_RECIPE, 'local-jazzy').targetArch).toBe('amd64');
    expect(applyQuickStart(DEFAULT_IMAGE_BUILDER_RECIPE, 'openshift-jazzy-amd64').targetArch).toBe('amd64');
    expect(QUICK_STARTS).toHaveLength(2);
  });

  it('classifies the five composition outcomes', () => {
    expect(evaluateImageBuilderCompatibility(DEFAULT_IMAGE_BUILDER_RECIPE).kind).toBe('compatible');
    expect(
      evaluateImageBuilderCompatibility({ ...DEFAULT_IMAGE_BUILDER_RECIPE, simulation: { kind: 'none' } }).kind,
    ).toBe('compatible');
    const custom = {
      kind: 'custom' as const,
      imageRef: 'quay.io/example/ros:f43',
      osFamily: 'Fedora',
      osVersion: '43',
      rosDistro: 'lyrical',
    };
    expect(
      evaluateImageBuilderCompatibility({ ...DEFAULT_IMAGE_BUILDER_RECIPE, base: custom, simulation: { kind: 'none' } })
        .kind,
    ).toBe('user-declared-compatible');
    expect(evaluateImageBuilderCompatibility({ ...DEFAULT_IMAGE_BUILDER_RECIPE, base: custom }).kind).toBe('blocked');
    const customJazzy = { ...custom, osFamily: 'Ubuntu', osVersion: '24.04', rosDistro: 'jazzy' };
    expect(evaluateImageBuilderCompatibility({ ...DEFAULT_IMAGE_BUILDER_RECIPE, base: customJazzy }).kind).toBe(
      'user-declared-compatible',
    );
    const templateRecipe = {
      ...DEFAULT_IMAGE_BUILDER_RECIPE,
      base: custom,
      targetArch: 'amd64' as const,
      simulation: { kind: 'template' as const, templateId: 'fedora43-lyrical-dnf' },
    };
    expect(evaluateImageBuilderCompatibility(templateRecipe).kind).toBe('packages-only');
    expect(evaluateImageBuilderCompatibility({ ...templateRecipe, targetArch: 'arm64' }).kind).toBe('blocked');
    expect(
      evaluateImageBuilderCompatibility({
        ...DEFAULT_IMAGE_BUILDER_RECIPE,
        simulation: { kind: 'template', templateId: 'fedora43-lyrical-dnf' },
      }).kind,
    ).toBe('blocked');
  });

  it('builds a template plan and keeps tags unique by parent and template version', () => {
    const template = resolveCustomSimulationTemplate('fedora43-lyrical-dnf')!;
    const first = customSimulationImageTag('user', 'quay.io/example/a:f43', template, 'amd64');
    const second = customSimulationImageTag('user', 'quay.io/example/b:f43', template, 'amd64');
    expect(first).not.toBe(second);
    const plan = buildImageBuilderPlan(
      {
        ...DEFAULT_IMAGE_BUILDER_RECIPE,
        base: {
          kind: 'custom',
          imageRef: 'quay.io/example/a:f43',
          osFamily: 'Fedora',
          osVersion: '43',
          rosDistro: 'lyrical',
        },
        targetArch: 'amd64',
        simulation: { kind: 'template', templateId: template.id },
      },
      'user',
    );
    expect(plan.steps[0].request.kind).toBe('containerfile');
    expect(plan.outputTag).toContain('fedora43-lyrical-dnf');
    expect(plan.capabilities).toEqual(['packages-only']);
  });

  it('validates required custom metadata and filters templates by architecture', () => {
    expect(
      validateImageBuilderRecipe({
        ...DEFAULT_IMAGE_BUILDER_RECIPE,
        base: { kind: 'custom', imageRef: '', osFamily: '', osVersion: '', rosDistro: '' },
      }),
    ).toHaveLength(4);
    expect(templatesFor({ ...DEFAULT_IMAGE_BUILDER_RECIPE, targetArch: 'arm64' })).toHaveLength(0);
  });
});
