import type { LayerCacheStatusEntry } from './BuildHistory';

/** Wizard composition layers that map to Containerfile sections (APPENG-6298 / S10-4). */
export type CompositionLayerId = 'base-os' | 'hardened' | 'ros' | 'sim';

const LAYER_ORDER: readonly CompositionLayerId[] = ['base-os', 'hardened', 'ros', 'sim'];

const DEFAULT_LAYER_LABELS: Record<CompositionLayerId, string> = {
  'base-os': 'Base OS',
  hardened: 'Hardened',
  ros: 'ROS',
  sim: 'Simulation',
};

/** True when the Containerfile was produced by the Layers wizard (`generateLayerContainerfile`). */
export function isLayerCompositionContainerfile(containerfile: string): boolean {
  return /^#\s*Layer\s+1\s+—/m.test(containerfile);
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
  private readonly stepLayerIds: CompositionLayerId[];
  private readonly layerLabels: Map<CompositionLayerId, string>;
  private readonly stepOutcomes: StepOutcome[] = [];
  private currentStepIndex = -1;

  constructor(containerfile: string) {
    this.stepLayerIds = parseBuildStepLayerIds(containerfile);
    this.layerLabels = parseLayerLabelsFromContainerfile(containerfile);
  }

  get hasLayerPlan(): boolean {
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
      // Podman sometimes folds the cache hint onto the STEP line itself.
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
    this.#inferBaseOsFromDownstreamCache();
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

  #finalizeCurrentStep(): void {
    if (this.currentStepIndex < 0) return;
    if (this.stepOutcomes[this.currentStepIndex] === 'pending') {
      this.stepOutcomes[this.currentStepIndex] = 'rebuilt';
    }
  }

  #aggregateLayerStatus(): LayerCacheStatusEntry[] {
    const result: LayerCacheStatusEntry[] = [];

    for (const layerId of LAYER_ORDER) {
      const stepIndices = this.stepLayerIds
        .map((id, idx) => (id === layerId ? idx : -1))
        .filter(idx => idx >= 0);
      if (stepIndices.length === 0) continue;

      const outcomes = stepIndices.map(idx => this.stepOutcomes[idx] ?? 'rebuilt');
      const cached = outcomes.every(o => o === 'cached');

      result.push({
        layer: labelForLayer(layerId, this.layerLabels),
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
