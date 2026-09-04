import type { LayerCacheStatusEntry } from './BuildHistory';
import type { HardenedApp, LayerSelection } from './layerCompatibility';
import {
  HUMMINGBIRD_APP_OPTIONS,
  HUMMINGBIRD_TOOL_OPTIONS,
  hummingbirdImageRef,
  labelFor,
  ROS_OPTIONS,
  SIM_OPTIONS,
} from './layerCompatibility';
import type { SimulationConfig } from './SimulationConfig';
import { resolveSimulationProfile } from './SimulationProfiles';

/** Wizard composition layers that map to Containerfile sections (APPENG-6298 / S10-4). */
export type CompositionLayerId = 'base-os' | 'hardened' | 'ros' | 'sim';

const LAYER_ORDER: readonly CompositionLayerId[] = ['base-os', 'hardened', 'ros', 'sim'];

const DEFAULT_LAYER_LABELS: Record<CompositionLayerId, string> = {
  'base-os': 'Base OS',
  hardened: 'Hardened',
  ros: 'ROS',
  sim: 'Simulation',
};

export type LayerCacheParseKind = 'composition' | 'preset-base' | 'preset-sim';

/** Ordered layer labels shown in the cache summary / layer cake (from wizard or preset config). */
export interface LayerCachePlanEntry {
  layerId: CompositionLayerId;
  label: string;
}

/** Optional context for preset base/sim builds so cache UX matches the Layers wizard. */
export interface LayerCacheBuildOptions {
  layerPlan?: LayerCachePlanEntry[];
  /** Hardened CLI tools baked into the preset base image via COPY --from. */
  hummingbirdTools?: HardenedApp[];
}

/** True when the Containerfile was produced by the Layers wizard (`generateLayerContainerfile`). */
export function isLayerCompositionContainerfile(containerfile: string): boolean {
  return /^#\s*Layer\s+1\s+—/m.test(containerfile);
}

/** Layer labels for a Layers-wizard selection — same names in preset and containerfile builds. */
export function layerCachePlanFromSelection(sel: LayerSelection): LayerCachePlanEntry[] {
  const plan: LayerCachePlanEntry[] = [{ layerId: 'base-os', label: 'Base OS' }];

  const bakeInTools =
    sel.hardened === 'hummingbird-app'
      ? (sel.hummingbirdApps ?? []).filter(a => HUMMINGBIRD_TOOL_OPTIONS.some(o => o.id === a))
      : [];
  if (bakeInTools.length > 0) {
    plan.push({ layerId: 'hardened', label: 'Hummingbird app' });
  }

  if (sel.ros !== 'none') {
    const rosLabel = labelFor(ROS_OPTIONS, sel.ros);
    plan.push({ layerId: 'ros', label: rosLabel.replace(/^ROS2\b/, 'ROS') });
  }

  if (sel.sim !== 'none') {
    plan.push({ layerId: 'sim', label: labelFor(SIM_OPTIONS, sel.sim) });
  }

  return plan;
}

