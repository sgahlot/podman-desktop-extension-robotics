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
  CUSTOM_SIMULATION_BASE_IMAGE,
  DEFAULT_SIMULATION_BASE_IMAGE,
  baseImagesForDistro,
  defaultBaseImageForDistro,
} from '/@shared/src/types/SimulationBaseImages';
import type { SimulationBaseImageSelection } from '/@shared/src/types/SimulationBaseImages';
import type { SimulationConfig, TargetArch } from '/@shared/src/types/SimulationConfig';
import {
  CUSTOM_SIMULATION_TEMPLATES,
  type CustomSimulationTemplate,
} from '/@shared/src/types/CustomSimulationTemplates';
import {
  applyQuickStart as applyRecipeQuickStart,
  QUICK_STARTS,
  type QuickStartId,
} from '/@shared/src/types/QuickStarts';
import type { ImageBuilderRecipe } from '/@shared/src/types/ImageBuilderRecipe';
import { customSimulationImageTag } from '/@shared/src/types/imageBuilderPlan';

let robot = 'turtlebot3';
let distro = 'jazzy';
let middleware = 'dds';
let engine = 'gazebo';
let baseImage: SimulationBaseImageSelection = DEFAULT_SIMULATION_BASE_IMAGE;
let customBaseImage = '';
let customSimulationTemplate: CustomSimulationTemplate = CUSTOM_SIMULATION_TEMPLATES[0];
let customSimulationTemplateId = customSimulationTemplate.id;
let customSimulationMode: 'preset' | 'packages' = 'preset';
let customBaseOsFamily = '';
let customBaseOsVersion = '';
let customBaseRosDistro = '';
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
let baseLogsExpanded = true;
let simLogsExpanded = true;
let baseImageExists = false;
let simImageExists = false;
/** Guards the async existence check against stale responses. */
let existsCheckKey = '';

let optionsExpanded = false;

let showQuickStartConfirm = false;
let appliedQuickStartId: QuickStartId | undefined;
let pendingQuickStartId: QuickStartId = 'local-jazzy';
let selectedQuickStartId: QuickStartId = 'local-jazzy';

let layout: 'presets' | 'layers' = 'presets';
let buildChoice: 'base' | 'sim' | 'both' | undefined = undefined;
let buildHistoryPanel: BuildHistoryPanel;

$: buildBusy = baseBusy || simBusy;
// Auto-expand a panel's own logs whenever ITS OWN build (re)starts — otherwise, once
// collapsed by the rule below, a fresh build under that same panel would stay collapsed
// forever with no way back short of manually clicking the toggle.
$: if (baseBusy) baseLogsExpanded = true;
$: if (simBusy) simLogsExpanded = true;
// Collapse the completed Step 1 (base) logs once Step 2 (sim) starts building —
// the base build is already done by then, so its logs just take up space.
$: if (simBusy) baseLogsExpanded = false;
$: currentConfig = {
  robot,
  distro,
  middleware,
  engine,
  baseImage,
  customBaseImage,
  customBaseOsFamily,
  customBaseOsVersion,
  customBaseRosDistro,
  customSimulationTemplateId,
  customSimulationMode,
  targetArch,
} as SimulationConfig;
$: crossArch = targetArch !== hostArch;
$: otherArch = (hostArch === 'amd64' ? 'arm64' : 'amd64') as TargetArch;
$: otherArchLabel = otherArch === 'amd64' ? 'amd64 (for OpenShift)' : `${otherArch} (cross-build)`;
$: selectedQuickStart = QUICK_STARTS.find(qs => qs.id === selectedQuickStartId);
$: quickStartDescription =
  selectedQuickStart?.id === 'openshift-jazzy-amd64'
    ? 'Ubuntu Noble + ROS 2 Jazzy + Gazebo/Nav2/TurtleBot3 simulation (amd64 for OpenShift)'
    : 'Ubuntu Noble + ROS 2 Jazzy + Gazebo/Nav2/TurtleBot3 simulation';
