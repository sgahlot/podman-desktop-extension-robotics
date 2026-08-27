<script lang="ts">
import { physicalAiClient } from './api/client';
import { onMount, tick } from 'svelte';
import { router } from 'tinro';
import BuildPushPanel from './lib/BuildPushPanel.svelte';
import BuildHistoryPanel from './lib/BuildHistoryPanel.svelte';
import LayerComposer from './lib/LayerComposer.svelte';
import QuickLinks from './lib/QuickLinks.svelte';
import { navigationLayout } from './lib/navigationLayout';
import {
  resolveSimulationProfile,
  hasSimulationSupport,
  simulationImageTag,
  baseImageTag,
} from '/@shared/src/types/SimulationProfiles';
import {
  resolveSimulationBaseImage,
  DEFAULT_SIMULATION_BASE_IMAGE,
  baseImagesForDistro,
  defaultBaseImageForDistro,
} from '/@shared/src/types/SimulationBaseImages';
import type { SimulationBaseImageId } from '/@shared/src/types/SimulationBaseImages';
import type { SimulationConfig, TargetArch } from '/@shared/src/types/SimulationConfig';

let robot = 'turtlebot3';
let distro = 'humble';
let middleware = 'dds';
let engine = 'gazebo';
let baseImage: SimulationBaseImageId = DEFAULT_SIMULATION_BASE_IMAGE;
// Single source of truth for the build target architecture — owned by the
// Target toggle. The Customize form no longer has its own targetArch control.
let targetArch: TargetArch = 'amd64';

let loading = true;
let saving = false;
let saveSuccess = false;
let saveError = '';

let ns = 'ecosystem-appeng';
let hostArch: TargetArch = 'amd64';
let baseTag = '';
let simTag = '';
let lastConfigKey = '';
let baseBusy = false;
let simBusy = false;
let baseImageExists = false;
let simImageExists = false;
/** Guards the async existence check against stale responses. */
let existsCheckKey = '';

let optionsExpanded = false;

// Single source of truth for the Quick Start preset — used both to apply it
// and to detect whether the current config already matches it (targetArch is
// intentionally excluded; Quick Start never touches it).
const QUICK_START_PRESET = {
  robot: 'turtlebot3',
  distro: 'jazzy',
  middleware: 'dds',
  engine: 'gazebo',
  baseImage: 'jazzy-noble' as SimulationBaseImageId,
};
const QUICK_START_SUMMARY = 'TurtleBot3 · Jazzy · DDS · gazebo · Ubuntu Noble';

let showQuickStartConfirm = false;

let layout: 'pipeline' | 'guided' | 'layers' = 'guided';
let buildChoice: 'base' | 'sim' | 'both' | undefined = undefined;
let buildHistoryPanel: BuildHistoryPanel;

$: buildBusy = baseBusy || simBusy;
$: currentConfig = { robot, distro, middleware, engine, baseImage, targetArch } as SimulationConfig;
$: crossArch = targetArch !== hostArch;
$: otherArch = (hostArch === 'amd64' ? 'arm64' : 'amd64') as TargetArch;
$: otherArchLabel = otherArch === 'amd64' ? 'amd64 (for OpenShift)' : `${otherArch} (cross-build)`;
$: quickStartMatchesCurrent =
  robot === QUICK_START_PRESET.robot &&
  distro === QUICK_START_PRESET.distro &&
  middleware === QUICK_START_PRESET.middleware &&
  engine === QUICK_START_PRESET.engine &&
  baseImage === QUICK_START_PRESET.baseImage;
