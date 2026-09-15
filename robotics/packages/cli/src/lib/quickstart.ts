import type { SimulationConfig } from '../../../shared/src/types/SimulationConfig';

/**
 * Mirrors the extension's Quick Start preset exactly (packages/frontend/src/SimulationSetup.svelte
 * — QUICK_START_PRESET / applyQuickStart): TurtleBot3 + Jazzy + DDS + Gazebo on the multi-arch
 * "jazzy-noble" (Ubuntu 24.04 Noble) base image. Keep this in sync with that file if the UI's
 * preset ever changes — there's no shared source of truth between the frontend (Svelte) and
 * this CLI to enforce it automatically.
 *
 * Unlike the UI (where Quick Start and the Target arch toggle are deliberately independent
 * controls — see SimulationSetup.svelte's comment "targetArch is intentionally excluded; Quick
 * Start never touches it"), this CLI folds the target arch into the `--quickstart <arch>` flag
 * itself. A single switch that says "apply the quick-start preset, for this arch" is the more
 * natural shape for a CLI flag than two separately-orthogonal ones.
 */
export const QUICK_START_PRESET = {
  robot: 'turtlebot3',
  distro: 'jazzy',
  middleware: 'dds',
  engine: 'gazebo',
  baseImage: 'jazzy-noble',
} as const satisfies Omit<SimulationConfig, 'targetArch'>;
