import type { LayerCacheStatusEntry } from './BuildHistory';

export type CatalogRegistryKind = 'quay' | 'docker-hub' | 'generic';

export interface CatalogRegistry {
  id: string;
  displayName: string;
  kind: CatalogRegistryKind;
  host: string;
  namespace: string;
  curatedAllowlist?: string;
}

/** Rewrites an image reference to the configured registry while retaining its repository name and tag. */
export function imageRefForRegistry(imageRef: string, registry: CatalogRegistry): string {
  const value = imageRef.trim();
  const tagSeparator = value.lastIndexOf(':');
  const pathSeparator = value.lastIndexOf('/');
  if (tagSeparator <= pathSeparator || tagSeparator < 1 || tagSeparator === value.length - 1) return value;
  const repository = value.slice(pathSeparator + 1, tagSeparator);
  const tag = value.slice(tagSeparator + 1);
  return `${registry.host}/${registry.namespace}/${repository}:${tag}`;
}

export interface CatalogRepository {
  namespace: string;
  name: string;
  description?: string;
  is_public: boolean;
  kind: string;
  state: string;
}

export type QuayRepository = CatalogRepository;

export interface CatalogTag {
  name: string;
  size: number;
  last_modified: string;
  manifest_digest: string;
  is_manifest_list: boolean;
}

export type QuayTag = CatalogTag;

/**
 * A local image tag with its reported CPU architecture — `arch` is Podman-specific
 * (available since Podman v5.1.0) and `undefined` means "not reported," never "confirmed
 * not amd64" (older Podman, or a source that doesn't surface it). Used by the OpenShift
 * deploy tab's Image picker to find genuinely-amd64 images regardless of tag naming
 * (APPENG-6259) — the `-amd64` suffix Image Builder appends is just a naming convention,
 * not a property every local image follows (e.g. a pulled or manually-tagged image).
 */
export interface LocalImageInfo {
  tag: string;
  arch: string | undefined;
}

export interface PullProgress {
  image: string;
  status: string;
  currentMB?: number;
  totalMB?: number;
  done?: boolean;
  error?: string;
}

export interface BuildProgress {
  tag: string;
  status: string;
  currentStep?: number;
  totalSteps?: number;
  logs: string[];
  done?: boolean;
  error?: string;
  cancelled?: boolean;
  /** Epoch ms when the build started. */
  startedAt?: number;
  /** Epoch ms when the build finished (success, error, or cancel). */
  finishedAt?: number;
  /** Live + final per-layer cache summary for Layers-wizard containerfile builds. */
  layerCacheStatus?: LayerCacheStatusEntry[];
  /**
   * Set after the base Recent Builds row is durably persisted. Unlike a “already queued” flag,
   * this stays false when persistence fails so the finish/promise backup path can retry.
   */
  historyPersisted?: boolean;
}

export interface PushProgress {
  tag: string;
  status: string;
  logs: string[];
  done?: boolean;
  error?: string;
  cancelled?: boolean;
  /** Epoch ms when the push started. */
  startedAt?: number;
  /** Epoch ms when the push finished (success, error, or cancel). */
  finishedAt?: number;
}