$: profile = resolveSimulationProfile(currentConfig);
$: simSupported = profile ? hasSimulationSupport(profile) : false;
$: availableBaseImages = baseImagesForDistro(distro);
$: basePreset = resolveSimulationBaseImage(baseImage);
$: {
  const validForDistro = availableBaseImages.find(p => p.id === baseImage);
  if (!validForDistro && !buildBusy) {
    baseImage = defaultBaseImageForDistro(distro);
  }
}
$: {
  const key = `${ns}|${robot}|${distro}|${middleware}|${engine}|${baseImage}|${targetArch}`;
  if (!buildBusy && key !== lastConfigKey) {
    lastConfigKey = key;
    baseTag = baseImageTag(ns, currentConfig) ?? '';
    simTag = simulationImageTag(ns, currentConfig) ?? '';
  }
}
// Reactive existence check for BOTH images — re-runs whenever the resolved
// tags change (arch toggle, config change, namespace load) and not while a
// build is in progress. This is what lets Step 2 unlock without re-running
// Quick Start / Step 1 in this session.
$: {
  const key = `${baseTag}|${simTag}`;
  if (!buildBusy && key !== existsCheckKey) {
    existsCheckKey = key;
    refreshImageExistence(key);
  }
}
// Panel visibility — pipeline layout always shows both steps; guided layout is
// driven by the "what do you want to build?" chooser. When guided + buildChoice
// is 'sim' but the base image isn't built yet, Step 1 also appears as a
// prerequisite (Step 2's own Build stays disabled via the existing gating).
$: showStep1 =
  layout === 'pipeline' ||
  buildChoice === 'base' ||
  buildChoice === 'both' ||
  (buildChoice === 'sim' && !baseImageExists);
$: showStep2 = layout === 'pipeline' || buildChoice === 'sim' || buildChoice === 'both';

async function refreshImageExistence(key: string) {
  try {
    const local = await physicalAiClient.listLocalImages();
    if (key !== existsCheckKey) return; // stale response — a newer check superseded this one
    baseImageExists = !!baseTag && local.includes(baseTag);
    simImageExists = !!simTag && local.includes(simTag);
  } catch {
    if (key !== existsCheckKey) return;
    baseImageExists = false;
    simImageExists = false;
  }
}

onMount(async () => {
  try {
    ns = await physicalAiClient.getDefaultNamespace();
  } catch {
    // default is fine
  }
  try {
    const arch = await physicalAiClient.getHostArch();
    hostArch = arch === 'arm64' ? 'arm64' : 'amd64';
    targetArch = hostArch;
  } catch {
    // default is fine
  }
  try {
    const config = await physicalAiClient.getSimulationConfig();
    robot = config.robot;
    distro = config.distro;
    middleware = config.middleware;
    engine = config.engine;
    baseImage = config.baseImage ?? DEFAULT_SIMULATION_BASE_IMAGE;
    if (config.targetArch) targetArch = config.targetArch;
  } catch {
    // defaults are fine
  }
  try {
    layout = await physicalAiClient.getImageBuilderLayout();
  } catch {
    // default 'guided' is fine
  } finally {
    loading = false;
  }
});

function setLayout(next: 'pipeline' | 'guided' | 'layers') {
  layout = next;
  void physicalAiClient.setImageBuilderLayout(next);
}

async function save() {
  saving = true;
  saveSuccess = false;
  saveError = '';

  try {
    await physicalAiClient.saveSimulationConfig(currentConfig);
    saveSuccess = true;
    setTimeout(() => {
      saveSuccess = false;
    }, 3000);
  } catch (e) {
    saveError = e instanceof Error ? e.message : 'Failed to save';
  } finally {
    saving = false;
  }
}

