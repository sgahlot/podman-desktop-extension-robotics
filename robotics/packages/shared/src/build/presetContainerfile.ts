import type { QuickStartId } from '../config/quickStartCatalog';
import { resolveQuickStart } from '../config/quickStartCatalog';
import {
  baseOsImageRef,
  generateLayerContainerfile,
  type BaseOsLayer,
  type LayerSelection,
  type RosLayer,
  type SimLayer,
} from '../types/layerCompatibility';
import {
  FEDORA_LYRICAL_REPOSITORY,
  INSTALL_CLEANUP,
  INSTALL_COMMAND,
  ROS_DESKTOP_PACKAGES,
  SIMULATION_PACKAGES,
} from '../types/layerStackConfig';
import type { TargetArch } from '../types/SimulationConfig';

const DEFAULT_LAYER_SELECTION: LayerSelection = {
  baseOs: 'ubuntu-noble',
  customBaseImage: '',
  hardened: 'none',
  ros: 'ros2-jazzy',
  sim: 'gazebo-nav2-tb3',
};

/**
 * Ensures the ROS 2 Lyrical testing repo is configured before the first lyrical `dnf`
 * install when the generator output omitted it (defensive; canonical path chains repo in ROS RUN).
 */
export function ensureFedoraLyricalContainerfile(sel: LayerSelection, generated: string): string {
  if (sel.baseOs !== 'fedora-bootc-43' || sel.ros !== 'ros2-lyrical' || generated.includes('baseurl=')) {
    return generated;
  }
  const rosInstall = 'RUN dnf --releasever=43 install -y ros-lyrical-';
  const pos = generated.indexOf(rosInstall);
  if (pos < 0) return `${generated}\n${FEDORA_LYRICAL_REPOSITORY}\n`;
  const lineStart = generated.lastIndexOf('\n', pos) + 1;
  return `${generated.slice(0, lineStart)}${FEDORA_LYRICAL_REPOSITORY}\n\n${generated.slice(lineStart)}`;
}

function fallbackContainerfilePreview(sel: LayerSelection): string {
  const baseRef = baseOsImageRef(sel.baseOs, sel.customBaseImage);
  if (!baseRef) return '';
  if (sel.baseOs !== 'fedora-bootc-43' || sel.ros !== 'ros2-lyrical') {
    return `# Layer 1 — Base OS\nFROM ${baseRef}\n`;
  }
  const install = INSTALL_COMMAND['fedora-bootc-43'];
  const cleanup = INSTALL_CLEANUP['fedora-bootc-43'];
  const ros = ROS_DESKTOP_PACKAGES.lyrical.map(pkg => `ros-lyrical-${pkg}`).join(' ');
  const sim = SIMULATION_PACKAGES.lyrical.map(pkg => `ros-lyrical-${pkg}`).join(' ');
  return (
    `# Layer 1 — Base OS\nFROM ${baseRef}\n\n${FEDORA_LYRICAL_REPOSITORY}\n\n` +
    `RUN ${install} ${ros}${cleanup}\n\nRUN ${install} ${sim}${cleanup}\n`
  );
}

/**
 * Canonical Containerfile for the Layers wizard and Presets fedora-layers quick start.
 * UI and tests must use this — not `generateLayerContainerfile` alone.
 */
export function buildLayerStackContainerfile(sel: LayerSelection, targetArch: TargetArch = 'amd64'): string {
  try {
    const generated = generateLayerContainerfile(sel, targetArch);
    return ensureFedoraLyricalContainerfile(sel, generated);
  } catch {
    return fallbackContainerfilePreview(sel);
  }
}

export function layerSelectionFromQuickStart(quickStartId: QuickStartId): LayerSelection {
  const quickStart = resolveQuickStart(quickStartId);
  if (!quickStart?.layerPreset) {
    throw new Error(`Quick start "${quickStartId}" does not define a layer preset.`);
  }
  return {
    ...DEFAULT_LAYER_SELECTION,
    baseOs: quickStart.layerPreset.baseOs as BaseOsLayer,
    customBaseImage: '',
    ros: quickStart.layerPreset.ros as RosLayer,
    sim: quickStart.layerPreset.sim as SimLayer,
  };
}

/** Containerfile for Presets quick starts that use the layer composer (`buildMode: fedora-layers`). */
export function buildPresetContainerfile(quickStartId: QuickStartId, targetArch: TargetArch): string {
  const quickStart = resolveQuickStart(quickStartId);
  if (!quickStart) throw new Error(`Unknown Quick Start: ${quickStartId}`);
  if (quickStart.buildMode !== 'fedora-layers' || !quickStart.layerPreset) {
    throw new Error(`Quick start "${quickStartId}" does not use the layer Containerfile builder.`);
  }
  if (targetArch !== quickStart.targetArch) {
    throw new Error(`Quick start "${quickStartId}" requires targetArch ${quickStart.targetArch}, got ${targetArch}.`);
  }
  return buildLayerStackContainerfile(layerSelectionFromQuickStart(quickStartId), targetArch);
}

/**
 * Minimal image for integration smoke: Fedora bootc 43 + one Lyrical RPM from the testing repo.
 * Installs only `ros-lyrical-desktop-runtime` (not -devel) to keep the dependency tree and
 * build time manageable; full presets still install runtime + devel via `buildLayerStackContainerfile`.
 */
export function buildLyricalRosDesktopSmokeContainerfile(): string {
  const sel: LayerSelection = {
    ...DEFAULT_LAYER_SELECTION,
    baseOs: 'fedora-bootc-43',
    ros: 'ros2-lyrical',
    sim: 'none',
  };
  const baseRef = baseOsImageRef(sel.baseOs, sel.customBaseImage);
  const install = INSTALL_COMMAND['fedora-bootc-43'];
  const cleanup = INSTALL_CLEANUP['fedora-bootc-43'];
  return (
    `# Integration smoke — ROS 2 Lyrical desktop on Fedora bootc 43\n` +
    `FROM ${baseRef}\n\n` +
    `${FEDORA_LYRICAL_REPOSITORY}\n\n` +
    `# Prove the testing repo resolves Lyrical RPMs (runtime only; full preset adds -devel)\n` +
    `RUN ${install} ros-lyrical-desktop-runtime${cleanup}\n`
  );
}
