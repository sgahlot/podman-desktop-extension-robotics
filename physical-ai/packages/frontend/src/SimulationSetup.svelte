<script lang="ts">
import { physicalAiClient } from './api/client';
import { onMount, tick } from 'svelte';
import { router } from 'tinro';
import BuildPushPanel from './lib/BuildPushPanel.svelte';
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
import type { SimulationConfig } from '/@shared/src/types/SimulationConfig';

let robot = 'turtlebot3';
let distro = 'humble';
let middleware = 'dds';
let engine = 'gazebo';
let baseImage: SimulationBaseImageId = DEFAULT_SIMULATION_BASE_IMAGE;

let loading = true;
let saving = false;
let saveSuccess = false;
let saveError = '';

let ns = 'ecosystem-appeng';
let hostArch = 'amd64';
let baseTag = '';
let simTag = '';
let lastConfigKey = '';
let baseBusy = false;
let simBusy = false;
let baseImageExists = false;

$: buildBusy = baseBusy || simBusy;
$: currentConfig = { robot, distro, middleware, engine, baseImage } as SimulationConfig;
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
  const key = `${ns}|${robot}|${distro}|${middleware}|${engine}|${baseImage}`;
  if (!buildBusy && key !== lastConfigKey) {
    lastConfigKey = key;
    baseTag = baseImageTag(ns, currentConfig) ?? '';
    simTag = simulationImageTag(ns, currentConfig) ?? '';
  }
}

async function checkBaseImageExists() {
  if (!baseTag) { baseImageExists = false; return; }
  try {
    const local = await physicalAiClient.listLocalImages();
    baseImageExists = local.includes(baseTag);
  } catch {
    baseImageExists = false;
  }
}

onMount(async () => {
  try {
    ns = await physicalAiClient.getDefaultNamespace();
  } catch {
    // default is fine
  }
  try {
    hostArch = await physicalAiClient.getHostArch();
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
  } catch {
    // defaults are fine
  } finally {
    loading = false;
    checkBaseImageExists();
  }
});

async function save() {
  saving = true;
  saveSuccess = false;
  saveError = '';

  try {
    await physicalAiClient.saveSimulationConfig(currentConfig);
    saveSuccess = true;
    setTimeout(() => { saveSuccess = false; }, 3000);
  } catch (e) {
    saveError = e instanceof Error ? e.message : 'Failed to save';
  } finally {
    saving = false;
  }
}