$: quickStartAlreadyApplied = selectedQuickStartId === appliedQuickStartId;
$: profile = resolveSimulationProfile(currentConfig);
$: simSupported = profile ? hasSimulationSupport(profile) : false;
$: customSimulationTemplate =
  CUSTOM_SIMULATION_TEMPLATES.find(template => template.id === customSimulationTemplateId) ??
  CUSTOM_SIMULATION_TEMPLATES[0];
$: customSimReady =
  baseImage === CUSTOM_SIMULATION_BASE_IMAGE && customSimulationMode === 'packages' && !!customBaseImage.trim();
$: availableBaseImages = baseImagesForDistro(distro);
$: basePreset = resolveSimulationBaseImage(baseImage);
$: {
  const validForDistro = availableBaseImages.find(p => p.id === baseImage);
  if (!validForDistro && baseImage !== CUSTOM_SIMULATION_BASE_IMAGE && !buildBusy) {
    baseImage = defaultBaseImageForDistro(distro);
  }
}
$: {
  const key = `${ns}|${robot}|${distro}|${middleware}|${engine}|${baseImage}|${customBaseImage}|${customSimulationMode}|${customSimulationTemplate.id}|${targetArch}`;
  if (!buildBusy && key !== lastConfigKey) {
    lastConfigKey = key;
    baseTag = baseImageTag(ns, currentConfig) ?? '';
    simTag =
      baseImage === CUSTOM_SIMULATION_BASE_IMAGE && customSimulationMode === 'packages' && customBaseImage.trim()
        ? customSimulationImageTag(ns, customBaseImage, customSimulationTemplate, targetArch)
        : (simulationImageTag(ns, currentConfig) ?? '');
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
// Presets and Customize both show the build sequence — Customize owns its advanced
// sequence inside LayerComposer while the page shell keeps Quick Starts/target state.
$: showStep1 = layout === 'presets';
$: showStep2 = layout === 'presets';

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
    customBaseImage = config.customBaseImage ?? '';
    customBaseOsFamily = config.customBaseOsFamily ?? '';
    customBaseOsVersion = config.customBaseOsVersion ?? '';
    customBaseRosDistro = config.customBaseRosDistro ?? '';
    customSimulationTemplateId = config.customSimulationTemplateId ?? customSimulationTemplateId;
    customSimulationMode = config.customSimulationMode ?? 'preset';
    if (config.targetArch) targetArch = config.targetArch;
    // If loaded config matches a quick start, mark it as already applied
    if (
      baseImage === 'jazzy-noble' &&
      robot === 'turtlebot3' &&
      distro === 'jazzy' &&
      middleware === 'dds' &&
      engine === 'gazebo'
    ) {
      appliedQuickStartId = (config.targetArch ?? targetArch) === 'amd64' ? 'openshift-jazzy-amd64' : 'local-jazzy';
    }
  } catch {
    // defaults are fine
  }
  try {
    const savedLayout = await physicalAiClient.getImageBuilderLayout();
    if (savedLayout === 'presets' || savedLayout === 'layers') {
      layout = savedLayout;
    }
  } catch {
    // default 'presets' is fine
  } finally {
    loading = false;
  }
});

