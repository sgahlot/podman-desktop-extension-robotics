import { describe, expect, it } from 'vitest';
import { applyQuickStart, inferQuickStartIdFromSimulationConfig, QUICK_STARTS, resolveQuickStart } from './QuickStarts';
import { DEFAULT_IMAGE_BUILDER_RECIPE } from './ImageBuilderRecipe';

describe('QuickStarts', () => {
  it('defines three fixed-architecture presets', () => {
    expect(QUICK_STARTS).toHaveLength(3);
    expect(resolveQuickStart('ubuntu-jazzy-arm64')?.targetArch).toBe('arm64');
    expect(resolveQuickStart('ubuntu-jazzy-amd64')?.targetArch).toBe('amd64');
    expect(resolveQuickStart('fedora-bootc43-lyrical-amd64')?.buildMode).toBe('fedora-layers');
  });

  it('applyQuickStart always sets targetArch from the definition', () => {
    expect(applyQuickStart(DEFAULT_IMAGE_BUILDER_RECIPE, 'ubuntu-jazzy-arm64').targetArch).toBe('arm64');
    expect(applyQuickStart(DEFAULT_IMAGE_BUILDER_RECIPE, 'ubuntu-jazzy-amd64').targetArch).toBe('amd64');
  });

  it('infers quick start id from saved simulation config', () => {
    expect(
      inferQuickStartIdFromSimulationConfig({
        baseImage: 'jazzy-noble',
        distro: 'jazzy',
        targetArch: 'arm64',
      }),
    ).toBe('ubuntu-jazzy-arm64');
    expect(
      inferQuickStartIdFromSimulationConfig({
        quickStartId: 'fedora-bootc43-lyrical-amd64',
        targetArch: 'amd64',
      }),
    ).toBe('fedora-bootc43-lyrical-amd64');
  });
});