async function applyQuickStart() {
  robot = 'turtlebot3';
  distro = 'jazzy';
  middleware = 'dds';
  engine = 'gazebo';
  baseImage = 'jazzy-arm64';
  // Let reactive tags update before save
  await tick();
  await save();
  document.getElementById('phase1-build')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
</script>

<div class="flex flex-col p-4 gap-4 h-full overflow-auto">
  <button on:click={() => router.goto('/')} class="pai-link self-start">
    &larr; Back to Dashboard
  </button>
  <h1 class="text-3xl text-[var(--pd-content-header)]">Image Builder</h1>
  <p class="text-sm text-[var(--pd-content-text)]">
    Configure, build, and push ROS2 base and simulation container images.
  </p>

  {#if loading}
    <div class="text-sm text-[var(--pd-content-text)]">Loading configuration...</div>
  {:else}
    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 max-w-md">
      <h2 class="text-sm font-medium text-[var(--pd-content-header)] mb-2">Quick Start</h2>
      <p class="text-xs text-[var(--pd-content-text)] mb-3">
        Configure TurtleBot3 + Jazzy arm64, save preferences, and jump to Phase 1 Build.
      </p>
      <button
        on:click={applyQuickStart}
        disabled={buildBusy || saving}
        class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-[var(--pd-content-text)] cursor-pointer hover:border-[var(--pd-content-header)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        TurtleBot3 Sim (Jazzy arm64)
      </button>
    </div>

    <div class="flex flex-col gap-4 max-w-md">

      <div class="flex flex-col gap-1">
        <label for="robot" class="text-xs text-[var(--pd-content-text)]">Robot type</label>
        <select
          id="robot"
          bind:value={robot}
          disabled={buildBusy || !simSupported}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]"
        >
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
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]"
        >
          <option value="humble">Humble (simulation/desktop)</option>
          <option value="jazzy">Jazzy (simulation/arm64-native)</option>
        </select>
      </div>

      <div class="flex flex-col gap-1">
        <label for="middleware" class="text-xs text-[var(--pd-content-text)]">Middleware</label>
        <select
          id="middleware"
          bind:value={middleware}
          disabled={buildBusy || !simSupported}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]"
        >
          <option value="dds">DDS (default)</option>
          <option value="zenoh" disabled>Zenoh (coming soon)</option>
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
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]"
        >
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
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]"
        >
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

    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 max-w-md mt-2">
      <h2 class="text-sm font-medium text-[var(--pd-content-header)] mb-2">Current selection</h2>
      <div class="text-xs text-[var(--pd-content-text)] flex flex-col gap-1">
        <div><strong>Robot:</strong> {robot}</div>
        <div><strong>Distro:</strong> ROS2 {distro}</div>
        <div><strong>Middleware:</strong> {middleware.toUpperCase()}</div>
        <div><strong>Engine:</strong> {engine}</div>
        <div><strong>Base image:</strong> {basePreset.label}</div>
        <div class="font-mono break-all opacity-80">{basePreset.imageRef}</div>
        {#if profile}
          <div class="mt-1 pai-text-success">
            &#10003; Base image: buildable ({profile.baseAssetDir})
          </div>
          {#if simSupported}
            <div class="mt-1 pai-text-success">
              &#10003; Simulation image: buildable ({profile.assetDir})
            </div>
          {:else}
            <div class="mt-1 pai-text-warning">
              &#9888; Simulation image: not yet available for {distro}
            </div>
          {/if}
        {:else}
          <div class="mt-1 pai-text-error">
            No bundled image for this combination yet.
          </div>
        {/if}
      </div>
    </div>

    <hr class="border-[var(--pd-content-card-border)] my-2" />

    <h2 id="phase1-build" class="text-xl text-[var(--pd-content-header)]">Phase 1: Build & Push Base Image</h2>

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
        onBuildComplete={() => { baseImageExists = true; }}
        tagPlaceholder="e.g. quay.io/ecosystem-appeng/ros2-jazzy-base:noble"
        tagInputId="baseTag"
      />
    {:else}
      <p class="text-sm p-3 rounded pai-banner-error">
        Cannot build: no base image Containerfile is bundled for
        <span class="font-mono">{distro}/{robot}/{middleware}/{engine}</span>.
        Choose a supported combination (Humble or Jazzy + TurtleBot3 + DDS + Gazebo).
      </p>
    {/if}

    <hr class="border-[var(--pd-content-card-border)] my-2" />

    <h2 class="text-xl text-[var(--pd-content-header)]">Phase 2: Build & Push Simulation Image</h2>

    {#if profile && simSupported && simTag}
      {#if !baseImageExists}
        <p class="text-sm p-3 rounded pai-banner-warning">
          Build the base image (Phase 1) first — the simulation image depends on it.
        </p>
      {:else}
        <p class="text-sm text-[var(--pd-content-text)]">
          Builds <span class="font-mono">{profile.assetDir}</span> on top of the base image —
          Gazebo, Nav2, and TurtleBot3 packages (plus noVNC for Jazzy arm64). Launch starts an empty world; add robots from the Simulation page.
        </p>
      {/if}

      <BuildPushPanel
        bind:tag={simTag}
        bind:busy={simBusy}
        buildImage={t => physicalAiClient.buildSimulationImage(t, currentConfig)}
        tagPlaceholder="e.g. quay.io/ecosystem-appeng/ros2-jazzy-sim-arm64:noble"
        tagInputId="simTag"
        disabled={!baseImageExists}
      />
    {:else if profile && !simSupported}
      <p class="text-sm p-3 rounded pai-banner-warning">
        <strong>Not available yet.</strong> Simulation images (Gazebo, Nav2, TurtleBot3) are not yet
        available for ROS2 {distro}. Only the base image can be built at this time.
      </p>
    {:else}
      <p class="text-sm p-3 rounded pai-banner-error">
        Cannot build: no simulation Containerfile is bundled for
        <span class="font-mono">{distro}/{robot}/{middleware}/{engine}</span>.
        Choose a supported combination.
      </p>
    {/if}
  {/if}
</div>
