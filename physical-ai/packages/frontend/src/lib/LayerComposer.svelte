<script lang="ts">
import {
  BASE_OS_OPTIONS,
  HARDENED_OPTIONS,
  HUMMINGBIRD_COMPANION_OPTIONS,
  HUMMINGBIRD_TOOL_OPTIONS,
  ROS_OPTIONS,
  SIM_OPTIONS,
  baseOsImageRef,
  evaluateStack,
  generateLayerContainerfile,
  hummingbirdImageRef,
  type HardenedApp,
  type LayerSelection,
} from '/@shared/src/types/layerCompatibility';
import { baseImageTag, simulationImageTag } from '/@shared/src/types/SimulationProfiles';
import { defaultBaseImageForDistro } from '/@shared/src/types/SimulationBaseImages';
import type { SimulationConfig, TargetArch } from '/@shared/src/types/SimulationConfig';
import { physicalAiClient } from '../api/client';
import { onMount, onDestroy } from 'svelte';
import BuildPushPanel from './BuildPushPanel.svelte';

let selection: LayerSelection = {
  baseOs: 'ubuntu-noble',
  hardened: 'none',
  ros: 'ros2-jazzy',
  sim: 'gazebo-nav2-tb3',
  hummingbirdApps: [],
};

let attemptAnyway = false;

// Environment loaded once on mount.
let ns = '';
let hostArch: TargetArch = 'amd64';
let localImages: string[] = [];

$: result = evaluateStack(selection);
$: containerfile = generateLayerContainerfile(selection);
$: baseOsNote = BASE_OS_OPTIONS.find(o => o.id === selection.baseOs)?.note ?? '';
$: hardenedNote = HARDENED_OPTIONS.find(o => o.id === selection.hardened)?.note ?? '';
$: rosNote = ROS_OPTIONS.find(o => o.id === selection.ros)?.note ?? '';
$: simNote = SIM_OPTIONS.find(o => o.id === selection.sim)?.note ?? '';
$: baseOsLabel = BASE_OS_OPTIONS.find(o => o.id === selection.baseOs)?.label ?? selection.baseOs;
$: bannerClass =
  result.level === 'ok' ? 'pai-banner-success' : result.level === 'warn' ? 'pai-banner-warning' : 'pai-banner-error';
$: bannerHeadline =
  result.level === 'ok'
    ? '✅ Ready — builds and runs today'
    : result.level === 'warn'
      ? '⚠️ Builds, but not a working robotics image'
      : "❌ Won't build";
$: buildDisabled = result.level === 'blocked' && !attemptAnyway;

// Reset the escape hatch whenever the selection changes so a previously-blocked
// "attempt anyway" choice doesn't silently carry over to a new combination.
$: (selection, (attemptAnyway = false));

// Clear stale Hummingbird app picks when Hummingbird is turned off, without wiping them
// on unrelated selection changes (e.g. toggling ROS while Hummingbird stays selected).
$: if (selection.hardened !== 'hummingbird-app' && (selection.hummingbirdApps?.length ?? 0) > 0) {
  selection.hummingbirdApps = [];
}

// --- Build mode -----------------------------------------------------------------
// Mode A ("preset"): an Ubuntu + ROS [+ Sim] stack maps to a tested preset, so we build
// the real, runnable image with the bundled asset recipe (entrypoints, worlds, noVNC)
// via buildBaseImage/buildSimulationImage. Selecting a bake-in tool forces the generated
// Containerfile path so the COPY --from actually lands in the image.
// Mode B ("containerfile"): everything else (bootc bases, attempt-anyway, tool bake-in)
// builds from the generated Containerfile — it either succeeds as a plain image or fails
// for real, exactly as the compatibility verdict predicts.
$: isPresetStack =
  selection.baseOs === 'ubuntu-noble' &&
  (selection.ros === 'ros2-jazzy' || selection.ros === 'ros2-humble') &&
  (selection.sim === 'none' || selection.sim === 'gazebo-nav2-tb3');
