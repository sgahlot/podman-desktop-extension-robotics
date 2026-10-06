/**
 * Pure compatibility engine for the layer-composition wizard (APPENG-6108).
 *
 * Encodes empirical findings from an el9/bootc feasibility spike: ROS2 Jazzy/Humble and
 * the Gazebo/Nav2/TurtleBot3 simulation stack install via apt on Ubuntu. Fedora 43 also
 * has an x86_64 ROS 2 Lyrical testing repository; other dnf-based bases block those layers.
 *
 * No Svelte, no I/O — safe to unit test directly and to share between the extension
 * backend and the future wizard UI.
 */
import { hummingbirdToolBakeContainerfileLines } from '../build/hummingbirdToolBake';
import {
  buildBaseOsOptions,
  buildHardenedOptions,
  buildRosOptions,
  buildSimOptions,
} from '../config/layerWizardCatalog';
import { HUMMINGBIRD_APP_DEFINITIONS, hummingbirdImageRefFromCatalog } from '../config/hummingbirdAppsCatalog';
import { generateCustomSimulationContainerfile, resolveCustomSimulationTemplate } from './CustomSimulationTemplates';
import { BASE_OS_IMAGE_REF } from './layerStackConfig';
import { generateSimOperationalLayerFragment } from './simOperationalLayer';
import { resolveStackConfig } from './stackConfigResolver';

export {
  managedSimBundleAssetDir,
  managedSimVerifyHooks,
  resolveStackConfig,
  selectionNeedsBundledSimRuntime,
} from './stackConfigResolver';

export type BaseOsLayer =
  | 'custom'
  | 'ubuntu-noble'
  | 'centos-bootc-stream9'
  | 'centos-bootc-stream10'
  | 'fedora-bootc-42'
  | 'fedora-bootc-43'
  | 'fedora-bootc-44'
  | 'rhel-bootc'
  | 'rhel10-bootc';
export type HardenedLayer = 'none' | 'hummingbird-app';
export type RosLayer = 'none' | 'provided-by-parent' | 'ros2-jazzy' | 'ros2-humble' | 'ros2-lyrical';
export type SimLayer = 'none' | 'gazebo-nav2-tb3' | 'custom-template';
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
  /** OCI image reference used when baseOs is `custom`. */
  customBaseImage?: string;
  customBaseOsFamily?: string;
  customBaseOsVersion?: string;
  customBaseRosDistro?: string;
  customBasePackaging?: 'apt' | 'dnf';
  hardened: HardenedLayer;
  ros: RosLayer;
  sim: SimLayer;
  customSimulationTemplateId?: string;
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

/**
 * Full hardened image reference for a Hummingbird app — always the public,
 * unauthenticated `registry.access.redhat.com/hi/*` path, one rule for every app (APPENG-6263).
 *
 * A `skopeo inspect` digest comparison (2026-09-01) found `nginx`/`cosign`/`curl`/`jq`/
 * `kubectl`/`helm` byte-identical to their old `quay.io/hummingbird/*` counterparts, but
 * `prometheus`/`grafana`-class apps rebuild every few hours and can legitimately drift between
 * the two registries at any given moment — a digest snapshot doesn't prove long-term
 * equivalence the way it does for the rarely-rebuilt CLI tools. None of these apps have
 * actually been exercised end-to-end yet (only `syft`, via SBOM generation, and `nginx`, as the
 * OpenShift sidecar, have real usage in the extension today), so rather than keep a curated
 * "verified" subset on one registry and everything else on the other, every app points here
 * uniformly until real testing says otherwise. If `:latest` churn ever causes a problem for
 * `syft` or `nginx` specifically (the two with actual live usage), pin those two to a known-good
 * tag/digest rather than reintroducing a mixed-registry split.
 */
export function hummingbirdImageRef(app: HardenedApp): string {
  return hummingbirdImageRefFromCatalog(app);
}

export const BASE_OS_OPTIONS = buildBaseOsOptions() as readonly LayerOption<BaseOsLayer>[];

