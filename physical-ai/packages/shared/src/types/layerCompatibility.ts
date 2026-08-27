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
export type HardenedApp =
  | 'nginx'
  | 'python'
  | 'nodejs'
  | 'postgresql'
  | 'valkey'
  | 'prometheus'
  | 'grafana'
  | 'cosign'
  | 'curl'
  | 'jq'
  | 'kubectl'
  | 'helm'
  | 'syft';

/**
 * How a Hummingbird hardened app image is consumed:
 * - `companion` — a full service image pulled and run *alongside* the robotics image
 *   (nginx, postgresql, grafana …). It is not baked into the built image.
 * - `tool` — a single hardened CLI binary baked *into* the built image with a real
 *   `COPY --from` from the hardened image (cosign, jq, kubectl …).
 */
export type HummingbirdKind = 'companion' | 'tool';

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

export interface HummingbirdAppOption extends LayerOption<HardenedApp> {
  kind: HummingbirdKind;
  /**
   * For `tool` apps: the binary path inside the hardened image to `COPY --from`.
   * The generated line copies it onto the built image's PATH (`/usr/local/bin`).
   */
  binPath?: string;
}

/** Full hardened image reference for a Hummingbird app (always the `:latest` daily rebuild). */
export function hummingbirdImageRef(app: HardenedApp): string {
  return `quay.io/hummingbird/${app}:latest`;
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

export const HUMMINGBIRD_APP_OPTIONS: readonly HummingbirdAppOption[] = [
  // Companions — pulled and run as separate service images alongside the robotics image.
  {
    id: 'nginx',
    label: 'Nginx',
    note: 'Hardened web server / reverse proxy (dashboards, noVNC)',
    kind: 'companion',
  },
  { id: 'python', label: 'Python', note: 'Hardened Python runtime (ROS 2 nodes & tooling)', kind: 'companion' },
  { id: 'nodejs', label: 'Node.js', note: 'Hardened Node.js runtime (web dashboards & tooling)', kind: 'companion' },
  {
    id: 'postgresql',
    label: 'PostgreSQL',
    note: 'Hardened PostgreSQL (telemetry / state store)',
    kind: 'companion',
  },
  {
    id: 'valkey',
    label: 'Valkey',
    note: 'Hardened Redis-compatible store (cache / message backing)',
    kind: 'companion',
  },
  { id: 'prometheus', label: 'Prometheus', note: 'Hardened Prometheus (fleet metrics)', kind: 'companion' },
  { id: 'grafana', label: 'Grafana', note: 'Hardened Grafana (fleet dashboards)', kind: 'companion' },
  // Tools — hardened CLI binaries baked into the built image with a real COPY --from.
  // binPath values verified against the actual quay.io/hummingbird/<id>:latest image
  // filesystem (podman create + export + tar -t) — all five ship at /usr/bin/<id>.
  {
    id: 'cosign',
    label: 'Cosign',
    note: 'Hardened cosign CLI (sign & verify images)',
    kind: 'tool',
    binPath: '/usr/bin/cosign',
  },
  {
    id: 'curl',
    label: 'curl',
    note: 'Hardened curl CLI (health checks, fetches)',
    kind: 'tool',
    binPath: '/usr/bin/curl',
  },
  { id: 'jq', label: 'jq', note: 'Hardened jq CLI (JSON wrangling in scripts)', kind: 'tool', binPath: '/usr/bin/jq' },
  {
    id: 'kubectl',
    label: 'kubectl',
    note: 'Hardened kubectl CLI (cluster ops from the image)',
    kind: 'tool',
    binPath: '/usr/bin/kubectl',
  },
  {
    id: 'helm',
    label: 'Helm',
    note: 'Hardened helm CLI (chart deploys from the image)',
    kind: 'tool',
    binPath: '/usr/bin/helm',
  },
  {
    id: 'syft',
    label: 'Syft',
    note: 'Real use case: generates an actual Software Bill of Materials (SBOM) for your built image, shown in Recent Builds after the build completes',
    kind: 'tool',
  },
];

/** Companion Hummingbird apps — pulled & run alongside; not baked into the image. */
export const HUMMINGBIRD_COMPANION_OPTIONS: readonly HummingbirdAppOption[] = HUMMINGBIRD_APP_OPTIONS.filter(
  o => o.kind === 'companion',
);

/** Tool Hummingbird apps — hardened CLIs baked into the image via COPY --from. */
export const HUMMINGBIRD_TOOL_OPTIONS: readonly HummingbirdAppOption[] = HUMMINGBIRD_APP_OPTIONS.filter(
  o => o.kind === 'tool',
);

export const ROS_OPTIONS: readonly LayerOption<RosLayer>[] = [
  { id: 'none', label: 'None', note: 'No ROS layer' },
  { id: 'ros2-jazzy', label: 'ROS2 Jazzy', note: 'Installs via apt on Ubuntu' },
  { id: 'ros2-humble', label: 'ROS2 Humble', note: 'Installs via apt on Ubuntu' },
];

export const SIM_OPTIONS: readonly LayerOption<SimLayer>[] = [
  { id: 'none', label: 'None', note: 'No simulation layer' },
  { id: 'gazebo-nav2-tb3', label: 'Gazebo + Nav2 + TurtleBot3', note: 'Requires a ROS layer beneath it' },
];

/**
 * Declarative capability model for each base OS. The compatibility verdict is *derived*
 * from these facts rather than hand-written per combination, so every layer selection is
 * classified completely (build-feasible? × robotics-image?) with no coverage gaps.
 *
 * Empirical basis (S8-14 spike): ROS 2 Jazzy and the Gazebo/Nav2/TurtleBot3 sim stack
 * install via apt on Ubuntu and have no installable equivalent on the dnf-based bootc
 * bases today, so those bases support neither ROS nor sim. This table is the single place
 * to flip a fact if upstream packaging changes (or to add a new base).
 */
interface BaseOsCapability {
  /** a bootc (bootable-container) base rather than the plain Ubuntu base */
  isBootc: boolean;
  /** OS package manager the base ships with */
  packaging: 'apt' | 'dnf';
  /** pulling the base image needs a Red Hat subscription (registry.redhat.io) */
  requiresSubscription: boolean;
  /** ROS 2 packages are installable on this base today (empirically: Ubuntu only) */
  supportsRos: boolean;
  /** the Gazebo/Nav2/TurtleBot3 sim stack is installable on this base today (Ubuntu only) */
  supportsSim: boolean;
  /** an official ROS package repository exists for this distro family at all (Fedora has none) */
  hasRosRepo: boolean;
}

const BASE_OS_CAPABILITY: Record<BaseOsLayer, BaseOsCapability> = {
  'ubuntu-noble': {
    isBootc: false,
    packaging: 'apt',
    requiresSubscription: false,
    supportsRos: true,
    supportsSim: true,
    hasRosRepo: true,
  },
  'centos-bootc-stream9': {
    isBootc: true,
    packaging: 'dnf',
    requiresSubscription: false,
    supportsRos: false,
    supportsSim: false,
    hasRosRepo: true,
  },
  'centos-bootc-stream10': {
    isBootc: true,
    packaging: 'dnf',
    requiresSubscription: false,
    supportsRos: false,
    supportsSim: false,
    hasRosRepo: true,
  },
  'fedora-bootc-42': {
    isBootc: true,
    packaging: 'dnf',
    requiresSubscription: false,
    supportsRos: false,
    supportsSim: false,
    hasRosRepo: false,
  },
  'fedora-bootc-43': {
    isBootc: true,
    packaging: 'dnf',
    requiresSubscription: false,
    supportsRos: false,
    supportsSim: false,
    hasRosRepo: false,
  },
  'fedora-bootc-44': {
    isBootc: true,
    packaging: 'dnf',
    requiresSubscription: false,
    supportsRos: false,
    supportsSim: false,
    hasRosRepo: false,
  },
  'rhel-bootc': {
    isBootc: true,
    packaging: 'dnf',
    requiresSubscription: true,
    supportsRos: false,
    supportsSim: false,
    hasRosRepo: true,
  },
  'rhel10-bootc': {
    isBootc: true,
    packaging: 'dnf',
    requiresSubscription: true,
    supportsRos: false,
    supportsSim: false,
    hasRosRepo: true,
  },
};

function labelForBaseOs(baseOs: BaseOsLayer): string {
  return BASE_OS_OPTIONS.find(o => o.id === baseOs)?.label ?? baseOs;
}

const LEVEL_RANK: Record<CompatMessage['level'], number> = { info: 0, warn: 1, error: 2 };

/**
 * Derive the compatibility verdict for a layer selection from the base OS capability
 * model above. The logic is three ordered concerns — (1) build-feasibility errors,
 * (2) independent advisories, (3) a mutually-exclusive image classification — so that
 * *every* selection resolves to a coherent, complete verdict.
 */
export function evaluateStack(sel: LayerSelection): CompatResult {
  const messages: CompatMessage[] = [];
  const cap = BASE_OS_CAPABILITY[sel.baseOs];
  const baseLabel = labelForBaseOs(sel.baseOs);
  const wantsRos = sel.ros !== 'none';
  const wantsSim = sel.sim !== 'none';

  let failsAtStep: string | undefined;

  // (1) Build-feasibility — a selected layer the base can't satisfy fails at build time.
  if (wantsRos && !cap.supportsRos) {
    messages.push({
      level: 'error',
      text: cap.hasRosRepo
        ? `ROS layers install via apt on Ubuntu; base ${baseLabel} is ${cap.packaging}-based with no ROS Jazzy sim packages — the build fails at the ROS install step.`
        : `${baseLabel} has no official ROS repository at all — the build fails at the ROS install step.`,
    });
    failsAtStep = 'ros-install';
  }

  if (wantsSim && !cap.supportsSim) {
    messages.push({
      level: 'error',
      text: `Gazebo Harmonic / Nav2 / TurtleBot3 sim are not published for ${baseLabel} (no el9 RPMs) — the build fails at the simulation install step.`,
    });
    failsAtStep ??= 'sim-install';
  }

  if (wantsSim && !wantsRos) {
    messages.push({
      level: 'error',
      text: 'The simulation layer needs a ROS layer beneath it — select a ROS layer.',
    });
    failsAtStep ??= 'sim-install';
  }

  const blocked = messages.some(m => m.level === 'error');

  // (2) Advisories — independent of build-feasibility.
  if (cap.requiresSubscription) {
    messages.push({
      level: 'warn',
      text: 'RHEL bootc requires a Red Hat subscription (registry.redhat.io) to pull.',
    });
  }

  if (sel.hardened === 'hummingbird-app' && wantsRos) {
    messages.push({
      level: 'info',
      text: 'Hummingbird provides optional hardened application images (quay.io/hummingbird/*) as a side component — it does not change the ROS/robotics build.',
    });
  }

  // (3) Image classification — only meaningful for a build that would succeed. ROS is what
  // makes the image a robotics image; without it, a buildable image is "just a base". This
  // branch is exhaustive over buildable selections, so no combination is left unclassified.
  if (!blocked) {
    if (!wantsRos) {
      messages.push({
        level: 'warn',
        text: `Builds ${cap.isBootc ? 'a bootc base image' : 'a base image'}, but it has no ROS layer — not a robotics image yet.`,
      });
    } else if (!messages.some(m => m.level === 'error' || m.level === 'warn')) {
      messages.push({
        level: 'info',
        text: 'Known-good combination — builds and runs today.',
      });
    }
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

/** Full image reference this wizard would pull/FROM for a given base OS layer. */
export function baseOsImageRef(baseOs: BaseOsLayer): string {
  return BASE_OS_IMAGE_REF[baseOs];
}

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
        const optionById = new Map<HardenedApp, HummingbirdAppOption>(HUMMINGBIRD_APP_OPTIONS.map(o => [o.id, o]));
        const companions = apps.filter(a => optionById.get(a)?.kind === 'companion');
        const tools = apps.filter(a => optionById.get(a)?.kind === 'tool');
        // Companions run as their own images — noted, not baked into this build.
        for (const app of companions) {
          lines.push(`# companion image (pull & run alongside): ${hummingbirdImageRef(app)}`);
        }
        // Tools are baked in with a real COPY --from from the hardened image.
        for (const app of tools) {
          const binPath = optionById.get(app)?.binPath ?? `/usr/bin/${app}`;
          lines.push(`# ${app} — hardened CLI baked in from ${hummingbirdImageRef(app)}`);
          lines.push(`COPY --from=${hummingbirdImageRef(app)} ${binPath} /usr/local/bin/${app}`);
        }
      }
    } else {
      lines.push('# (Hummingbird provides hardened app images from quay.io/hummingbird/*; optional component)');
    }
    sections.push(lines.join('\n'));
  }

  // Package manager matches the base's actual packaging (BASE_OS_CAPABILITY) so an
  // "Attempt anyway" build on a dnf-based bootc image fails on real package unavailability
  // (the S8-14 finding), not on a misleading "apt-get: command not found".
  const cap = BASE_OS_CAPABILITY[sel.baseOs];
  const installCmd = cap.packaging === 'dnf' ? 'dnf install -y' : 'apt-get update && apt-get install -y';

  // The base OS images are bare (no ROS apt source configured), unlike the tested-preset
  // path which FROMs an already-ROS-baked image — without this, "apt-get install ros-*"
  // fails with "Unable to locate package" even on an otherwise-buildable Ubuntu base.
  if (cap.packaging === 'apt' && (sel.ros !== 'none' || sel.sim !== 'none')) {
    sections.push(
      '# ROS 2 apt repository (required before installing any ros-* package on Ubuntu)\n' +
        'RUN apt-get update && apt-get install -y curl gnupg lsb-release && ' +
        'curl -sSL https://raw.githubusercontent.com/ros/rosdistro/master/ros.key ' +
        '-o /usr/share/keyrings/ros-archive-keyring.gpg && ' +
        'echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/ros-archive-keyring.gpg] ' +
        'http://packages.ros.org/ros2/ubuntu $(. /etc/os-release && echo $UBUNTU_CODENAME) main" ' +
        '| tee /etc/apt/sources.list.d/ros2.list > /dev/null',
    );
  }

  if (sel.ros !== 'none') {
    const distro = ROS_DISTRO[sel.ros];
    sections.push(`# Layer 3 — ROS: ${labelFor(ROS_OPTIONS, sel.ros)}\nRUN ${installCmd} ros-${distro}-desktop`);
  }

  if (sel.sim !== 'none') {
    const distro = sel.ros !== 'none' ? ROS_DISTRO[sel.ros] : 'jazzy';
    sections.push(
      `# Layer 4 — Simulation: ${labelFor(SIM_OPTIONS, sel.sim)}\n` +
        `RUN ${installCmd} ros-${distro}-navigation2 ros-${distro}-nav2-bringup ` +
        `ros-${distro}-nav2-minimal-tb3-sim ros-${distro}-ros-gz-sim`,
    );
  }

  return sections.join('\n\n') + '\n';
}