$: hasBakeInTools = (selection.hummingbirdApps ?? []).some(a => HUMMINGBIRD_TOOL_OPTIONS.some(o => o.id === a));
$: buildMode = isPresetStack && !hasBakeInTools ? 'preset' : 'containerfile';

$: presetDistro = selection.ros === 'ros2-humble' ? 'humble' : 'jazzy';
$: presetConfig = {
  robot: 'turtlebot3',
  distro: presetDistro,
  middleware: 'dds',
  engine: 'gazebo',
  baseImage: defaultBaseImageForDistro(presetDistro),
  targetArch: hostArch,
} as SimulationConfig;
$: presetBaseTag = ns ? (baseImageTag(ns, presetConfig) ?? '') : '';
$: presetSimTag = ns ? (simulationImageTag(ns, presetConfig) ?? '') : '';
$: wantsSim = selection.sim !== 'none';
$: baseImageExists = !!presetBaseTag && localImages.includes(presetBaseTag);
$: containerfileTag = `${ns ? `quay.io/${ns}/` : ''}pai-layer-${selection.baseOs}:latest`;

// --- Images this stack pulls -----------------------------------------------------
$: selectedHbApps = selection.hardened === 'hummingbird-app' ? (selection.hummingbirdApps ?? []) : [];
$: pullTargets = [
  { ref: baseOsImageRef(selection.baseOs), label: `Base OS — ${baseOsLabel}` },
  ...selectedHbApps.map((a: HardenedApp) => ({ ref: hummingbirdImageRef(a), label: `Hummingbird — ${a}` })),
];

// --- Pull state (per image ref) --------------------------------------------------
let pulling: Record<string, boolean> = {};
let pullStatus: Record<string, string> = {};
const pollTimers: Record<string, number> = {};

async function refreshLocalImages() {
  try {
    localImages = await physicalAiClient.listLocalImages();
  } catch {
    localImages = [];
  }
}

async function pull(ref: string) {
  if (pulling[ref]) return;
  pulling = { ...pulling, [ref]: true };
  pullStatus = { ...pullStatus, [ref]: 'Starting…' };
  try {
    await physicalAiClient.pullImageByRef(ref);
    pollPull(ref);
  } catch (e) {
    pullStatus = { ...pullStatus, [ref]: e instanceof Error ? e.message : 'Pull failed to start' };
    pulling = { ...pulling, [ref]: false };
  }
}

function pollPull(ref: string) {
  stopPoll(ref);
  pollTimers[ref] = window.setInterval(async () => {
    try {
      const p = await physicalAiClient.getPullProgress(ref);
      if (!p) return;
      pullStatus = {
        ...pullStatus,
        [ref]: p.currentMB && p.totalMB ? `${p.status} — ${p.currentMB}/${p.totalMB} MB` : p.status,
      };
      if (p.done) {
        stopPoll(ref);
        pulling = { ...pulling, [ref]: false };
        pullStatus = { ...pullStatus, [ref]: p.error ? `Failed: ${p.error}` : 'Pulled' };
        await refreshLocalImages();
      }
    } catch {
      // ignore transient polling errors
    }
  }, 500);
}

function stopPoll(ref: string) {
  if (pollTimers[ref]) {
    window.clearInterval(pollTimers[ref]);
    delete pollTimers[ref];
  }
}

onMount(async () => {
  try {
    ns = await physicalAiClient.getDefaultNamespace();
  } catch {
    // leave ns empty — the build tag falls back to an unqualified name
  }
  try {
    const arch = await physicalAiClient.getHostArch();
    hostArch = arch === 'arm64' ? 'arm64' : 'amd64';
  } catch {
    // keep the amd64 default
  }
  await refreshLocalImages();
});

onDestroy(() => {
  for (const ref of Object.keys(pollTimers)) stopPoll(ref);
});
</script>

