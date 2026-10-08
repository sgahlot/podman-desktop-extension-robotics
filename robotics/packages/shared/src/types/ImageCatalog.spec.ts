import { describe, expect, it } from 'vitest';
import { imageRefForRegistry, type CatalogRegistry } from './ImageCatalog';

const dockerHub: CatalogRegistry = {
  id: 'docker-hub',
  displayName: 'Docker Hub',
  kind: 'docker-hub',
  host: 'docker.io',
  namespace: 'ecosystem-appeng',
};

describe('imageRefForRegistry', () => {
  it('maps a registry-qualified image to the selected host and namespace', () => {
    expect(imageRefForRegistry('quay.io/ecosystem-appeng/ros2-jazzy-sim:noble', dockerHub)).toBe(
      'docker.io/ecosystem-appeng/ros2-jazzy-sim:noble',
    );
  });

  it('maps a local image tag to the selected registry', () => {
    expect(imageRefForRegistry('ros2-jazzy-base:noble', dockerHub)).toBe(
      'docker.io/ecosystem-appeng/ros2-jazzy-base:noble',
    );
  });

  it('leaves incomplete references unchanged', () => {
    expect(imageRefForRegistry('ros2-jazzy-base', dockerHub)).toBe('ros2-jazzy-base');
  });
});
