import { describe, expect, it } from 'vitest';
import { CATALOG_BASE_OS_LAYERS, loadLayerRecipe } from '../types/layerRecipe';
import { fedora43LyricalRepositoryShell, FEDORA_LYRICAL_REPOSITORY } from '../types/layerStackConfig';

describe('layer-recipes.json contracts', () => {
  for (const id of CATALOG_BASE_OS_LAYERS) {
    it(`loads a valid recipe for ${id}`, () => {
      const recipe = loadLayerRecipe(id);
      expect(recipe.imageRef.trim().length).toBeGreaterThan(0);
      expect(recipe.installCommand.trim().length).toBeGreaterThan(0);
      expect(typeof recipe.installCleanup).toBe('string');
    });
  }

  it('fedora-bootc-43 lyrical repo fragment is non-empty and includes baseurl', () => {
    const recipe = loadLayerRecipe('fedora-bootc-43');
    expect(recipe.capability.hasRosRepo).toBe(true);
    expect(recipe.capability.supportedRosDistros).toContain('lyrical');
    expect(recipe.rosRepository).toContain('baseurl=https://repo.ros2.org/fedora/testing/43');
    expect(recipe.rosPackages.lyrical?.length).toBeGreaterThan(0);
    expect(recipe.simulationPackages.lyrical?.length).toBeGreaterThan(0);
  });

  it('fedora43LyricalRepositoryShell matches the catalog rosRepository RUN body', () => {
    const shell = fedora43LyricalRepositoryShell();
    expect(shell.length).toBeGreaterThan(50);
    expect(shell).toContain('cat > /etc/yum.repos.d/ros2-lyrical-testing.repo');
    expect(FEDORA_LYRICAL_REPOSITORY).toContain(shell);
  });

  it('ubuntu-noble exposes ros packages for jazzy and humble', () => {
    const recipe = loadLayerRecipe('ubuntu-noble');
    expect(recipe.rosRepository).toContain('packages.ros.org');
    expect(recipe.rosPackages.jazzy?.length).toBeGreaterThan(0);
    expect(recipe.rosPackages.humble?.length).toBeGreaterThan(0);
  });
});