function setLayout(next: 'presets' | 'layers') {
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

function handleCustomSimulationModeChange(event: Event): void {
  customSimulationMode = (event.currentTarget as HTMLSelectElement).value as 'preset' | 'packages';
  distro = customSimulationMode === 'packages' ? customSimulationTemplate.rosDistro : 'jazzy';
}

function handleCustomSimulationTemplateChange(): void {
  if (customSimulationMode === 'packages') distro = customSimulationTemplate.rosDistro;
}

async function applyQuickStart(id: QuickStartId = 'local-jazzy') {
  const selected = applyRecipeQuickStart(
    {
      targetArch,
      base: { kind: 'preset', presetId: baseImage },
      simulation: { kind: 'preset', profileId: 'turtlebot3-jazzy-dds-gazebo' },
      hardenedTools: [],
      generateSbom: false,
    } satisfies ImageBuilderRecipe,
    id,
  );
  robot = 'turtlebot3';
  distro = 'jazzy';
  middleware = 'dds';
  engine = 'gazebo';
  baseImage =
    selected.base.kind === 'preset'
      ? (selected.base.presetId as SimulationBaseImageSelection)
      : DEFAULT_SIMULATION_BASE_IMAGE;
  if (selected.targetArch) targetArch = selected.targetArch;
  appliedQuickStartId = id;
  showQuickStartConfirm = false;
  // Target arch comes from the Target toggle, not from Quick Start.
  // Let reactive tags update before save
  await tick();
  await save();
  document.getElementById('step1-build')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function onQuickStartClick(id: QuickStartId = 'local-jazzy') {
  selectedQuickStartId = id;
  pendingQuickStartId = id;
  if (id === appliedQuickStartId) {
    // Already applied — no change needed.
    void applyQuickStart(id);
  } else {
    showQuickStartConfirm = true;
  }
}

function cancelQuickStart() {
  showQuickStartConfirm = false;
  selectedQuickStartId = appliedQuickStartId ?? 'local-jazzy';
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
    <!-- Layout switcher using tab styling like Simulation page -->
    <div class="flex flex-row gap-1 border-b border-[var(--pd-content-card-border)]">
      <button
        role="tab"
        aria-selected={layout === 'presets'}
        on:click={() => setLayout('presets')}
        disabled={buildBusy}
        class="px-5 py-2 text-sm pai-tab {layout === 'presets' ? 'pai-tab-active' : ''}">
        Presets
      </button>
      <button
        role="tab"
        aria-selected={layout === 'layers'}
        on:click={() => setLayout('layers')}
        disabled={buildBusy}
        class="px-5 py-2 text-sm pai-tab {layout === 'layers' ? 'pai-tab-active' : ''}">
        Customize
      </button>
    </div>

    <!-- Quick Start only in Presets layout -->
    {#if layout === 'presets'}
      <div
        class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 max-w-md flex flex-col gap-2">
        <h2 class="text-sm font-medium text-[var(--pd-content-header)]">Quick Start</h2>
        <p class="text-xs text-[var(--pd-content-text)]">
          TurtleBot3 + Jazzy — the recommended configuration for the simulation demo. Applies the recommended
          configuration to the preset.
        </p>
        <div class="flex flex-row gap-2 flex-wrap">
          {#each QUICK_STARTS as quickStart}
            <button
              on:click={() => onQuickStartClick(quickStart.id)}
              disabled={buildBusy || saving}
              aria-label={quickStart.label}
              class="px-3 py-1.5 text-sm rounded border cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed {selectedQuickStartId ===
              quickStart.id
                ? 'border-[var(--pd-content-header)] bg-[var(--pd-content-bg)] font-medium text-[var(--pd-content-header)]'
                : 'border-[var(--pd-content-text)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] hover:border-[var(--pd-content-header)]'}">
              {quickStart.label}
            </button>
          {/each}
        </div>
        <span class="text-xs text-[var(--pd-content-text)] opacity-80">
          {quickStartDescription}
        </span>
        {#if showQuickStartConfirm}
          <div class="flex flex-col gap-2 mt-1 p-2 rounded border border-[var(--pd-content-card-border)]">
            <span class="text-xs pai-text-warning">
              This will replace the current builder configuration with the selected Quick Start.
            </span>
            {#if pendingQuickStartId === 'openshift-jazzy-amd64'}
              <span class="text-xs pai-text-warning">
                &#9888; amd64 is required for OpenShift deployment. Cross-building on a {hostArch} host uses QEMU emulation
                — expect a slower build.
              </span>
            {/if}
            <div class="flex flex-row gap-2">
              <button
                on:click={() => applyQuickStart(pendingQuickStartId)}
                disabled={buildBusy || saving}
                class="pai-btn pai-btn-primary">
                Apply Quick Start
              </button>
              <button on:click={cancelQuickStart} disabled={buildBusy || saving} class="pai-btn"> Cancel </button>
            </div>
          </div>
        {/if}
      </div>
    {/if}

    {#if layout === 'presets'}
      <hr class="border-[var(--pd-content-card-border)] my-2" />
    {/if}

    <!-- Image Builder pipeline: Step 1 (base) + Step 2 (simulation), each with a
         live built/not-built status driven by the reactive existence check above. -->
    {#if layout === 'presets'}
      <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
        <div class="flex flex-row items-center justify-between flex-wrap gap-2 mb-2">
          <h2 class="text-xl text-[var(--pd-content-header)]">Preset Image Builder</h2>
          <span class="text-xs text-[var(--pd-content-text)] opacity-80 font-mono">
            {robot} &middot; {distro} &middot; {middleware} &middot; {engine} &middot; {basePreset.label}
          </span>
        </div>

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
            {#if baseImage === CUSTOM_SIMULATION_BASE_IMAGE && customSimulationMode === 'packages'}
              <p class="text-sm pai-banner-warning p-3 rounded">
                Custom simulation skips the preset Phase 1 build and adds fixed packages directly to the selected
                ROS-ready parent.
              </p>
            {:else if profile && baseTag}
              <p class="text-sm text-[var(--pd-content-text)]">
                Builds <span class="font-mono">{profile.baseAssetDir}</span> — ROS2 {distro} + build tools.
                {#if simSupported}
                  This is the FROM layer for the simulation image below.
                {/if}
              </p>

              <BuildPushPanel
                bind:tag={baseTag}
                bind:busy={baseBusy}
                bind:buildLogsExpanded={baseLogsExpanded}
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
            {#if baseImage === CUSTOM_SIMULATION_BASE_IMAGE && customSimulationMode === 'packages' && simTag}
              {#if !customSimReady}
                <p class="text-sm p-3 rounded pai-banner-warning">
                  Enter a custom ROS-ready parent image before building.
                </p>
              {:else}
                <p class="text-sm pai-banner-warning p-3 rounded">
                  Packages-only output. Run it manually after building; extension-managed Simulation, Navigate, noVNC,
                  diagnostics, and OpenShift deployment are intentionally unavailable.
                </p>
              {/if}
            {:else if profile && simSupported && simTag}
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
                bind:buildLogsExpanded={simLogsExpanded}
                buildImage={t =>
                  baseImage === CUSTOM_SIMULATION_BASE_IMAGE && customSimulationMode === 'packages'
                    ? physicalAiClient.buildCustomSimulationImage(
                        t,
                        customBaseImage,
                        customSimulationTemplate.id,
                        targetArch,
                        {
                          osFamily: customBaseOsFamily,
                          osVersion: customBaseOsVersion,
                          rosDistro: customBaseRosDistro,
                        },
                      )
                    : baseImage === CUSTOM_SIMULATION_BASE_IMAGE
                      ? physicalAiClient.buildSimulationImage(t, currentConfig, { parentImageTag: baseTag })
                      : physicalAiClient.buildSimulationImage(t, currentConfig)}
                onBuildComplete={() => {
                  simImageExists = true;
                  refreshImageExistence(existsCheckKey);
                  void buildHistoryPanel?.refresh();
                }}
                tagPlaceholder="e.g. quay.io/ecosystem-appeng/ros2-jazzy-sim:noble"
                tagInputId="simTag"
                disabled={baseImage === CUSTOM_SIMULATION_BASE_IMAGE && customSimulationMode === 'packages'
                  ? !customSimReady
                  : !baseImageExists} />
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
      <LayerComposer
        bind:targetArch={targetArch}
        hostArch={hostArch}
        quickStartId={appliedQuickStartId}
        onBuildComplete={({ watchForSbom }) => void buildHistoryPanel?.refreshAfterBuild(watchForSbom)} />
    {/if}

    <hr class="border-[var(--pd-content-card-border)] my-2" />

    <BuildHistoryPanel bind:this={buildHistoryPanel} />
  {/if}
</div>
