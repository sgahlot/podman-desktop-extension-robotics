import type { LayerCacheStatusEntry } from './BuildHistory';
import type { HardenedApp, LayerSelection } from './layerCompatibility';
import {
  BASE_OS_OPTIONS,
  HUMMINGBIRD_APP_OPTIONS,
  HUMMINGBIRD_TOOL_OPTIONS,
  hummingbirdImageRef,
  labelFor,
  ROS_OPTIONS,
  SIM_OPTIONS,
} from './layerCompatibility';
import type { SimulationConfig } from './SimulationConfig';
import { resolveCustomSimulationTemplate } from './CustomSimulationTemplates';
import { resolveSimulationProfile } from './SimulationProfiles';
import {
  CUSTOM_SIMULATION_BASE_IMAGE,
  customBaseImageRef,
  resolveSimulationBaseImage,
  shortImageRef,
} from './SimulationBaseImages';

/** Wizard composition layers that map to Containerfile sections (APPENG-6298 / S10-4). */
export type CompositionLayerId = 'base-os' | 'hardened' | 'ros' | 'sim';

const LAYER_ORDER: readonly CompositionLayerId[] = ['base-os', 'hardened', 'ros', 'sim'];

const DEFAULT_LAYER_LABELS: Record<CompositionLayerId, string> = {
  'base-os': 'Base OS',
  hardened: 'Hardened',
  ros: 'ROS',
  sim: 'Simulation',
};

export type LayerCacheParseKind = 'composition' | 'preset-base' | 'preset-hardened' | 'preset-sim' | 'custom-sim';

/** Ordered layer labels shown in the cache summary / layer cake (from wizard or preset config). */
export interface LayerCachePlanEntry {
  layerId: CompositionLayerId;
  label: string;
  /** Layer came from the selected parent rather than a Containerfile build step. */
  reused?: boolean;
}

/** Optional context for preset image builds so cache UX matches the Layers wizard. */
export interface LayerCacheBuildOptions {
  layerPlan?: LayerCachePlanEntry[];
  /** Bake-in Hummingbird CLI tools for the hardened middle-layer image (step 2 of 3). */
  hummingbirdTools?: HardenedApp[];
  /** Parent image tag for a sim build (hardened image when step 2 ran; otherwise the base). */
  parentImageTag?: string;
}

/** True when the Containerfile was produced by the Layers wizard (`generateLayerContainerfile`). */
export function isLayerCompositionContainerfile(containerfile: string): boolean {
  return /^#\s*Layer\s+1\s+—/m.test(containerfile);
}

/** Layer labels for a Layers-wizard selection — same names in preset and containerfile builds. */
export function layerCachePlanFromSelection(sel: LayerSelection): LayerCachePlanEntry[] {
  const baseLabel =
    sel.baseOs === 'custom' && sel.customBaseImage?.trim()
      ? shortImageRef(sel.customBaseImage)
      : labelForBaseOsSelection(sel);
  const templateBuild = sel.sim === 'custom-template';
  const plan: LayerCachePlanEntry[] = [{ layerId: 'base-os', label: `Base OS · ${baseLabel}`, reused: templateBuild }];

  const bakeInTools =
    sel.hardened === 'hummingbird-app'
      ? (sel.hummingbirdApps ?? []).filter(a => HUMMINGBIRD_TOOL_OPTIONS.some(o => o.id === a))
      : [];
  if (bakeInTools.length > 0) {
    plan.push({ layerId: 'hardened', label: 'Hummingbird app' });
  }

  if (sel.ros !== 'none') {
    const rosLabel = labelFor(ROS_OPTIONS, sel.ros);
    plan.push({
      layerId: 'ros',
      label: rosLabel.replace(/^ROS2\b/, 'ROS'),
      reused: sel.ros === 'provided-by-parent',
    });
  }

  if (sel.sim !== 'none') {
    const template =
      sel.sim === 'custom-template' ? resolveCustomSimulationTemplate(sel.customSimulationTemplateId ?? '') : undefined;
    plan.push({ layerId: 'sim', label: template ? `Simulation · ${template.label}` : labelFor(SIM_OPTIONS, sel.sim) });
  }

  return plan;
}

function labelForBaseOsSelection(sel: LayerSelection): string {
  if (sel.baseOs === 'custom') return 'Custom image reference';
  return labelFor(BASE_OS_OPTIONS, sel.baseOs);
}