async function applyQuickStart() {
  robot = QUICK_START_PRESET.robot;
  distro = QUICK_START_PRESET.distro;
  middleware = QUICK_START_PRESET.middleware;
  engine = QUICK_START_PRESET.engine;
  baseImage = QUICK_START_PRESET.baseImage;
  showQuickStartConfirm = false;
  // Target arch comes from the Target toggle, not from Quick Start.
  // Let reactive tags update before save
  await tick();
  await save();
  document.getElementById('step1-build')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function onQuickStartClick() {
  if (quickStartMatchesCurrent) {
    // Nothing would change — apply immediately, no confirmation needed.
    void applyQuickStart();
  } else {
    showQuickStartConfirm = true;
  }
}

function cancelQuickStart() {
  showQuickStartConfirm = false;
}
</script>

<div class="flex flex-col p-4 gap-4 h-full overflow-auto">
  {#if $navigationLayout === 'cards'}
    <button on:click={() => router.goto('/')} class="pai-link self-start"> &larr; Back to Dashboard </button>
  {/if}
  <h1 class="text-3xl text-[var(--pd-content-header)]">Image Builder</h1>
  {#if $navigationLayout === 'cards'}
    <QuickLinks
      links={[
        { label: 'Image Catalog', to: '/images' },
        { label: 'Simulation', to: '/simulation' },
      ]} />
  {/if}
  <p class="text-sm text-[var(--pd-content-text)]">
    Configure, build, and push ROS2 base and simulation container images.
  </p>

  {#if loading}
    <div class="text-sm text-[var(--pd-content-text)]">Loading configuration...</div>
  {:else}
    <!-- Image Builder layout switcher — guided (default) vs. pipeline chooser -->
    <div class="flex flex-row items-center gap-2 max-w-md">
      <span class="text-xs text-[var(--pd-content-text)]">Layout:</span>
      <div class="flex flex-row gap-2" role="radiogroup" aria-label="Image Builder layout">
        <button
          type="button"
          role="radio"
          aria-checked={layout === 'pipeline'}
          on:click={() => setLayout('pipeline')}
          disabled={buildBusy}
          class="px-3 py-1.5 text-sm rounded border cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed {layout ===
          'pipeline'
            ? 'border-[var(--pd-content-header)] bg-[var(--pd-content-bg)] font-medium text-[var(--pd-content-header)]'
            : 'border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]'}">
          Pipeline
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={layout === 'guided'}
          on:click={() => setLayout('guided')}
          disabled={buildBusy}
          class="px-3 py-1.5 text-sm rounded border cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed {layout ===
          'guided'
            ? 'border-[var(--pd-content-header)] bg-[var(--pd-content-bg)] font-medium text-[var(--pd-content-header)]'
            : 'border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]'}">
          Guided
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={layout === 'layers'}
          on:click={() => setLayout('layers')}
          disabled={buildBusy}
          class="px-3 py-1.5 text-sm rounded border cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed {layout ===
          'layers'
            ? 'border-[var(--pd-content-header)] bg-[var(--pd-content-bg)] font-medium text-[var(--pd-content-header)]'
            : 'border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]'}">
          Layers
        </button>
      </div>
    </div>

    <!-- Target arch toggle — first-class, single source of truth for targetArch -->
    <div
      class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 max-w-md flex flex-col gap-2">
      <span class="text-sm font-medium text-[var(--pd-content-header)]">Target</span>
      <div class="flex flex-row gap-2" role="radiogroup" aria-label="Target architecture">
        <button
          type="button"
          role="radio"
          aria-checked={targetArch === hostArch}
          on:click={() => (targetArch = hostArch)}
          disabled={buildBusy}
          class="flex-1 px-3 py-2 text-sm rounded border cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed {targetArch ===
          hostArch
            ? 'border-[var(--pd-content-header)] bg-[var(--pd-content-bg)] font-medium text-[var(--pd-content-header)]'
            : 'border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]'}">
          This machine ({hostArch})
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={targetArch === otherArch}
          on:click={() => (targetArch = otherArch)}
          disabled={buildBusy}
          class="flex-1 px-3 py-2 text-sm rounded border cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed {targetArch ===
          otherArch
            ? 'border-[var(--pd-content-header)] bg-[var(--pd-content-bg)] font-medium text-[var(--pd-content-header)]'
            : 'border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]'}">
          {otherArchLabel}
        </button>
      </div>
      <span class="text-xs text-[var(--pd-content-text)] opacity-80">
        Host is {hostArch}. Deploying to OpenShift needs an <span class="font-mono">amd64</span> image.
      </span>
      {#if crossArch && targetArch === 'amd64'}
        <span class="text-xs pai-text-muted">
          &#8505; Building an <span class="font-mono">amd64</span> image for OpenShift on a {hostArch} host uses QEMU emulation
          — this is expected and the build will be slower. Images are tagged
          <span class="font-mono">-amd64</span>.
        </span>
      {:else if crossArch}
        <span class="text-xs pai-text-warning">
          &#9888; Cross-building {targetArch} on a {hostArch} host uses QEMU emulation — expect a significantly slower build.
          Images are tagged <span class="font-mono">-{targetArch}</span>.
        </span>
      {/if}
    </div>

    <!-- Single Quick Start preset -->
    <div
      class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 max-w-md flex flex-col gap-2">
      <h2 class="text-sm font-medium text-[var(--pd-content-header)]">Quick Start</h2>
      <p class="text-xs text-[var(--pd-content-text)]">
        TurtleBot3 + Jazzy — the recommended configuration for the simulation demo. Use the Target toggle above to
        choose this machine or amd64 (for OpenShift).
      </p>
      <span class="text-xs pai-text-muted">
        Applies the recommended configuration. If you've changed anything in Customize, Quick Start will overwrite it.
      </span>
      <button
        on:click={onQuickStartClick}
        disabled={buildBusy || saving}
        class="self-start px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-[var(--pd-content-text)] cursor-pointer hover:border-[var(--pd-content-header)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
        TurtleBot3 Sim (Jazzy)
      </button>
      {#if showQuickStartConfirm}
        <div class="flex flex-col gap-2 mt-1 p-2 rounded border border-[var(--pd-content-card-border)]">
          <span class="text-xs pai-text-warning">
            This will change your configuration to: {QUICK_START_SUMMARY}.
          </span>
          <div class="flex flex-row gap-2">
            <button on:click={applyQuickStart} disabled={buildBusy || saving} class="pai-btn pai-btn-primary">
              Apply Quick Start
            </button>
            <button on:click={cancelQuickStart} disabled={buildBusy || saving} class="pai-btn"> Cancel </button>
          </div>
        </div>
      {/if}
    </div>

    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] max-w-md">
      <button
        on:click={() => (optionsExpanded = !optionsExpanded)}
        class="w-full text-left p-3 flex flex-row items-center gap-3 hover:bg-[var(--pd-content-bg)] rounded-lg cursor-pointer">
        <span class="text-xs text-[var(--pd-content-text)]">{optionsExpanded ? '▼' : '▶'}</span>
        <span class="text-sm font-medium text-[var(--pd-content-header)]">Customize</span>
      </button>
      {#if optionsExpanded}
        <div class="flex flex-col gap-4 p-4 pt-0">
          <div class="flex flex-col gap-1">
            <label for="robot" class="text-xs text-[var(--pd-content-text)]">Robot type</label>
            <select
              id="robot"
              bind:value={robot}
              disabled={buildBusy || !simSupported}
              class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]">
              <option value="turtlebot3">TurtleBot3</option>
            </select>
            {#if !simSupported}
              <span class="text-xs pai-text-muted">Not applicable — simulation not available for {distro}</span>
            {/if}
          </div>

          <div class="flex flex-col gap-1">
            <label for="distro" class="text-xs text-[var(--pd-content-text)]">ROS distro</label>
            <select
              id="distro"
              bind:value={distro}
              disabled={buildBusy}
              class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]">
              <option value="humble">Humble (simulation/desktop)</option>
              <option value="jazzy">Jazzy (simulation)</option>
            </select>
          </div>

          <div class="flex flex-col gap-1">
            <label for="middleware" class="text-xs text-[var(--pd-content-text)]">Middleware</label>
            <select
              id="middleware"
              bind:value={middleware}
              disabled={buildBusy || !simSupported}
              class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]">
              <option value="dds">DDS (default)</option>
              <option value="zenoh">Zenoh</option>
            </select>
            {#if !simSupported}
              <span class="text-xs pai-text-muted">Not applicable — simulation not available for {distro}</span>
            {/if}
          </div>

          <div class="flex flex-col gap-1">
            <label for="engine" class="text-xs text-[var(--pd-content-text)]">Simulation engine</label>
            <select
              id="engine"
              bind:value={engine}
              disabled={buildBusy || !simSupported}
              class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]">
              <option value="gazebo">Gazebo</option>
            </select>
            {#if !simSupported}
              <span class="text-xs pai-text-muted">Not applicable — simulation not available for {distro}</span>
            {/if}
          </div>

          <div class="flex flex-col gap-1">
            <label for="baseImage" class="text-xs text-[var(--pd-content-text)]">Base image</label>
            <select
              id="baseImage"
              bind:value={baseImage}
              disabled={buildBusy}
              class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]">
              {#each availableBaseImages as preset}
                <option value={preset.id}>{preset.label}</option>
              {/each}
            </select>
            <span class="text-xs text-[var(--pd-content-text)] opacity-80">{basePreset.description}</span>
            {#if !basePreset.architectures.includes(hostArch)}
              <span class="text-xs pai-text-warning">
                Warning: this preset does not support {hostArch}. The build may fail or use slow emulation.
              </span>
            {/if}
          </div>

          <div class="flex flex-row items-center gap-3 mt-2">
            <button on:click={save} disabled={saving || buildBusy} class="pai-btn pai-btn-primary">
              {saving ? 'Saving...' : 'Save'}
            </button>

            {#if saveSuccess}
              <span class="text-sm pai-text-success">Configuration saved</span>
            {/if}
            {#if saveError}
              <span class="text-sm pai-text-error">{saveError}</span>
            {/if}
          </div>
        </div>
      {/if}
    </div>

    <hr class="border-[var(--pd-content-card-border)] my-2" />

    <!-- Image Builder pipeline: Step 1 (base) + Step 2 (simulation), each with a
         live built/not-built status driven by the reactive existence check above. -->
    {#if layout !== 'layers'}
      <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
        <div class="flex flex-row items-center justify-between flex-wrap gap-2 mb-2">
          <h2 class="text-xl text-[var(--pd-content-header)]">
            {layout === 'guided' ? 'Guided Image Builder' : 'Image Builder Pipeline'}
          </h2>
          <span class="text-xs text-[var(--pd-content-text)] opacity-80 font-mono">
            {robot} &middot; {distro} &middot; {middleware} &middot; {engine} &middot; {basePreset.label}
          </span>
        </div>

        {#if layout === 'guided'}
          <div class="flex flex-col gap-2 pb-3 mb-1 border-b border-[var(--pd-content-card-border)]">
            <span class="text-sm font-medium text-[var(--pd-content-header)]">What do you want to build?</span>
            <div class="flex flex-row gap-2 flex-wrap" role="radiogroup" aria-label="What to build">
              <button
                type="button"
                role="radio"
                aria-checked={buildChoice === 'base'}
                on:click={() => (buildChoice = 'base')}
                disabled={buildBusy}
                class="px-3 py-1.5 text-sm rounded border cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed {buildChoice ===
                'base'
                  ? 'border-[var(--pd-content-header)] bg-[var(--pd-content-bg)] font-medium text-[var(--pd-content-header)]'
                  : 'border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]'}">
                Base image only
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={buildChoice === 'sim'}
                on:click={() => (buildChoice = 'sim')}
                disabled={buildBusy}
                class="px-3 py-1.5 text-sm rounded border cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed {buildChoice ===
                'sim'
                  ? 'border-[var(--pd-content-header)] bg-[var(--pd-content-bg)] font-medium text-[var(--pd-content-header)]'
                  : 'border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]'}">
                Simulation image
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={buildChoice === 'both'}
                on:click={() => (buildChoice = 'both')}
                disabled={buildBusy}
                class="px-3 py-1.5 text-sm rounded border cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed {buildChoice ===
                'both'
                  ? 'border-[var(--pd-content-header)] bg-[var(--pd-content-bg)] font-medium text-[var(--pd-content-header)]'
                  : 'border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]'}">
                Both
              </button>
            </div>
            {#if !buildChoice}
              <span class="text-xs pai-text-muted">Choose what to build to continue.</span>
            {/if}
          </div>
        {/if}

        {#if showStep1}
          <div id="step1-build" class="flex flex-col gap-3 pt-3 border-t border-[var(--pd-content-card-border)]">
            <div class="flex flex-row items-center gap-3 flex-wrap">
              <h3 class="text-sm font-medium text-[var(--pd-content-header)]">Step 1 &middot; Base image</h3>
              {#if baseImageExists}
                <span class="text-xs pai-text-success">&#10003; Built locally</span>
              {:else}
                <span class="text-xs pai-text-muted">&#9675; Not built</span>
              {/if}
              {#if baseTag}
                <span class="text-xs text-[var(--pd-content-text)] opacity-80 font-mono">{baseTag}</span>
              {/if}
            </div>
            {#if profile && baseTag}
              <p class="text-sm text-[var(--pd-content-text)]">
                Builds <span class="font-mono">{profile.baseAssetDir}</span> — ROS2 {distro} + build tools.
                {#if simSupported}
                  This is the FROM layer for the simulation image below.
                {/if}
              </p>

              <BuildPushPanel
                bind:tag={baseTag}
                bind:busy={baseBusy}
                buildImage={t => physicalAiClient.buildBaseImage(t, currentConfig)}
                onBuildComplete={() => {
                  baseImageExists = true;
                  refreshImageExistence(existsCheckKey);
                  void buildHistoryPanel?.refresh();
                }}
                tagPlaceholder="e.g. quay.io/ecosystem-appeng/ros2-jazzy-base:noble"
                tagInputId="baseTag" />
            {:else}
              <p class="text-sm p-3 rounded pai-banner-error">
                Cannot build: no base image Containerfile is bundled for
                <span class="font-mono">{distro}/{robot}/{middleware}/{engine}</span>. Choose a supported combination
                (Humble or Jazzy + TurtleBot3 + DDS + Gazebo).
              </p>
            {/if}
          </div>
        {/if}

        {#if showStep2}
          <div class="flex flex-col gap-3 pt-3 mt-3 border-t border-[var(--pd-content-card-border)]">
            <div class="flex flex-row items-center gap-3 flex-wrap">
              <h3 class="text-sm font-medium text-[var(--pd-content-header)]">Step 2 &middot; Simulation image</h3>
              {#if simImageExists}
                <span class="text-xs pai-text-success">&#10003; Built locally</span>
              {:else}
                <span class="text-xs pai-text-muted">&#9675; Not built</span>
              {/if}
              {#if simTag}
                <span class="text-xs text-[var(--pd-content-text)] opacity-80 font-mono">{simTag}</span>
              {/if}
            </div>
            {#if profile && simSupported && simTag}
              {#if !baseImageExists}
                <p class="text-sm p-3 rounded pai-banner-warning">
                  Build the base image (Step 1) first — the simulation image depends on it.
                </p>
              {:else}
                <p class="text-sm text-[var(--pd-content-text)]">
                  Builds <span class="font-mono">{profile.assetDir}</span> on top of the base image — Gazebo, Nav2, and TurtleBot3
                  packages (plus noVNC for Jazzy). Launch starts an empty world; add robots from the Simulation page.
                </p>
              {/if}

              <BuildPushPanel
                bind:tag={simTag}
                bind:busy={simBusy}
                buildImage={t => physicalAiClient.buildSimulationImage(t, currentConfig)}
                onBuildComplete={() => {
                  simImageExists = true;
                  refreshImageExistence(existsCheckKey);
                  void buildHistoryPanel?.refresh();
                }}
                tagPlaceholder="e.g. quay.io/ecosystem-appeng/ros2-jazzy-sim:noble"
                tagInputId="simTag"
                disabled={!baseImageExists} />
            {:else if profile && !simSupported}
              <p class="text-sm p-3 rounded pai-banner-warning">
                <strong>Not available yet.</strong> Simulation images (Gazebo, Nav2, TurtleBot3) are not yet available
                for ROS2 {distro}. Only the base image can be built at this time.
              </p>
            {:else}
              <p class="text-sm p-3 rounded pai-banner-error">
                Cannot build: no simulation Containerfile is bundled for
                <span class="font-mono">{distro}/{robot}/{middleware}/{engine}</span>. Choose a supported combination.
              </p>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    {#if layout === 'layers'}
      <LayerComposer />
    {/if}

    <hr class="border-[var(--pd-content-card-border)] my-2" />

    <BuildHistoryPanel bind:this={buildHistoryPanel} />
  {/if}
</div>