export const HARDENED_OPTIONS = buildHardenedOptions() as readonly LayerOption<HardenedLayer>[];

export const HUMMINGBIRD_APP_OPTIONS = HUMMINGBIRD_APP_DEFINITIONS.map(def => ({
  id: def.id as HardenedApp,
  label: def.label,
  note: def.note,
  kind: def.kind,
  binPath: def.binPath,
})) as readonly HummingbirdAppOption[];

/** Companion Hummingbird apps — pulled & run alongside; not baked into the image. */
export const HUMMINGBIRD_COMPANION_OPTIONS: readonly HummingbirdAppOption[] = HUMMINGBIRD_APP_OPTIONS.filter(
  o => o.kind === 'companion',
);

/** Tool Hummingbird apps — hardened CLIs baked into the image via COPY --from. */
export const HUMMINGBIRD_TOOL_OPTIONS: readonly HummingbirdAppOption[] = HUMMINGBIRD_APP_OPTIONS.filter(
  o => o.kind === 'tool',
);

export const ROS_OPTIONS = buildRosOptions() as readonly LayerOption<RosLayer>[];

export const SIM_OPTIONS = buildSimOptions() as readonly LayerOption<SimLayer>[];

/**
 * Declarative capability model for each base OS. The compatibility verdict is *derived*
 * from these facts rather than hand-written per combination, so every layer selection is
 * classified completely (build-feasible? × robotics-image?) with no coverage gaps.
 *
 * Empirical basis (S8-14 spike): ROS 2 Jazzy/Humble and the Gazebo/Nav2/TurtleBot3 sim
 * stack install via apt on Ubuntu. Fedora 43 has the ROS 2 Lyrical x86_64 testing
 * repository; the other dnf-based bootc bases have no supported package set today. This
 * table is the single place to flip a fact if upstream packaging changes (or add a base).
 */
function labelForBaseOs(baseOs: BaseOsLayer, customBaseImage?: string): string {
  if (baseOs === 'custom') {
    const imageRef = customBaseImage?.trim();
    return imageRef && imageRef.length > 0 ? imageRef : 'Custom image reference';
  }

  return BASE_OS_OPTIONS.find(o => o.id === baseOs)?.label ?? baseOs;
}

const LEVEL_RANK: Record<CompatMessage['level'], number> = { info: 0, warn: 1, error: 2 };

/** Enrich custom-template selections with registered template contract fields for stack resolution. */
function selectionForStackResolution(sel: LayerSelection): LayerSelection {
  if (sel.sim !== 'custom-template') return sel;
  const template = resolveCustomSimulationTemplate(sel.customSimulationTemplateId ?? '');
  if (!template) return sel;
  return {
    ...sel,
    customBaseOsFamily: sel.customBaseOsFamily?.trim() ? sel.customBaseOsFamily : template.osFamily,
    customBaseOsVersion: sel.customBaseOsVersion?.trim() ? sel.customBaseOsVersion : template.osVersion,
    customBaseRosDistro: sel.customBaseRosDistro?.trim() ? sel.customBaseRosDistro : template.rosDistro,
    customBasePackaging: sel.customBasePackaging ?? template.packageManager,
  };
}

/**
 * Derive the compatibility verdict for a layer selection from the base OS capability
 * model above. The logic is three ordered concerns — (1) build-feasibility errors,
 * (2) independent advisories, (3) a mutually-exclusive image classification — so that
 * *every* selection resolves to a coherent, complete verdict.
 */