/** Layer labels shown on each preset build step (base / hardened / sim). */
export function layerCachePlanForPresetPhase(
  sel: LayerSelection,
  phase: 'base' | 'hardened' | 'sim',
): LayerCachePlanEntry[] {
  const full = layerCachePlanFromSelection(sel);
  if (phase === 'base') return full.filter(p => p.layerId === 'base-os' || p.layerId === 'ros');
  if (phase === 'hardened') return full.filter(p => p.layerId === 'base-os' || p.layerId === 'hardened');
  return full;
}

/** Layer labels for pipeline/guided preset builds (Image Builder outside Layers tab). */
export function layerCachePlanFromSimulationConfig(
  config: SimulationConfig,
  opts: { includeSim: boolean },
): LayerCachePlanEntry[] {
  const baseRef =
    config.baseImage === CUSTOM_SIMULATION_BASE_IMAGE
      ? customBaseImageRef(config.customBaseImage)
      : resolveSimulationBaseImage(config.baseImage).imageRef;
  const baseLabel = baseRef ? `Base OS · ${shortImageRef(baseRef)}` : 'Base OS';
  const plan: LayerCachePlanEntry[] = [{ layerId: 'base-os', label: baseLabel }];
  const profile = resolveSimulationProfile(config);
  if (!profile) return plan;

  const rosName = config.distro === 'humble' ? 'ROS Humble' : 'ROS Jazzy';
  plan.push({ layerId: 'ros', label: rosName });

  if (opts.includeSim && profile.assetDir) {
    plan.push({ layerId: 'sim', label: 'Gazebo + Nav2 + TurtleBot3' });
  }

  return plan;
}

/**
 * Containerfile for the preset hardened middle-layer image (step 2 of 3).
 * FROM the local base image; COPY --from each bake-in Hummingbird tool.
 */
