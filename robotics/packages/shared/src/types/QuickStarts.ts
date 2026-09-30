import type { SupportedArchitecture } from './CustomSimulationTemplates';
import type { ImageBuilderRecipe } from './ImageBuilderRecipe';

export type QuickStartId = 'ubuntu-jazzy-arm64' | 'ubuntu-jazzy-amd64' | 'fedora-bootc43-lyrical-amd64';

export type QuickStartBuildMode = 'ubuntu-preset' | 'fedora-layers';

export interface QuickStartDefinition {
  id: QuickStartId;
  label: string;
  description: string;
  targetArch: SupportedArchitecture;
  buildMode: QuickStartBuildMode;
  /** Read-only recipe lines shown on the Presets tab. */
  recipeSummary: readonly string[];
  recipe: Pick<ImageBuilderRecipe, 'base' | 'simulation' | 'hardenedTools' | 'generateSbom'>;
  /** Layer-composer selection for Fedora stacks (containerfile build on Presets). */
  layerPreset?: {
    baseOs: 'fedora-bootc-43';
    ros: 'ros2-lyrical';
    sim: 'gazebo-nav2-tb3';
  };
}

export const QUICK_STARTS: readonly QuickStartDefinition[] = [
  {
    id: 'ubuntu-jazzy-arm64',
    label: 'TurtleBot3 Sim (Jazzy · arm64)',
    description: 'Ubuntu Noble + ROS 2 Jazzy + Gazebo/Nav2/TurtleBot3 simulation (arm64)',
    targetArch: 'arm64',
    buildMode: 'ubuntu-preset',
    recipeSummary: [
      'Robot: TurtleBot3',
      'ROS distro: Jazzy (simulation)',
      'Simulation: Gazebo + Nav2',
      'Base image: Ubuntu 24.04 Noble',
      'Target architecture: arm64',
    ],
    recipe: {
      base: { kind: 'preset', presetId: 'jazzy-noble' },
      simulation: { kind: 'preset', profileId: 'turtlebot3-jazzy-dds-gazebo' },
      hardenedTools: [],
      generateSbom: false,
    },
  },
  {
    id: 'ubuntu-jazzy-amd64',
    label: 'TurtleBot3 Sim (Jazzy · amd64)',
    description:
      'Ubuntu Noble + ROS 2 Jazzy + Gazebo/Nav2/TurtleBot3 simulation (amd64 for OpenShift and Linux x86_64)',
    targetArch: 'amd64',
    buildMode: 'ubuntu-preset',
    recipeSummary: [
      'Robot: TurtleBot3',
      'ROS distro: Jazzy (simulation)',
      'Simulation: Gazebo + Nav2',
      'Base image: Ubuntu 24.04 Noble',
      'Target architecture: amd64',
    ],
    recipe: {
      base: { kind: 'preset', presetId: 'jazzy-noble' },
      simulation: { kind: 'preset', profileId: 'turtlebot3-jazzy-dds-gazebo' },
      hardenedTools: [],
      generateSbom: false,
    },
  },
  {
    id: 'fedora-bootc43-lyrical-amd64',
    label: 'TurtleBot3 Sim (Lyrical · amd64)',
    description: 'Fedora bootc 43 + ROS 2 Lyrical + Gazebo/Nav2/TurtleBot3 simulation (amd64)',
    targetArch: 'amd64',
    buildMode: 'fedora-layers',
    recipeSummary: [
      'Robot: TurtleBot3',
      'ROS distro: ROS 2 Lyrical',
      'Simulation: Gazebo + Nav2',
      'Base image: Fedora bootc 43',
      'Target architecture: amd64 (x86_64 Lyrical testing repo)',
    ],
    recipe: {
      base: { kind: 'preset', presetId: 'fedora-bootc-43' },
      simulation: { kind: 'preset', profileId: 'turtlebot3-lyrical-gazebo' },
      hardenedTools: [],
      generateSbom: false,
    },
    layerPreset: { baseOs: 'fedora-bootc-43', ros: 'ros2-lyrical', sim: 'gazebo-nav2-tb3' },
  },
];

export const QUICK_START_DEFINITIONS = QUICK_STARTS;

export const DEFAULT_QUICK_START_ID: QuickStartId = 'ubuntu-jazzy-arm64';

export function resolveQuickStart(id: string): QuickStartDefinition | undefined {
  return QUICK_STARTS.find(quickStart => quickStart.id === id);
}

export function inferQuickStartIdFromSimulationConfig(config: {
  baseImage?: string;
  distro?: string;
  targetArch?: SupportedArchitecture;
  quickStartId?: string;
}): QuickStartId | undefined {
  if (config.quickStartId && resolveQuickStart(config.quickStartId)) {
    return config.quickStartId as QuickStartId;
  }
  if (config.baseImage === 'jazzy-noble' && config.distro === 'jazzy') {
    return config.targetArch === 'amd64' ? 'ubuntu-jazzy-amd64' : 'ubuntu-jazzy-arm64';
  }
  return undefined;
}

/** Apply a Quick Start without mutating the caller or carrying stale selections forward. */
export function applyQuickStart(recipe: ImageBuilderRecipe, id: QuickStartId): ImageBuilderRecipe {
  const quickStart = resolveQuickStart(id);
  if (!quickStart) throw new Error(`Unknown Quick Start: ${id}`);
  return { ...recipe, ...quickStart.recipe, targetArch: quickStart.targetArch };
}
