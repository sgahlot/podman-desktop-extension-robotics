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

export type BaseOsLayer =
  | 'ubuntu-noble'
  | 'centos-bootc-stream9'
  | 'centos-bootc-stream10'
  | 'fedora-bootc-42'
  | 'fedora-bootc-43'
  | 'fedora-bootc-44'
  | 'rhel-bootc'
  | 'rhel10-bootc';
export type HardenedLayer = 'none' | 'hummingbird-app';
export type RosLayer = 'none' | 'ros2-jazzy' | 'ros2-humble';
export type SimLayer = 'none' | 'gazebo-nav2-tb3';
export type HardenedApp = 'nginx' | 'python' | 'node' | 'postgres' | 'redis';

export interface LayerSelection {
  baseOs: BaseOsLayer;
  hardened: HardenedLayer;
  ros: RosLayer;
  sim: SimLayer;
  hummingbirdApps?: HardenedApp[];
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
  {
    id: 'centos-bootc-stream10',
    label: 'CentOS bootc (Stream 10)',
    note: 'bootc — core RPMs only, unsigned',
  },
  { id: 'fedora-bootc-42', label: 'Fedora bootc 42', note: 'bootc — no ROS repo' },
  { id: 'fedora-bootc-43', label: 'Fedora bootc 43', note: 'bootc — no ROS repo' },
  { id: 'fedora-bootc-44', label: 'Fedora bootc 44', note: 'bootc — no ROS repo' },
  { id: 'rhel-bootc', label: 'RHEL bootc 9', note: 'bootc — requires Red Hat subscription' },
  { id: 'rhel10-bootc', label: 'RHEL bootc 10', note: 'bootc — requires Red Hat subscription' },
];

export const HARDENED_OPTIONS: readonly LayerOption<HardenedLayer>[] = [
  { id: 'none', label: 'None', note: 'Skip the hardened application layer' },
  { id: 'hummingbird-app', label: 'Hummingbird app', note: 'Hardened nginx/python-class application images' },
];

export const HUMMINGBIRD_APP_OPTIONS: readonly LayerOption<HardenedApp>[] = [
  { id: 'nginx', label: 'Nginx', note: 'Hardened drop-in for nginx' },
  { id: 'python', label: 'Python', note: 'Hardened drop-in for python' },
  { id: 'node', label: 'Node', note: 'Hardened drop-in for node' },
  { id: 'postgres', label: 'Postgres', note: 'Hardened drop-in for postgres' },
  { id: 'redis', label: 'Redis', note: 'Hardened drop-in for redis' },
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

function isBootc(baseOs: BaseOsLayer): boolean {
  return baseOs !== 'ubuntu-noble';
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
  if (sel.baseOs.startsWith('fedora-bootc') && sel.ros !== 'none') {
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
  if (sel.baseOs.startsWith('rhel')) {
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

const BASE_OS_IMAGE_REF: Record<BaseOsLayer, string> = {
  'ubuntu-noble': 'docker.io/library/ubuntu:24.04',
  'centos-bootc-stream9': 'quay.io/centos-bootc/centos-bootc:stream9',
  'centos-bootc-stream10': 'quay.io/centos-bootc/centos-bootc:stream10',
  'fedora-bootc-42': 'quay.io/fedora/fedora-bootc:42',
  'fedora-bootc-43': 'quay.io/fedora/fedora-bootc:43',
  'fedora-bootc-44': 'quay.io/fedora/fedora-bootc:44',
  'rhel-bootc': 'registry.redhat.io/rhel9/rhel-bootc:latest',
  'rhel10-bootc': 'registry.redhat.io/rhel10/rhel-bootc:latest',
};

const ROS_DISTRO: Record<Exclude<RosLayer, 'none'>, string> = {
  'ros2-jazzy': 'jazzy',
  'ros2-humble': 'humble',
};

function labelFor<TId extends string>(options: readonly LayerOption<TId>[], id: TId): string {
  return options.find(o => o.id === id)?.label ?? id;
}

/**
 * Pure Containerfile generator for the layer-composition wizard. Produces a commented,
 * human-readable Containerfile reflecting the selected layers — a preview of what would be
 * built once secure bootc/Hummingbird layers are available. No I/O, no validation beyond
 * skipping layers set to 'none'.
 */
export function generateLayerContainerfile(sel: LayerSelection): string {
  const sections: string[] = [];

  sections.push(`# Layer 1 — Base OS: ${labelFor(BASE_OS_OPTIONS, sel.baseOs)}\nFROM ${BASE_OS_IMAGE_REF[sel.baseOs]}`);

  if (sel.hardened !== 'none') {
    const lines = [`# Layer 2 — Hardened application layer: ${labelFor(HARDENED_OPTIONS, sel.hardened)}`];
    if (sel.hardened === 'hummingbird-app') {
      const apps = sel.hummingbirdApps ?? [];
      if (apps.length === 0) {
        lines.push('# (no hardened app images selected yet)');
      } else {
        for (const app of apps) {
          lines.push(`# ${app}  -> quay.io/hummingbird/${app}:latest (hardened drop-in)`);
        }
      }
    } else {
      lines.push('# (Hummingbird provides hardened app images from quay.io/hummingbird/*; optional component)');
    }
    sections.push(lines.join('\n'));
  }

  if (sel.ros !== 'none') {
    const distro = ROS_DISTRO[sel.ros];
    sections.push(
      `# Layer 3 — ROS: ${labelFor(ROS_OPTIONS, sel.ros)}\n` +
        `RUN apt-get update && apt-get install -y ros-${distro}-desktop`,
    );
  }

  if (sel.sim !== 'none') {
    const distro = sel.ros !== 'none' ? ROS_DISTRO[sel.ros] : 'jazzy';
    sections.push(
      `# Layer 4 — Simulation: ${labelFor(SIM_OPTIONS, sel.sim)}\n` +
        `RUN apt-get install -y ros-${distro}-navigation2 ros-${distro}-nav2-bringup ` +
        `ros-${distro}-nav2-minimal-tb3-sim ros-${distro}-ros-gz-sim`,
    );
  }

  return sections.join('\n\n') + '\n';
}