export function generatePresetHardenedContainerfile(tools: HardenedApp[]): string {
  const optionById = new Map(HUMMINGBIRD_APP_OPTIONS.map(o => [o.id, o]));
  const lines = [
    '# Layer 2 — Hardened application layer: Hummingbird app (baked in)',
    'ARG LOCAL_BASE_IMAGE',
    'FROM ${LOCAL_BASE_IMAGE}',
  ];

  for (const tool of tools) {
    const opt = optionById.get(tool);
    if (opt?.kind !== 'tool') continue;
    const binPath = opt.binPath ?? `/usr/bin/${tool}`;
    lines.push(`COPY --from=${hummingbirdImageRef(tool)} ${binPath} /usr/local/bin/${tool}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Map each Podman build step (FROM / COPY / RUN in order) to a composition layer id.
 * Comments from `generateLayerContainerfile` drive the mapping; the ROS apt-repo setup
 * RUN is attributed to the ROS layer.
 */
export function parseBuildStepLayerIds(containerfile: string): CompositionLayerId[] {
  const stepLayers: CompositionLayerId[] = [];
  let currentLayer: CompositionLayerId = 'base-os';

  for (const rawLine of containerfile.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^#\s*Layer\s+1\s+—/i.test(line)) {
      currentLayer = 'base-os';
      continue;
    }
    if (/^#\s*Layer\s+2\s+—/i.test(line)) {
      currentLayer = 'hardened';
      continue;
    }
    if (/^#\s*Layer\s+3\s+—/i.test(line)) {
      currentLayer = 'ros';
      continue;
    }
    if (/^#\s*Layer\s+4\s+—/i.test(line)) {
      currentLayer = 'sim';
      continue;
    }
    if (/^#\s*ROS\s+2\s+apt\s+repository/i.test(line)) {
      currentLayer = 'ros';
      continue;
    }

    if (/^(FROM|COPY|RUN|LABEL)\s+/i.test(line)) {
      stepLayers.push(currentLayer);
    }
  }

  return stepLayers;
}

function parsePresetBaseStepLayerIds(containerfile: string): CompositionLayerId[] {
  const stepLayers: CompositionLayerId[] = [];

  for (const rawLine of containerfile.split('\n')) {
    const line = rawLine.trim();
    if (!line || /^ARG\s+/i.test(line)) continue;

    if (/^FROM\s+/i.test(line)) {
      stepLayers.push('base-os');
      continue;
    }
    if (/^COPY\s+--from=/i.test(line)) {
      stepLayers.push('hardened');
      continue;
    }
    if (/^(COPY|RUN|WORKDIR|ENTRYPOINT|CMD|ENV|EXPOSE|LABEL)\s+/i.test(line)) {
      stepLayers.push('ros');
    }
  }

  return stepLayers;
}

type PresetSimStepKind = 'lower-stack' | 'sim';
type PresetHardenedStepKind = 'lower-stack' | 'hardened';

function parsePresetSimStepKinds(containerfile: string): PresetSimStepKind[] {
  const kinds: PresetSimStepKind[] = [];

  for (const rawLine of containerfile.split('\n')) {
    const line = rawLine.trim();
    if (!line || /^ARG\s+/i.test(line)) continue;

    if (/^FROM\s+/i.test(line)) {
      kinds.push('lower-stack');
      continue;
    }
    if (/^(COPY|RUN|WORKDIR|ENTRYPOINT|CMD|ENV|EXPOSE|LABEL)\s+/i.test(line)) {
      kinds.push('sim');
    }
  }

  return kinds;
}

function parsePresetHardenedStepKinds(containerfile: string): PresetHardenedStepKind[] {
  const kinds: PresetHardenedStepKind[] = [];

  for (const rawLine of containerfile.split('\n')) {
    const line = rawLine.trim();
    if (!line || /^ARG\s+/i.test(line)) continue;

    if (/^FROM\s+/i.test(line)) {
      kinds.push('lower-stack');
      continue;
    }
    if (/^COPY\s+--from=/i.test(line)) {
      kinds.push('hardened');
    }
  }

  return kinds;
}

/** Human labels for each layer, parsed from `# Layer N — Kind: Name` comments when present. */
export function parseLayerLabelsFromContainerfile(containerfile: string): Map<CompositionLayerId, string> {
  const labels = new Map<CompositionLayerId, string>();

  for (const rawLine of containerfile.split('\n')) {
    const line = rawLine.trim();
    const match = line.match(/^#\s*Layer\s+(\d+)\s+—\s+([^:]+?)(?::\s*(.+))?$/i);
    if (!match) continue;

    const layerNum = parseInt(match[1], 10);
    const kind = match[2].trim();
    const name = match[3]?.trim();
    const layerId = layerNumToId(layerNum);
    if (!layerId) continue;

    if (layerId === 'base-os') {
      labels.set(layerId, name ? `Base OS · ${shortImageRef(name)}` : 'Base OS');
    } else if (layerId === 'hardened') {
      labels.set(layerId, name ?? 'Hardened');
    } else if (layerId === 'ros') {
      labels.set(layerId, name ? name.replace(/^ROS2?\s*/i, 'ROS ') : 'ROS');
    } else if (layerId === 'sim') {
      labels.set(layerId, name ?? 'Simulation');
    } else {
      labels.set(layerId, name ?? kind);
    }
  }

  return labels;
}

function layerNumToId(num: number): CompositionLayerId | undefined {
  if (num === 1) return 'base-os';
  if (num === 2) return 'hardened';
  if (num === 3) return 'ros';
  if (num === 4) return 'sim';
  return undefined;
}

function labelForLayer(layerId: CompositionLayerId, labels: Map<CompositionLayerId, string>): string {
  return labels.get(layerId) ?? DEFAULT_LAYER_LABELS[layerId];
}

type StepOutcome = 'pending' | 'cached' | 'rebuilt';

/**
 * Tracks Podman `buildImage` stream events and aggregates per-step cache outcomes into
 * per-composition-layer status for the Layers wizard (S10-4).
 */
export class BuildCacheStreamParser {
  private readonly kind: LayerCacheParseKind;
  private readonly plan: LayerCachePlanEntry[];
  private readonly stepLayerIds: CompositionLayerId[];
  private readonly presetSimStepKinds: PresetSimStepKind[];
  private readonly presetHardenedStepKinds: PresetHardenedStepKind[];
  private readonly layerLabels: Map<CompositionLayerId, string>;
  private readonly stepOutcomes: StepOutcome[] = [];
  private currentStepIndex = -1;

  constructor(containerfile: string, options?: { kind?: LayerCacheParseKind; plan?: LayerCachePlanEntry[] }) {
    this.kind = options?.kind ?? (isLayerCompositionContainerfile(containerfile) ? 'composition' : 'preset-base');
    this.plan = options?.plan ?? [];
    this.stepLayerIds =
      this.kind === 'composition' || this.kind === 'preset-base'
        ? this.kind === 'composition'
          ? parseBuildStepLayerIds(containerfile)
          : parsePresetBaseStepLayerIds(containerfile)
        : [];
    this.presetSimStepKinds = this.kind === 'preset-sim' ? parsePresetSimStepKinds(containerfile) : [];
    this.presetHardenedStepKinds = this.kind === 'preset-hardened' ? parsePresetHardenedStepKinds(containerfile) : [];
    this.layerLabels = parseLayerLabelsFromContainerfile(containerfile);
  }

  get hasLayerPlan(): boolean {
    if (this.kind === 'preset-sim') return this.presetSimStepKinds.length > 0 && this.plan.length > 0;
    if (this.kind === 'preset-hardened') {
      return this.presetHardenedStepKinds.length > 0 && this.plan.length > 0;
    }
    return this.stepLayerIds.length > 0;
  }

  processLine(line: string): void {
    const stepMatch = line.match(/^STEP\s+(\d+)\/(\d+)/i);
    if (stepMatch) {
      this.#finalizeCurrentStep();
      this.currentStepIndex = parseInt(stepMatch[1], 10) - 1;
      if (this.currentStepIndex >= 0 && this.currentStepIndex < this.stepOutcomes.length) {
        this.stepOutcomes[this.currentStepIndex] = 'pending';
      } else if (this.currentStepIndex >= this.stepOutcomes.length) {
        this.stepOutcomes.length = this.currentStepIndex + 1;
        this.stepOutcomes[this.currentStepIndex] = 'pending';
      }
      if (/using cache/i.test(line)) {
        this.stepOutcomes[this.currentStepIndex] = 'cached';
      }
      return;
    }

    if (this.currentStepIndex >= 0 && /using cache/i.test(line)) {
      this.stepOutcomes[this.currentStepIndex] = 'cached';
    }
  }

  finalize(): LayerCacheStatusEntry[] {
    this.#finalizeCurrentStep();
    if (this.kind === 'composition') {
      this.#inferBaseOsFromDownstreamCache();
    } else if (this.kind === 'preset-base') {
      this.#inferBaseOsFromDownstreamCache();
    } else if (this.kind === 'preset-sim') {
      this.#inferLowerStackFromDownstreamCache();
    } else if (this.kind === 'preset-hardened') {
      this.#inferHardenedLowerStackFromDownstreamCache();
    }

    if (this.kind === 'preset-sim') {
      return this.#aggregatePresetSimStatus();
    }
    if (this.kind === 'preset-hardened') {
      return this.#aggregatePresetHardenedStatus();
    }

    return this.#aggregateLayerStatus();
  }

  /**
   * Podman often skips a separate `Using cache` line for the initial `FROM` (step 1) even
   * when it is cached — the next STEP arrives immediately. When every later step was a
   * cache hit, the base image layer must be unchanged, so treat step 0 as cached too.
   */
  #inferBaseOsFromDownstreamCache(): void {
    if (this.stepOutcomes.length <= 1) return;
    if (this.stepLayerIds[0] !== 'base-os') return;
    if (this.stepOutcomes[0] !== 'rebuilt') return;
    const later = this.stepOutcomes.slice(1);
    if (later.length > 0 && later.every(o => o === 'cached')) {
      this.stepOutcomes[0] = 'cached';
    }
  }

  /** Preset sim builds FROM the local base — infer lower stack cached when all sim steps hit cache. */
  #inferLowerStackFromDownstreamCache(): void {
    if (this.presetSimStepKinds[0] !== 'lower-stack') return;
    if (this.stepOutcomes[0] !== 'rebuilt') return;
    const simOutcomes = this.presetSimStepKinds
      .map((kind, idx) => (kind === 'sim' ? this.stepOutcomes[idx] : undefined))
      .filter((o): o is StepOutcome => o !== undefined);
    if (simOutcomes.length > 0 && simOutcomes.every(o => o === 'cached')) {
      this.stepOutcomes[0] = 'cached';
    }
  }

  /** Preset hardened builds FROM the local base — infer base cached when all COPY steps hit cache. */
  #inferHardenedLowerStackFromDownstreamCache(): void {
    if (this.presetHardenedStepKinds[0] !== 'lower-stack') return;
    if (this.stepOutcomes[0] !== 'rebuilt') return;
    const hardenedOutcomes = this.presetHardenedStepKinds
      .map((kind, idx) => (kind === 'hardened' ? this.stepOutcomes[idx] : undefined))
      .filter((o): o is StepOutcome => o !== undefined);
    if (hardenedOutcomes.length > 0 && hardenedOutcomes.every(o => o === 'cached')) {
      this.stepOutcomes[0] = 'cached';
    }
  }

  #finalizeCurrentStep(): void {
    if (this.currentStepIndex < 0) return;
    if (this.stepOutcomes[this.currentStepIndex] === 'pending') {
      this.stepOutcomes[this.currentStepIndex] = 'rebuilt';
    }
  }

  #aggregatePresetSimStatus(): LayerCacheStatusEntry[] {
    const simStepIndices = this.presetSimStepKinds
      .map((kind, idx) => (kind === 'sim' ? idx : -1))
      .filter(idx => idx >= 0);
    const simOutcomes = simStepIndices.map(idx => this.stepOutcomes[idx] ?? 'rebuilt');
    const simCached = simOutcomes.length > 0 && simOutcomes.every(o => o === 'cached');

    const plan = this.plan.length > 0 ? this.plan : [{ layerId: 'sim' as CompositionLayerId, label: 'Simulation' }];
    const result: LayerCacheStatusEntry[] = [];

    for (const entry of plan) {
      if (entry.layerId === 'sim') {
        result.push({ layer: entry.label, cached: simCached });
      } else {
        // Base / hardened / ROS live in the parent image — this sim Dockerfile only FROMs it.
        result.push({ layer: entry.label, cached: true, reused: true });
      }
    }

    return result;
  }

  #aggregatePresetHardenedStatus(): LayerCacheStatusEntry[] {
    const hardenedStepIndices = this.presetHardenedStepKinds
      .map((kind, idx) => (kind === 'hardened' ? idx : -1))
      .filter(idx => idx >= 0);
    const hardenedOutcomes = hardenedStepIndices.map(idx => this.stepOutcomes[idx] ?? 'rebuilt');
    const hardenedCached = hardenedOutcomes.length > 0 && hardenedOutcomes.every(o => o === 'cached');

    const plan =
      this.plan.length > 0
        ? this.plan
        : [
            { layerId: 'base-os' as CompositionLayerId, label: 'Base OS' },
            { layerId: 'hardened' as CompositionLayerId, label: 'Hummingbird app' },
          ];
    const result: LayerCacheStatusEntry[] = [];

    for (const entry of plan) {
      if (entry.layerId === 'hardened') {
        result.push({ layer: entry.label, cached: hardenedCached });
      } else {
        result.push({ layer: entry.label, cached: true, reused: true });
      }
    }

    return result;
  }

  #aggregateLayerStatus(): LayerCacheStatusEntry[] {
    const result: LayerCacheStatusEntry[] = [];
    const planIds =
      this.plan.length > 0 ? this.plan.map(p => p.layerId) : LAYER_ORDER.filter(id => this.stepLayerIds.includes(id));

    for (const layerId of planIds) {
      const planEntry = this.plan.find(p => p.layerId === layerId);
      if (planEntry?.reused) {
        result.push({ layer: planEntry.label, cached: true, reused: true });
        continue;
      }
      const stepIndices = this.stepLayerIds.map((id, idx) => (id === layerId ? idx : -1)).filter(idx => idx >= 0);
      if (stepIndices.length === 0) continue;

      const outcomes = stepIndices.map(idx => this.stepOutcomes[idx] ?? 'rebuilt');
      const cached = outcomes.every(o => o === 'cached');

      result.push({
        layer: planEntry?.label ?? labelForLayer(layerId, this.layerLabels),
        cached,
      });
    }

    return result;
  }
}

/** Compact label for one layer in the cache summary / layer cake. */
export function layerCacheOutcomeLabel(entry: LayerCacheStatusEntry): string {
  if (entry.reused) return '✓ reused';
  return entry.cached ? '✓ cached' : '↻ rebuilt';
}

/** Compact flow summary for aria-labels and programmatic use. */
export function formatLayerCacheSummary(entries: LayerCacheStatusEntry[]): string {
  return entries.map(e => `${e.layer} ${layerCacheOutcomeLabel(e)}`).join(' → ');
}

/** True for Podman stream lines that indicate a cache hit (for log highlighting). */
export function isBuildCacheHitLogLine(line: string): boolean {
  return /using cache/i.test(line) && !line.includes(PROGRESS_LOG_TRUNCATION_MARKER);
}

/** Re-exported for isBuildCacheHitLogLine — mirrors backend progressLogs marker. */
export const PROGRESS_LOG_TRUNCATION_MARKER = '… earlier log lines truncated …';
