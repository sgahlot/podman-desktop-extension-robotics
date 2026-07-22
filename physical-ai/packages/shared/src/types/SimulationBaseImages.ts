/**
 * Pinned base images for the Humble TurtleBot3 simulation Containerfile.
 * Digests are bumped deliberately after testing — do not use floating tags at build time.
 *
 * Preset ids are short so Podman Desktop Settings enum dropdowns don't truncate.
 */
export type SimulationBaseImageId = 'sloretz' | 'osrf';

export interface SimulationBaseImagePreset {
  id: SimulationBaseImageId;
  /** Short label for dropdowns */
  label: string;
  /** Longer help text */
  description: string;
  /**
   * Image reference including digest.
   * Passed as Containerfile build-arg ROS_BASE_IMAGE.
   */
  imageRef: string;
  /** Architectures this preset is known to support */
  architectures: readonly ('amd64' | 'arm64')[];
  /** Image tag suffix when pushing (empty = :latest) */
  imageTag: string;
}

export const SIMULATION_BASE_IMAGES: readonly SimulationBaseImagePreset[] = [
  {
    id: 'sloretz',
    label: 'ghcr.io/sloretz (multi-arch, Apple Silicon)',
    description:
      'Third-party multi-arch Humble desktop rebuild. Best default for arm64 / Podman on Mac.',
    imageRef:
      'ghcr.io/sloretz/ros:humble-desktop@sha256:970146e40f7aaa818c5783e28ed5302489bc72f61efe92438a1613fcf90b7d5c',
    architectures: ['amd64', 'arm64'],
    imageTag: 'latest',
  },
  {
    id: 'osrf',
    label: 'docker.io/osrf (official, amd64)',
    description:
      'Official OSRF Humble desktop image. amd64 only — may not run on Apple Silicon without emulation.',
    imageRef:
      'docker.io/osrf/ros:humble-desktop@sha256:3d87cf339919a85cff7743ec9ba5e7ec81ccc26c9f722f1c7a6af5008dfdc128',
    architectures: ['amd64'],
    imageTag: 'osrf',
  },
];

export const DEFAULT_SIMULATION_BASE_IMAGE: SimulationBaseImageId = 'sloretz';

/** Older ids from the first preset rollout — still accepted when loading settings. */
const LEGACY_BASE_IMAGE_IDS: Record<string, SimulationBaseImageId> = {
  'sloretz-multiarch': 'sloretz',
  'osrf-official': 'osrf',
};

export function resolveSimulationBaseImage(
  id: string | undefined | null,
): SimulationBaseImagePreset {
  const normalized = id ? (LEGACY_BASE_IMAGE_IDS[id] ?? id) : undefined;
  const preset = SIMULATION_BASE_IMAGES.find(p => p.id === normalized);
  return preset ?? SIMULATION_BASE_IMAGES.find(p => p.id === DEFAULT_SIMULATION_BASE_IMAGE)!;
}