/** Layer labels for pipeline/guided preset builds (Image Builder outside Layers tab). */
export function layerCachePlanFromSimulationConfig(
  config: SimulationConfig,
  opts: { includeSim: boolean },
): LayerCachePlanEntry[] {
  const plan: LayerCachePlanEntry[] = [{ layerId: 'base-os', label: 'Base OS' }];
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
 * Bake Hummingbird tool CLIs into a preset base Containerfile (after the first FROM).
 * Keeps the tested preset recipe while allowing optional hardened tools on the same path.
 */
export function injectHummingbirdToolsIntoPresetBase(containerfile: string, tools: HardenedApp[]): string {
  if (tools.length === 0) return containerfile;

  const optionById = new Map(HUMMINGBIRD_APP_OPTIONS.map(o => [o.id, o]));
  const copyLines: string[] = [];
  for (const tool of tools) {
    const opt = optionById.get(tool);
    if (!opt || opt.kind !== 'tool') continue;
    const binPath = opt.binPath ?? `/usr/bin/${tool}`;
    copyLines.push(`COPY --from=${hummingbirdImageRef(tool)} ${binPath} /usr/local/bin/${tool}`);
  }
  if (copyLines.length === 0) return containerfile;

  const lines = containerfile.split('\n');
  let insertAt = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^FROM\s+/i.test(lines[i].trim())) {
      insertAt = i + 1;
      break;
    }
  }
  if (insertAt < 0) return containerfile;

  lines.splice(
    insertAt,
    0,
    '',
    '# Layer 2 — Hardened application layer: Hummingbird app (baked in)',
    ...copyLines,
  );
  return lines.join('\n');
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

    if (/^(FROM|COPY|RUN)\s+/i.test(line)) {
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
      labels.set(layerId, 'Base OS');
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
  private readonly layerLabels: Map<CompositionLayerId, string>;
  private readonly stepOutcomes: StepOutcome[] = [];
  private currentStepIndex = -1;

  constructor(
    containerfile: string,
    options?: { kind?: LayerCacheParseKind; plan?: LayerCachePlanEntry[] },
  ) {
    this.kind =
      options?.kind ??
      (isLayerCompositionContainerfile(containerfile) ? 'composition' : 'preset-base');
    this.plan = options?.plan ?? [];
    this.stepLayerIds =
      this.kind === 'composition' || this.kind === 'preset-base'
        ? this.kind === 'composition'
          ? parseBuildStepLayerIds(containerfile)
          : parsePresetBaseStepLayerIds(containerfile)
        : [];
    this.presetSimStepKinds = this.kind === 'preset-sim' ? parsePresetSimStepKinds(containerfile) : [];
    this.layerLabels = parseLayerLabelsFromContainerfile(containerfile);
  }

  get hasLayerPlan(): boolean {
    if (this.kind === 'preset-sim') return this.presetSimStepKinds.length > 0 && this.plan.length > 0;
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
    }

    if (this.kind === 'preset-sim') {
      return this.#aggregatePresetSimStatus();
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

  #finalizeCurrentStep(): void {
    if (this.currentStepIndex < 0) return;
    if (this.stepOutcomes[this.currentStepIndex] === 'pending') {
      this.stepOutcomes[this.currentStepIndex] = 'rebuilt';
    }
  }

  #aggregatePresetSimStatus(): LayerCacheStatusEntry[] {
    const lowerStackCached = this.stepOutcomes[0] === 'cached';
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
        result.push({ layer: entry.label, cached: lowerStackCached });
      }
    }

    return result;
  }

  #aggregateLayerStatus(): LayerCacheStatusEntry[] {
    const result: LayerCacheStatusEntry[] = [];
    const planIds =
      this.plan.length > 0
        ? this.plan.map(p => p.layerId)
        : LAYER_ORDER.filter(id => this.stepLayerIds.includes(id));

    for (const layerId of planIds) {
      const planEntry = this.plan.find(p => p.layerId === layerId);
      const stepIndices = this.stepLayerIds
        .map((id, idx) => (id === layerId ? idx : -1))
        .filter(idx => idx >= 0);
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

/** Compact one-line summary for build history cards and post-build banners. */
export function formatLayerCacheSummary(entries: LayerCacheStatusEntry[]): string {
  return entries
    .map(e => `${e.layer} ${e.cached ? '✓ cached' : '↻ rebuilt'}`)
    .join(' · ');
}

/** True for Podman stream lines that indicate a cache hit (for log highlighting). */
export function isBuildCacheHitLogLine(line: string): boolean {
  return /using cache/i.test(line) && !line.includes(PROGRESS_LOG_TRUNCATION_MARKER);
}

/** Re-exported for isBuildCacheHitLogLine — mirrors backend progressLogs marker. */
export const PROGRESS_LOG_TRUNCATION_MARKER = '… earlier log lines truncated …';
