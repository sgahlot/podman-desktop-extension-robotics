export {
  type SimulationBaseImageId,
  type SimulationBaseImagePreset,
  type SimulationBaseImageSelection,
  CUSTOM_SIMULATION_BASE_IMAGE,
  SIMULATION_BASE_IMAGES,
  DEFAULT_SIMULATION_BASE_IMAGE,
  resolveSimulationBaseImage,
  baseImagesForDistro,
  defaultBaseImageForDistro,
} from '../config/simulationBaseImageCatalog';

/** Returns the configured parent image reference, or undefined for a preset. */
export function customBaseImageRef(value: string | undefined | null): string | undefined {
  const ref = value?.trim();
  if (!ref) return undefined;
  return ref;
}

/** Compact an OCI image reference for labels while retaining registry/repository identity. */
export function shortImageRef(imageRef: string): string {
  const withoutDigest = imageRef.trim().split('@', 1)[0];
  const parts = withoutDigest.split('/').filter(Boolean);
  if (parts.length === 0) return imageRef.trim();

  const first = parts[0];
  const hasRegistry = first === 'localhost' || first.includes('.') || first.includes(':');
  const repositoryParts = hasRegistry ? parts.slice(1) : parts;
  const withoutLibrary = repositoryParts[0] === 'library' ? repositoryParts.slice(1) : repositoryParts;
  return withoutLibrary.slice(-2).join('/') || withoutDigest;
}