export function evaluateStack(sel: LayerSelection): CompatResult {
  const messages: CompatMessage[] = [];
  const resolvedSel = selectionForStackResolution(sel);
  let stack: ReturnType<typeof resolveStackConfig>;
  try {
    stack = resolveStackConfig(resolvedSel);
  } catch (error) {
    return {
      level: 'blocked',
      buildable: false,
      messages: [
        { level: 'error', text: error instanceof Error ? error.message : 'Unable to resolve the selected stack.' },
      ],
      failsAtStep: 'base-os',
    };
  }
  const cap = stack.capability;
  const baseLabel = labelForBaseOs(sel.baseOs, sel.customBaseImage);
  const wantsRos = sel.ros !== 'none';
  const wantsSim = sel.sim !== 'none';
  const selectedRosDistro = stack.rosDistro;
  const supportsSelectedRos =
    sel.ros === 'provided-by-parent' ||
    Boolean(selectedRosDistro && cap.supportedRosDistros.includes(selectedRosDistro));
  const supportsSelectedSim =
    sel.ros === 'provided-by-parent' ||
    Boolean(selectedRosDistro && cap.supportedSimDistros.includes(selectedRosDistro));

  let failsAtStep: string | undefined;

  if (sel.baseOs === 'custom' && !sel.customBaseImage?.trim()) {
    messages.push({ level: 'error', text: 'A custom base image reference is required before building.' });
    failsAtStep = 'base-os';
  }

  if (sel.sim === 'custom-template') {
    const template = resolveCustomSimulationTemplate(sel.customSimulationTemplateId ?? '');
    if (!template) {
      messages.push({ level: 'error', text: 'Select a registered simulation template.' });
      failsAtStep = 'simulation-template';
    } else if (sel.baseOs !== 'custom') {
      messages.push({
        level: 'error',
        text: 'Registered simulation templates currently require a custom parent image.',
      });
      failsAtStep = 'simulation-template';
    } else if (sel.ros !== 'provided-by-parent') {
      messages.push({
        level: 'error',
        text: 'Select “Provided by custom parent” for a template whose parent already contains ROS.',
      });
      failsAtStep = 'ros-layer';
    } else if (!customBaseMatchesTemplateMetadata(sel, template)) {
      messages.push({
        level: 'error',
        text: 'The custom parent OS and ROS metadata do not match the selected simulation template.',
      });
      failsAtStep = 'simulation-template';
    }
    if (sel.hardened !== 'none') {
      messages.push({
        level: 'error',
        text: 'Hardened layers are not yet supported with packages-only simulation templates.',
      });
      failsAtStep = 'simulation-template';
    }
  }

  // (1) Build-feasibility — a selected layer the base can't satisfy fails at build time.
  if (wantsRos && sel.ros !== 'provided-by-parent' && !supportsSelectedRos && sel.sim !== 'custom-template') {
    messages.push({
      level: 'error',
      text: cap.hasRosRepo
        ? `ROS layers install via apt on Ubuntu; base ${baseLabel} is ${cap.packaging}-based with no ROS Jazzy sim packages — the build fails at the ROS install step.`
        : `${baseLabel} has no official ROS repository at all — the build fails at the ROS install step.`,
    });
    failsAtStep = 'ros-install';
  }

  if (wantsSim && sel.sim !== 'custom-template' && !supportsSelectedSim) {
    messages.push({
      level: 'error',
      text: `Gazebo Harmonic / Nav2 / TurtleBot3 sim are not published for ${baseLabel} with the selected ROS distro — the build fails at the simulation install step.`,
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
      text: 'Hummingbird provides optional hardened application images (registry.access.redhat.com/hi/*) as a side component — it does not change the ROS/robotics build.',
    });
  }

  // (3) Image classification — only meaningful for a build that would succeed. ROS is what
  // makes the image a robotics image; without it, a buildable image is "just a base". This
  // branch is exhaustive over buildable selections, so no combination is left unclassified.
  if (!blocked) {
    if (sel.sim === 'custom-template') {
      messages.push({
        level: 'warn',
        text: 'Packages-only output; extension-managed noVNC, Navigate, diagnostics, and OpenShift deployment are unavailable. Manual BYO use remains supported.',
      });
    }
    if (!wantsRos) {
      messages.push({
        level: 'warn',
        text: `Builds ${cap.isBootc ? 'a bootc base image' : 'a base image'}, but it has no ROS layer — not a robotics image yet.`,
      });
    } else if (stack.managedSimEligible) {
      messages.push({
        level: 'info',
        text: 'Builds a managed simulation image — ROS/sim packages plus bundled entrypoints, noVNC, and worlds for OpenShift deploy.',
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

function customBaseMatchesTemplateMetadata(
  sel: LayerSelection,
  template: { osFamily: string; osVersion: string; rosDistro: string },
): boolean {
  // The registered template owns the required parent contract. Arbitrary parent
  // introspection is intentionally out of scope for this workflow.
  return Boolean(sel.customBaseImage?.trim()) && Boolean(template.osFamily && template.osVersion && template.rosDistro);
}

/** Full image reference this wizard would pull/FROM for a given base OS layer. */
export function baseOsImageRef(baseOs: BaseOsLayer, customBaseImage?: string): string {
  return baseOs === 'custom' ? (customBaseImage?.trim() ?? '') : BASE_OS_IMAGE_REF[baseOs];
}

export function labelFor<TId extends string>(options: readonly LayerOption<TId>[], id: TId): string {
  return options.find(o => o.id === id)?.label ?? id;
}

/**
 * Pure Containerfile generator for the layer-composition wizard. Produces a commented,
 * human-readable Containerfile reflecting the selected layers — a preview of what would be
 * built once secure bootc/Hummingbird layers are available. No I/O, no validation beyond
 * skipping layers set to 'none'.
 */
export function generateLayerContainerfile(sel: LayerSelection, targetArch: 'amd64' | 'arm64' = 'amd64'): string {
  if (sel.sim === 'custom-template' && sel.baseOs === 'custom') {
    const template = resolveCustomSimulationTemplate(sel.customSimulationTemplateId ?? '');
    if (template) return generateCustomSimulationContainerfile(sel.customBaseImage ?? '', template);
  }

  const resolvedSel = selectionForStackResolution(sel);
  const sections: string[] = [];
  const stack = resolveStackConfig(resolvedSel);

  sections.push(`# Layer 1 — Base OS: ${labelForBaseOs(sel.baseOs, sel.customBaseImage)}\nFROM ${stack.baseImageRef}`);

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
        // Tools are baked in with COPY --from (see hummingbirdToolBake for curl/jq libs).
        for (const app of tools) {
          lines.push(...hummingbirdToolBakeContainerfileLines(app, targetArch));
        }
      }
    } else {
      lines.push(
        '# (Hummingbird provides hardened app images from registry.access.redhat.com/hi/*; optional component)',
      );
    }
    sections.push(lines.join('\n'));
  }

  // Package manager matches the base's actual packaging (BASE_OS_CAPABILITY) so generated
  // dnf-based bootc builds use the base's native installer.
  const cap = stack.capability;
  const installCmd = stack.installCommand;
  const installCleanup = stack.installCleanup;

  sections.push(...stack.repositoryFragments);

  // The base OS images are bare (no ROS apt source configured), unlike the tested-preset
  // path which FROMs an already-ROS-baked image — without this, "apt-get install ros-*"
  // fails with "Unable to locate package" even on an otherwise-buildable Ubuntu base.
  if (sel.ros !== 'none' && sel.ros !== 'provided-by-parent') {
    const distro = stack.rosDistro!;
    const desktopPackages = stack.rosPackages.map(packageName => `ros-${distro}-${packageName}`);
    sections.push(
      `# Layer 3 — ROS: ${labelFor(ROS_OPTIONS, sel.ros)}\nRUN ${installCmd} ${desktopPackages.join(' ')}${installCleanup}`,
    );
  }

  if (sel.sim !== 'none') {
    const distro = stack.rosDistro ?? 'jazzy';
    const simulationPackages = stack.simulationPackages.map(packageName => `ros-${distro}-${packageName}`).join(' ');
    sections.push(
      `# Layer 4 — Simulation: ${labelFor(SIM_OPTIONS, sel.sim)}\n` +
        `RUN ${installCmd} ${simulationPackages}${installCleanup}`,
    );
  }

  let containerfile = sections.join('\n\n') + '\n';
  if (stack.managedSimEligible) {
    containerfile +=
      '\n' +
      generateSimOperationalLayerFragment(sel, cap.packaging, {
        install: stack.installCommand,
        cleanup: stack.installCleanup,
      });
  }
  return containerfile;
}