<div class="flex flex-col gap-4 max-w-2xl">
  <p class="text-xs pai-text-muted">
    Experimental — compose an image from a base OS, hardened, ROS, and simulation layers. Pick any combination; the
    compatibility check tells you whether it will build, then pull the layers and build for real below.
  </p>
  <p class="text-xs pai-text-muted">
    This is a representative catalog: bootc bases come from the <span class="font-mono">redhat.bootc</span> extension
    and hardened apps from the <span class="font-mono">redhat.hummingbird</span> extension. Pull them below to make each layer
    available locally — a ✓ badge shows which images you already have.
  </p>

  <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <label for="layer-base-os" class="text-xs text-[var(--pd-content-text)]">Base OS</label>
        <select
          id="layer-base-os"
          bind:value={selection.baseOs}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]">
          {#each BASE_OS_OPTIONS as o}
            <option value={o.id}>{o.label}</option>
          {/each}
        </select>
        <span class="text-xs pai-text-muted">{baseOsNote}</span>
      </div>

      <div class="flex flex-col gap-1">
        <label for="layer-hardened" class="text-xs text-[var(--pd-content-text)]">Hardened app</label>
        <select
          id="layer-hardened"
          bind:value={selection.hardened}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]">
          {#each HARDENED_OPTIONS as o}
            <option value={o.id}>{o.label}</option>
          {/each}
        </select>
        <span class="text-xs pai-text-muted">{hardenedNote}</span>

        {#if selection.hardened === 'hummingbird-app'}
          <div class="flex flex-col gap-3 mt-1 pl-3 border-l border-[var(--pd-content-card-border)]">
            <div class="flex flex-col gap-1">
              <span class="text-xs text-[var(--pd-content-text)]">Companion images — pulled &amp; run alongside</span>
              {#each HUMMINGBIRD_COMPANION_OPTIONS as o}
                <label class="flex flex-row items-center gap-2 text-xs text-[var(--pd-content-text)]">
                  <input type="checkbox" bind:group={selection.hummingbirdApps} value={o.id} />
                  {o.label}
                  <span class="pai-text-muted">— {o.note}</span>
                </label>
              {/each}
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-xs text-[var(--pd-content-text)]">Tools to bake in — hardened CLI via COPY --from</span>
              {#each HUMMINGBIRD_TOOL_OPTIONS as o}
                <label class="flex flex-row items-center gap-2 text-xs text-[var(--pd-content-text)]">
                  <input type="checkbox" bind:group={selection.hummingbirdApps} value={o.id} />
                  {o.label}
                  <span class="pai-text-muted">— {o.note}</span>
                </label>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <div class="flex flex-col gap-1">
        <label for="layer-ros" class="text-xs text-[var(--pd-content-text)]">ROS</label>
        <select
          id="layer-ros"
          bind:value={selection.ros}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]">
          {#each ROS_OPTIONS as o}
            <option value={o.id}>{o.label}</option>
          {/each}
        </select>
        <span class="text-xs pai-text-muted">{rosNote}</span>
      </div>

      <div class="flex flex-col gap-1">
        <label for="layer-sim" class="text-xs text-[var(--pd-content-text)]">Simulation</label>
        <select
          id="layer-sim"
          bind:value={selection.sim}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]">
          {#each SIM_OPTIONS as o}
            <option value={o.id}>{o.label}</option>
          {/each}
        </select>
        <span class="text-xs pai-text-muted">{simNote}</span>
      </div>
    </div>
  </div>

  <div class="text-sm p-3 rounded {bannerClass}" role="status">
    <p class="font-medium">{bannerHeadline}</p>
    {#if result.messages.length > 0}
      <ul class="list-disc list-inside mt-1">
        {#each result.messages as message}
          <li>{message.text}</li>
        {/each}
      </ul>
    {/if}
    {#if result.level === 'blocked' && result.failsAtStep}
      <p class="text-xs mt-1">Fails at build step: {result.failsAtStep}</p>
    {/if}
  </div>

  <!-- Pull the layer images locally -->
  <div class="flex flex-col gap-2">
    <h3 class="text-sm font-medium text-[var(--pd-content-header)]">Layer images</h3>
    <p class="text-xs pai-text-muted">Pull the images this stack uses so they're available locally.</p>
    <div class="flex flex-col gap-2">
      {#each pullTargets as t (t.ref)}
        <div
          class="flex flex-row items-center gap-3 rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] px-3 py-2">
          <div class="flex flex-col gap-0.5 min-w-0 flex-1">
            <span class="text-xs text-[var(--pd-content-text)]">{t.label}</span>
            <span class="text-xs font-mono pai-text-muted truncate">{t.ref}</span>
            {#if pullStatus[t.ref] && !localImages.includes(t.ref)}
              <span class="text-xs pai-text-accent">{pullStatus[t.ref]}</span>
            {/if}
          </div>
          {#if localImages.includes(t.ref)}
            <span class="text-xs pai-text-success whitespace-nowrap">&#10003; Local</span>
          {:else}
            <button
              type="button"
              class="pai-btn pai-btn-sm pai-btn-primary"
              disabled={pulling[t.ref]}
              on:click={() => pull(t.ref)}>
              {pulling[t.ref] ? 'Pulling…' : 'Pull'}
            </button>
          {/if}
        </div>
      {/each}
    </div>
  </div>

  <div class="flex flex-col gap-1">
    <h3 class="text-sm font-medium text-[var(--pd-content-header)]">Generated Containerfile (preview)</h3>
    <pre
      class="text-xs font-mono p-3 rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] overflow-auto max-h-64">{containerfile}</pre>
  </div>

  <!-- Build -->
  <div class="flex flex-col gap-3">
    <h3 class="text-sm font-medium text-[var(--pd-content-header)]">Build image</h3>

    {#if buildMode === 'preset'}
      <div class="text-sm p-3 rounded pai-banner-info">
        This maps to the tested <span class="font-medium"
          >Ubuntu + ROS 2 {presetDistro} {wantsSim ? '+ Gazebo simulation' : ''}</span>
        preset — building it uses the full tested recipe (entrypoints, worlds{wantsSim ? ', noVNC' : ''}), not the naive
        Containerfile above.
      </div>

      <div class="flex flex-col gap-1">
        <span class="text-xs font-medium text-[var(--pd-content-text)]">1. Base image</span>
        <BuildPushPanel
          tagInputId="layer-base-tag"
          tag={presetBaseTag}
          tagPlaceholder="e.g. quay.io/org/ros2-base:latest"
          buildImage={t => physicalAiClient.buildBaseImage(t, presetConfig)}
          onBuildComplete={() => {
            void refreshLocalImages();
          }} />
      </div>

      {#if wantsSim}
        <div class="flex flex-col gap-1">
          <span class="text-xs font-medium text-[var(--pd-content-text)]">2. Simulation image</span>
          {#if !baseImageExists}
            <span class="text-xs pai-text-muted">Build the base image first.</span>
          {/if}
          <BuildPushPanel
            tagInputId="layer-sim-tag"
            tag={presetSimTag}
            tagPlaceholder="e.g. quay.io/org/ros2-sim:latest"
            buildImage={t => physicalAiClient.buildSimulationImage(t, presetConfig)}
            onBuildComplete={() => {
              void refreshLocalImages();
            }}
            disabled={!baseImageExists} />
        </div>
      {/if}
    {:else}
      {#if result.level === 'blocked'}
        <label class="flex flex-row items-center gap-2 text-xs text-[var(--pd-content-text)]">
          <input type="checkbox" bind:checked={attemptAnyway} />
          Attempt anyway — I understand this is expected to fail at the {result.failsAtStep} step
        </label>
      {/if}
      <p class="text-xs pai-text-muted">
        Builds directly from the generated Containerfile above. It will either produce a plain image or fail for real at
        the step the verdict predicts.
      </p>
      <BuildPushPanel
        tagInputId="layer-build-tag"
        tag={containerfileTag}
        tagPlaceholder="e.g. quay.io/org/custom-layer:latest"
        buildImage={t => physicalAiClient.buildFromContainerfile(t, containerfile)}
        onBuildComplete={() => {
          void refreshLocalImages();
        }}
        disabled={buildDisabled} />
    {/if}
  </div>
</div>
