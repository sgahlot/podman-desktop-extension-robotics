/**
 * Pure compatibility engine for the layer-composition wizard (APPENG-6108).
 *
 * Encodes empirical findings from an el9/bootc feasibility spike: ROS2 Jazzy and the
 * Gazebo/Nav2/TurtleBot3 simulation stack install via apt on Ubuntu and have no
 * equivalent el9 RPMs today, so any dnf-based ("bootc") base blocks those layers.
 *
 * No Svelte, no I/O — safe to unit test directly and to share between the extension
 * backend and the future wizard UI.
 */

export type BaseOsLayer = 'ubuntu-noble' | 'centos-bootc-stream9' | 'fedora-bootc-43' | 'rhel-bootc';
export type HardenedLayer = 'none' | 'hummingbird-app';
export type RosLayer = 'none' | 'ros2-jazzy' | 'ros2-humble';
export type SimLayer = 'none' | 'gazebo-nav2-tb3';

export interface LayerSelection {
  baseOs: BaseOsLayer;
  hardened: HardenedLayer;
  ros: RosLayer;
  sim: SimLayer;
}

export type CompatLevel = 'ok' | 'warn' | 'blocked';

export interface CompatMessage {
  level: 'info' | 'warn' | 'error';
  text: string;
}

export interface CompatResult {
  level: CompatLevel;
  /** false only when level === 'blocked' */
  buildable: boolean;
  messages: CompatMessage[];
  /** the build step where a blocked combo would fail, e.g. 'ros-install', or undefined when not blocked */
  failsAtStep: string | undefined;
}

export interface LayerOption<TId extends string> {
  id: TId;
  label: string;
  note: string;
}

export const BASE_OS_OPTIONS: readonly LayerOption<BaseOsLayer>[] = [
  { id: 'ubuntu-noble', label: 'Ubuntu Noble', note: 'ROS-ready (current default)' },
  {
    id: 'centos-bootc-stream9',
    label: 'CentOS bootc (Stream 9)',
    note: 'bootc — core RPMs only, arm64 repo empty, unsigned',
  },
  { id: 'fedora-bootc-43', label: 'Fedora bootc 43', note: 'bootc — no ROS repo' },
  { id: 'rhel-bootc', label: 'RHEL bootc', note: 'bootc — requires Red Hat subscription' },
];

export const HARDENED_OPTIONS: readonly LayerOption<HardenedLayer>[] = [
  { id: 'none', label: 'None', note: 'Skip the hardened application layer' },
  { id: 'hummingbird-app', label: 'Hummingbird app', note: 'Hardened nginx/python-class application images' },
];

export const ROS_OPTIONS: readonly LayerOption<RosLayer>[] = [
  { id: 'none', label: 'None', note: 'No ROS layer' },
  { id: 'ros2-jazzy', label: 'ROS2 Jazzy', note: 'Installs via apt on Ubuntu' },
  { id: 'ros2-humble', label: 'ROS2 Humble', note: 'Installs via apt on Ubuntu' },
];

export const SIM_OPTIONS: readonly LayerOption<SimLayer>[] = [
  { id: 'none', label: 'None', note: 'No simulation layer' },
  { id: 'gazebo-nav2-tb3', label: 'Gazebo + Nav2 + TurtleBot3', note: 'Requires a ROS layer beneath it' },
];

const BOOTC_BASES: readonly BaseOsLayer[] = ['centos-bootc-stream9', 'fedora-bootc-43', 'rhel-bootc'];

function isBootc(baseOs: BaseOsLayer): boolean {
  return BOOTC_BASES.includes(baseOs);
}

function labelForBaseOs(baseOs: BaseOsLayer): string {
  return BASE_OS_OPTIONS.find(o => o.id === baseOs)?.label ?? baseOs;
}

const LEVEL_RANK: Record<CompatMessage['level'], number> = { info: 0, warn: 1, error: 2 };

export function evaluateStack(sel: LayerSelection): CompatResult {
  const messages: CompatMessage[] = [];
  const bootc = isBootc(sel.baseOs);
  const baseLabel = labelForBaseOs(sel.baseOs);

  let failsAtStep: string | undefined;

  // R1
  if (sel.ros !== 'none' && bootc) {
    messages.push({
      level: 'error',
      text: `ROS layers install via apt on Ubuntu; base ${baseLabel} is dnf-based with no ROS Jazzy sim packages — the build fails at the ROS install step.`,
    });
    failsAtStep = 'ros-install';
  }

  // R2
  if (sel.sim !== 'none' && bootc) {
    messages.push({
      level: 'error',
      text: `Gazebo Harmonic / Nav2 / TurtleBot3 sim are not published for ${baseLabel} (no el9 RPMs) — the build fails at the simulation install step.`,
    });
    failsAtStep ??= 'sim-install';
  }

  // R3
  if (sel.sim !== 'none' && sel.ros === 'none') {
    messages.push({
      level: 'error',
      text: 'The simulation layer needs a ROS layer beneath it — select a ROS layer.',
    });
    failsAtStep ??= 'sim-install';
  }

  // R4 (optional clarifying warn, non-duplicative with R1's error)
  if (sel.baseOs === 'fedora-bootc-43' && sel.ros !== 'none') {
    messages.push({
      level: 'warn',
      text: 'Fedora has no official ROS repository at all.',
    });
  }

  // R5
  if (sel.hardened === 'hummingbird-app' && sel.ros !== 'none') {
    messages.push({
      level: 'warn',
      text: 'Hummingbird provides hardened application images (nginx/python-class), not a ROS OS base — treated as an optional component; it does not change the ROS build.',
    });
  }

  // R6
  if (bootc && sel.ros === 'none' && sel.sim === 'none') {
    messages.push({
      level: 'warn',
      text: 'Builds a bootc base image, but it contains no ROS layer — not a robotics image yet.',
    });
  }

  // R7
  if (sel.baseOs === 'rhel-bootc') {
    messages.push({
      level: 'warn',
      text: 'RHEL bootc requires a Red Hat subscription (registry.redhat.io) to pull.',
    });
  }

  // R8
  const hasErrorOrWarn = messages.some(m => m.level === 'error' || m.level === 'warn');
  if (sel.baseOs === 'ubuntu-noble' && sel.ros !== 'none' && !hasErrorOrWarn) {
    messages.push({
      level: 'info',
      text: 'Known-good combination — builds and runs today.',
    });
  }

  const worst = messages.reduce<CompatMessage['level']>(
    (acc, m) => (LEVEL_RANK[m.level] > LEVEL_RANK[acc] ? m.level : acc),
    'info',
  );

  const level: CompatLevel = worst === 'error' ? 'blocked' : worst === 'warn' ? 'warn' : 'ok';

  return {
    level,
    buildable: level !== 'blocked',
    messages,
    failsAtStep: level === 'blocked' ? failsAtStep : undefined,
  };
}
