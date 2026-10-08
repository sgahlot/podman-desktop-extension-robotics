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
  hummingbirdImageRef,
  managedSimBundleAssetDir,
  managedSimVerifyHooks,
  selectionNeedsBundledSimRuntime,
  type HardenedApp,
  type LayerSelection,
} from '/@shared/src/types/layerCompatibility';
import { rosLayerOptionToDistroId } from '/@shared/src/config/rosDistroCatalog';
import { layerCachePlanForPresetPhase, layerCachePlanFromSelection } from '/@shared/src/types/buildLayerCache';
import { SBOM_FORMAT_DEFAULT, type SbomFormat } from '/@shared/src/types/BuildHistory';
import {
  baseImageTag,
  hardenedImageTag,
  simulationImageTag,
  platformForArch,
  archTagSuffix,
} from '/@shared/src/types/SimulationProfiles';
import { defaultBaseImageForDistro, shortImageRef } from '/@shared/src/types/SimulationBaseImages';
import { CUSTOM_SIMULATION_TEMPLATES } from '/@shared/src/types/CustomSimulationTemplates';
import { buildLayerStackContainerfile } from '/@shared/src/build/presetContainerfile';
import { QUICK_STARTS } from '/@shared/src/types/QuickStarts';
import type { SimulationConfig, TargetArch } from '/@shared/src/types/SimulationConfig';
import { imageRefForRegistry, type CatalogRegistry } from '/@shared/src/types/ImageCatalog';
import { physicalAiClient } from '../api/client';
import { onMount, onDestroy } from 'svelte';
import BuildPushPanel from './BuildPushPanel.svelte';
import RegistrySelector from './RegistrySelector.svelte';

let selection: LayerSelection = {
  baseOs: 'ubuntu-noble',
  customBaseImage: '',
  customBaseOsFamily: '',
  customBaseOsVersion: '',
  customBaseRosDistro: '',
  hardened: 'none',
  ros: 'ros2-jazzy',
  sim: 'gazebo-nav2-tb3',
  customSimulationTemplateId: CUSTOM_SIMULATION_TEMPLATES[0].id,
  hummingbirdApps: [],
};

let sbomFormat: SbomFormat = SBOM_FORMAT_DEFAULT;

let attemptAnyway = false;

// Target arch is owned by the parent (SimulationSetup's Target toggle) — the single
// source of truth shared across all three layouts (APPENG-6241: this used to be a
// LayerComposer-local hostArch fetch with no way to select a different target at all,
// so the Target toggle silently did nothing in Layers mode).
export let targetArch: TargetArch;
export let hostArch: TargetArch;
export let active = true;
export let refreshIntervalSeconds = 5;
export let busy = false;
/** Shared Quick Start selection from the Image Builder shell. */
export let quickStartId: string | undefined = undefined;
/** Hide target-arch control when Presets quick start fixes the architecture. */
export let hideTargetArch = false;
/** Lock layer dropdowns (Presets fedora-layers quick start). */
export let lockLayerSelection = false;
/** Registry selected by the containing Image Builder tab for every image in this section. */
export let pushRegistry: CatalogRegistry | undefined = undefined;
/** Notifies the parent (SimulationSetup, which owns the BuildHistoryPanel instance) that a
 * build here just finished, so the Recent Builds list can refresh — this panel has no
 * history view of its own (APPENG-6265: previously missing entirely, so a Layers build
 * only ever showed up in Recent Builds once the panel's own periodic poll happened to
 * catch it). `watchForSbom` should be true only for a build that opted into SBOM
 * generation — its SBOM is attached asynchronously well after the build itself completes. */
export let onBuildComplete: ((opts: { watchForSbom: boolean; builtTag: string }) => void) | undefined = undefined;

// Environment loaded once on mount.
let ns = '';
let localImages: string[] = [];
let appliedQuickStartId = '';
let baseBusy = false;
let hardenedBusy = false;
let simBusy = false;
let customBuildBusy = false;
let baseLogsExpanded = true;
let hardenedLogsExpanded = true;
let simLogsExpanded = true;

$: buildBusy = baseBusy || hardenedBusy || simBusy || customBuildBusy;
// Auto-expand a panel's own logs when its build (re)starts; collapse earlier steps when a later
// preset-stack step starts (same UX as Presets Step 1 / Step 2 in SimulationSetup.svelte).
$: if (baseBusy) baseLogsExpanded = true;
$: if (hardenedBusy) hardenedLogsExpanded = true;
$: if (simBusy) simLogsExpanded = true;
$: if (hardenedBusy) baseLogsExpanded = false;
$: if (simBusy) {
  baseLogsExpanded = false;
  hardenedLogsExpanded = false;
}
$: busy = buildBusy;
$: layerFieldsDisabled = buildBusy || lockLayerSelection;
/** Presets quick start: recipe is fixed above — only show compatibility + build actions. */
$: compactPresetsQuickStart = lockLayerSelection && hideTargetArch;

$: if (quickStartId && quickStartId !== appliedQuickStartId) {
  appliedQuickStartId = quickStartId;
  const quickStart = QUICK_STARTS.find(qs => qs.id === quickStartId);
  selection = quickStart?.layerPreset
    ? {
        ...selection,
        baseOs: quickStart.layerPreset.baseOs,
        customBaseImage: '',
        ros: quickStart.layerPreset.ros,
        sim: quickStart.layerPreset.sim,
      }
    : {
        ...selection,
        baseOs: 'ubuntu-noble',
        customBaseImage: '',
        ros: 'ros2-jazzy',
        sim: 'gazebo-nav2-tb3',
      };
}

$: result = evaluateStack(selection);
$: containerfile = buildLayerStackContainerfile(selection, targetArch);
$: baseOsNote =
  selection.sim === 'custom-template' && selection.baseOs === 'custom'
    ? `Expected parent: ${selectedCustomTemplate.osFamily} ${selectedCustomTemplate.osVersion} with ROS 2 ${selectedCustomTemplate.rosDistro}`
    : (BASE_OS_OPTIONS.find(o => o.id === selection.baseOs)?.note ?? '');
$: hardenedNote = HARDENED_OPTIONS.find(o => o.id === selection.hardened)?.note ?? '';
$: rosNote = ROS_OPTIONS.find(o => o.id === selection.ros)?.note ?? '';
$: simNote = SIM_OPTIONS.find(o => o.id === selection.sim)?.note ?? '';
$: selectedCustomTemplate =
  CUSTOM_SIMULATION_TEMPLATES.find(t => t.id === selection.customSimulationTemplateId) ??
  CUSTOM_SIMULATION_TEMPLATES[0];
$: customTemplateSupportsTarget =
  selection.sim !== 'custom-template' || selectedCustomTemplate.architectures.includes(targetArch);
$: lyricalTargetUnsupported = selection.ros === 'ros2-lyrical' && targetArch !== 'amd64';
$: otherArch = (hostArch === 'amd64' ? 'arm64' : 'amd64') as TargetArch;
$: otherArchLabel = otherArch === 'amd64' ? 'amd64 (for OpenShift)' : `${otherArch} (cross-build)`;
$: if (selection.baseOs === 'custom' && selection.sim === 'custom-template' && selection.ros !== 'provided-by-parent') {
  selection.ros = 'provided-by-parent';
}

function syncSimulationSource(): void {
  if (selection.sim === 'custom-template') {
    selection.ros = 'provided-by-parent';
  } else {
    // Reset to default when switching away from custom-template
    selection.ros = 'ros2-jazzy';
  }
}

function safeLayerCachePlan(
  sel: LayerSelection,
  phase?: 'base' | 'hardened' | 'sim',
): ReturnType<typeof layerCachePlanFromSelection> {
  try {
    return phase ? layerCachePlanForPresetPhase(sel, phase) : layerCachePlanFromSelection(sel);
  } catch {
    // Cache details are supplemental; an incomplete custom contract must not prevent the
    // wizard from showing its base-image preview and validation message.
    return [{ layerId: 'base-os', label: 'Base OS · Custom image reference' }];
  }
}

$: baseOsLabel =
  selection.baseOs === 'custom'
    ? selection.customBaseImage?.trim()
      ? shortImageRef(selection.customBaseImage)
      : 'Custom image reference'
    : (BASE_OS_OPTIONS.find(o => o.id === selection.baseOs)?.label ?? selection.baseOs);
$: bannerClass =
  result.level === 'ok' ? 'pai-banner-success' : result.level === 'warn' ? 'pai-banner-warning' : 'pai-banner-error';
$: bannerHeadline =
  selection.sim === 'custom-template' && result.buildable
    ? '⚠️ Template contract selected · parent not verified'
    : result.level === 'ok'
      ? '✅ Ready — builds and runs today'
      : result.level === 'warn'
        ? '⚠️ Builds, but not a working robotics image'
        : "❌ Won't build";
$: buildDisabled =
  (result.level === 'blocked' && !attemptAnyway) || !customTemplateSupportsTarget || lyricalTargetUnsupported;

// Reset the escape hatch whenever the selection changes so a previously-blocked
// "attempt anyway" choice doesn't silently carry over to a new combination.
$: (selection, (attemptAnyway = false));

// Clear stale Hummingbird app picks when Hummingbird is turned off, without wiping them
// on unrelated selection changes (e.g. toggling ROS while Hummingbird stays selected).
$: if (selection.hardened !== 'hummingbird-app' && (selection.hummingbirdApps?.length ?? 0) > 0) {
  selection.hummingbirdApps = [];
}

// --- Build mode -----------------------------------------------------------------
// Mode A ("preset"): Ubuntu + ROS [+ Sim] on the tested asset recipe. Bake-in Hummingbird
// tools use a separate hardened middle image (step 2 of 3) so the base image stays stable.
// Mode B ("containerfile"): bootc bases, attempt-anyway, and other non-preset stacks.
$: isPresetStack =
  selection.baseOs === 'ubuntu-noble' &&
  (selection.ros === 'ros2-jazzy' || selection.ros === 'ros2-humble') &&
  (selection.sim === 'none' || selection.sim === 'gazebo-nav2-tb3');
$: bakeInTools = (selection.hummingbirdApps ?? []).filter((a: HardenedApp) =>
  HUMMINGBIRD_TOOL_OPTIONS.some(o => o.id === a),
);
$: buildMode = isPresetStack ? 'preset' : 'containerfile';
$: layerCachePlan = safeLayerCachePlan(selection);
$: layerCachePlanBase = safeLayerCachePlan(selection, 'base');
$: layerCachePlanHardened = safeLayerCachePlan(selection, 'hardened');
$: layerCachePlanSim = safeLayerCachePlan(selection, 'sim');

$: presetDistro = rosLayerOptionToDistroId(selection.ros) ?? 'jazzy';
$: presetConfig = {
  robot: 'turtlebot3',
  distro: presetDistro,
  middleware: 'dds',
  engine: 'gazebo',
  baseImage: defaultBaseImageForDistro(presetDistro),
  targetArch,
} as SimulationConfig;
$: presetBaseTag = ns
  ? imageRefForRegistry(
      baseImageTag(ns, presetConfig) ?? '',
      pushRegistry ?? {
        id: 'quay-default',
        displayName: 'Quay.io',
        kind: 'quay',
        host: 'quay.io',
        namespace: ns,
      },
    )
  : '';
$: presetHardenedTag =
  needsHardened && ns
    ? imageRefForRegistry(
        hardenedImageTag(ns, presetConfig) ?? '',
        pushRegistry ?? {
          id: 'quay-default',
          displayName: 'Quay.io',
          kind: 'quay',
          host: 'quay.io',
          namespace: ns,
        },
      )
    : '';
$: presetSimTag = ns
  ? imageRefForRegistry(
      simulationImageTag(ns, presetConfig) ?? '',
      pushRegistry ?? {
        id: 'quay-default',
        displayName: 'Quay.io',
        kind: 'quay',
        host: 'quay.io',
        namespace: ns,
      },
    )
  : '';
$: wantsSim = selection.sim !== 'none';
$: needsHardened = bakeInTools.length > 0;

// Track the actual tags being used (may differ from preset if user edited them)
let baseTag = presetBaseTag;
let hardenedTag = presetHardenedTag;
let simTag = presetSimTag;
let lastDefaultRegistryId = '';

$: if ((pushRegistry?.id ?? '') !== lastDefaultRegistryId && !buildBusy) {
  lastDefaultRegistryId = pushRegistry?.id ?? '';
  baseTag = presetBaseTag;
  hardenedTag = presetHardenedTag;
  simTag = presetSimTag;
}

// Check existence against the actual tags (what the user built), not the presets
$: baseImageExists = !!baseTag && localImages.includes(baseTag);
$: hardenedImageExists = !!hardenedTag && localImages.includes(hardenedTag);
$: simParentReady = baseImageExists && (!needsHardened || hardenedImageExists);
/** Sim must FROM a finished hardened parent — not an in-flight rebuild or stale tag race. */
$: simBuildDisabled = !simParentReady || (needsHardened && hardenedBusy);
$: containerfileTag = imageRefForRegistry(
  `${ns ? `quay.io/${ns}/` : ''}robotics-${selection.baseOs}:latest${archTagSuffix(targetArch)}`,
  pushRegistry ?? {
    id: 'quay-default',
    displayName: 'Quay.io',
    kind: 'quay',
    host: 'quay.io',
    namespace: ns,
  },
);

// --- Images this stack pulls -----------------------------------------------------
// The generic Base OS ref (BASE_OS_IMAGE_REF) is only what the *generated Containerfile*
// FROMs — in preset mode the tested recipe pulls its own (different) base/sim images
// itself via buildBaseImage/buildSimulationImage, so listing it here would be misleading.
$: selectedHbApps = selection.hardened === 'hummingbird-app' ? (selection.hummingbirdApps ?? []) : [];
$: pullTargets = [
  ...(buildMode === 'containerfile'
    ? [{ ref: baseOsImageRef(selection.baseOs, selection.customBaseImage), label: `Base OS — ${baseOsLabel}` }]
    : []),
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
  await refreshLocalImages();
});

onDestroy(() => {
  for (const ref of Object.keys(pollTimers)) stopPoll(ref);
});
</script>

<div class="flex flex-col gap-4 max-w-2xl">
  {#if !compactPresetsQuickStart}
    <p class="text-xs pai-text-muted">
      Experimental — compose an image from a base OS, hardened, ROS, and simulation layers. Pick any combination; the
      compatibility check tells you whether it will build, then pull the layers and build for real below.
    </p>
    <p class="text-xs pai-text-muted">
      This is a representative catalog: bootc bases come from the <span class="font-mono">redhat.bootc</span> extension
      and hardened apps from the <span class="font-mono">redhat.hummingbird</span> extension. Pull them below to make each
      layer available locally — a ✓ badge shows which images you already have.
    </p>
  {/if}

  {#if !compactPresetsQuickStart}
    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
      <fieldset disabled={layerFieldsDisabled} class="flex flex-col gap-4 disabled:opacity-70">
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
          {#if selection.baseOs === 'custom'}
            <div class="flex flex-col gap-3 mt-1 pl-3 border-l border-[var(--pd-content-card-border)]">
              <div class="flex flex-col gap-1">
                <input
                  id="layer-custom-base-image"
                  aria-label="Custom base image"
                  bind:value={selection.customBaseImage}
                  placeholder="e.g. docker.io/library/ubuntu:24.04"
                  class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]" />
                <span class="text-xs pai-text-muted">{baseOsNote}</span>
              </div>
            </div>
          {/if}
          {#if selection.baseOs !== 'custom'}
            <span class="text-xs pai-text-muted">{baseOsNote}</span>
          {/if}
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
                  <label class="flex flex-row items-start gap-2 text-xs text-[var(--pd-content-text)]">
                    <input type="checkbox" class="mt-0.5" bind:group={selection.hummingbirdApps} value={o.id} />
                    <span>{o.label} <span class="pai-text-muted">— {o.note}</span></span>
                  </label>
                  {#if o.id === 'syft' && selectedHbApps.includes('syft')}
                    <div
                      class="flex flex-col gap-1 ml-5 pl-3 border-l border-[var(--pd-content-card-border)]"
                      role="radiogroup"
                      aria-label="SBOM format">
                      <span class="text-xs text-[var(--pd-content-text)]">SBOM format</span>
                      <label class="flex flex-row items-start gap-2 text-xs text-[var(--pd-content-text)]">
                        <input type="radio" class="mt-0.5" bind:group={sbomFormat} value="cyclonedx-json" />
                        <span
                          >CycloneDX <span class="pai-text-muted"
                            >(recommended) — same package data without SPDX's per-package CPE-variant overhead;
                            typically much smaller, especially for images with many small packages (e.g. ROS/Nav2
                            stacks)</span
                          ></span>
                      </label>
                      <label class="flex flex-row items-start gap-2 text-xs text-[var(--pd-content-text)]">
                        <input type="radio" class="mt-0.5" bind:group={sbomFormat} value="spdx-json" />
                        <span
                          >SPDX <span class="pai-text-muted"
                            >— includes richer CPE metadata some vulnerability-scanning tools specifically require, but
                            can run significantly larger for images with many packages</span
                          ></span>
                      </label>
                    </div>
                  {/if}
                {/each}
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-xs text-[var(--pd-content-text)]"
                  >Tools to bake in — hardened CLI via COPY --from</span>
                {#each HUMMINGBIRD_TOOL_OPTIONS as o}
                  <label class="flex flex-row items-start gap-2 text-xs text-[var(--pd-content-text)]">
                    <input type="checkbox" class="mt-0.5" bind:group={selection.hummingbirdApps} value={o.id} />
                    <span>{o.label} <span class="pai-text-muted">— {o.note}</span></span>
                  </label>
                {/each}
              </div>
            </div>
          {/if}
        </div>

        <div class="flex flex-col gap-1">
          <label for="layer-sim" class="text-xs text-[var(--pd-content-text)]">Simulation</label>
          <select
            id="layer-sim"
            bind:value={selection.sim}
            on:change={syncSimulationSource}
            class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]">
            {#each SIM_OPTIONS as o}
              <option value={o.id}>{o.label}</option>
            {/each}
          </select>
          <span class="text-xs pai-text-muted">{simNote}</span>
          {#if selection.sim === 'custom-template' && selection.baseOs === 'custom'}
            <div class="flex flex-col gap-3 mt-1 pl-3 border-l border-[var(--pd-content-card-border)]">
              <div class="flex flex-col gap-1">
                <label for="layer-simulation-template" class="text-xs text-[var(--pd-content-text)]"
                  >Registered simulation template</label>
                <select
                  id="layer-simulation-template"
                  bind:value={selection.customSimulationTemplateId}
                  aria-label="Simulation template"
                  class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]">
                  {#each CUSTOM_SIMULATION_TEMPLATES as template}
                    <option value={template.id}>{template.label}</option>
                  {/each}
                </select>
                <span class="text-xs pai-text-warning"
                  >{selectedCustomTemplate.capability}: {selectedCustomTemplate.packages.join(', ')}</span>
                <span class="text-xs text-[var(--pd-content-text)] opacity-80">
                  Required parent: {selectedCustomTemplate.osFamily}
                  {selectedCustomTemplate.osVersion} · ROS 2
                  {selectedCustomTemplate.rosDistro} · {selectedCustomTemplate.packageManager}. ROS is provided by the
                  custom parent.
                </span>
              </div>
            </div>
          {/if}
        </div>

        <div class="flex flex-col gap-1">
          <label for="layer-ros" class="text-xs text-[var(--pd-content-text)]">
            {selection.sim === 'custom-template' ? 'ROS source (derived from template)' : 'ROS'}
          </label>
          <select
            id="layer-ros"
            bind:value={selection.ros}
            disabled={selection.sim === 'custom-template'}
            class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] disabled:opacity-70">
            {#each ROS_OPTIONS as o}
              <option value={o.id}>{o.label}</option>
            {/each}
          </select>
          <span class="text-xs pai-text-muted">{rosNote}</span>
        </div>

        {#if !hideTargetArch}
          <div class="flex flex-col gap-1">
            <label for="layer-target-arch" class="text-xs text-[var(--pd-content-text)]">Target architecture</label>
            <select
              id="layer-target-arch"
              bind:value={targetArch}
              class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]">
              <option value={hostArch}>This machine ({hostArch})</option>
              <option value={otherArch} disabled={selection.ros === 'ros2-lyrical' && otherArch === 'arm64'}
                >{otherArchLabel}</option>
            </select>
            <span class="text-xs text-[var(--pd-content-text)] opacity-80">
              The selected architecture controls the image platform, regardless of the tag you enter. OpenShift requires
              <span class="font-mono">amd64</span>.
            </span>
            {#if !customTemplateSupportsTarget}
              <span class="text-xs pai-text-error">
                The selected template supports {selectedCustomTemplate.architectures.join(' and ')} only. Choose a supported
                target before building.
              </span>
            {/if}
            {#if lyricalTargetUnsupported}
              <span class="text-xs" style="color: #ef4444;">
                ROS2 Lyrical uses the Fedora 43 x86_64 testing repository and requires an <span class="font-mono"
                  >amd64</span>
                target.
              </span>
            {/if}
          </div>
        {/if}
      </fieldset>
    </div>
  {/if}

  {#if !(compactPresetsQuickStart && result.level === 'ok')}
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
  {/if}

  {#if !compactPresetsQuickStart}
    <!-- Pull the layer images locally (Customize only) -->
    <div class="flex flex-col gap-2">
      <h3 class="text-sm font-medium text-[var(--pd-content-header)]">Layer images</h3>
      <p class="text-xs pai-text-muted">Pull the images this stack uses so they're available locally.</p>
      {#if pullTargets.length === 0}
        <p class="text-xs pai-text-muted">
          This preset's own base/simulation images are pulled automatically when you build below.
        </p>
      {/if}
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
                disabled={buildBusy || pulling[t.ref]}
                on:click={() => pull(t.ref)}>
                {pulling[t.ref] ? 'Pulling…' : 'Pull'}
              </button>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if !compactPresetsQuickStart}
    <div class="flex flex-col gap-1">
      <h3 class="text-sm font-medium text-[var(--pd-content-header)]">Generated Containerfile (preview)</h3>
      <pre
        class="text-xs font-mono p-3 rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] overflow-auto max-h-64">{containerfile}</pre>
    </div>
  {/if}

  <!-- Build -->
  <div class="flex flex-col gap-3">
    <div class="flex flex-col gap-1">
      <h3 class="text-sm font-medium text-[var(--pd-content-header)]">
        {compactPresetsQuickStart ? 'Simulation image' : 'Build image'}
      </h3>
      {#if compactPresetsQuickStart}
        <p class="text-xs text-[var(--pd-content-text)] opacity-80">
          One image with ROS 2 Lyrical, Gazebo, Nav2, and TurtleBot3 on Fedora bootc 43. Base layers are resolved at
          build time.
        </p>
      {/if}
    </div>
    <RegistrySelector bind:selectedRegistry={pushRegistry} disabled={buildBusy} />

    {#if buildMode === 'preset'}
      <div class="text-sm p-3 rounded pai-banner-info">
        This maps to the tested <span class="font-medium"
          >Ubuntu + ROS 2 {presetDistro} {wantsSim ? '+ Gazebo simulation' : ''}</span>
        preset — the full runnable recipe (entrypoints, worlds{wantsSim ? ', noVNC' : ''}, VirtualGL).{#if needsHardened}
          Bake-in Hummingbird tools build a separate <span class="font-medium">hardened image</span> (step 2) on top of the
          base, so the base image stays stable.{/if}
        The generated Containerfile preview above is informational for this stack.
      </div>

      <div class="flex flex-col gap-1">
        <span class="text-xs font-medium text-[var(--pd-content-text)]">1. Base image</span>
        <BuildPushPanel
          tagInputId="layer-base-tag"
          tag={presetBaseTag}
          bind:actualTag={baseTag}
          bind:busy={baseBusy}
          bind:buildLogsExpanded={baseLogsExpanded}
          active={active}
          refreshIntervalSeconds={refreshIntervalSeconds}
          tagPlaceholder="e.g. quay.io/org/ros2-base:latest"
          buildImage={t =>
            physicalAiClient.buildBaseImage(t, presetConfig, {
              layerPlan: layerCachePlanBase,
              generateSbom: selectedHbApps.includes('syft'),
              sbomFormat,
              bundledTools: [],
              isFinalArtifact: false,
            })}
          onBuildComplete={builtTag => {
            void refreshLocalImages();
            onBuildComplete?.({ watchForSbom: selectedHbApps.includes('syft'), builtTag });
          }}
          disabled={buildBusy}
          pushRegistry={pushRegistry} />
      </div>

      {#if needsHardened}
        <div class="flex flex-col gap-1">
          <span class="text-xs font-medium text-[var(--pd-content-text)]">2. Hardened image</span>
          {#if !baseImageExists}
            <p class="text-sm p-3 rounded pai-banner-warning">
              Build the base image (step 1) first — the hardened image layers on top of it.
            </p>
          {/if}
          <BuildPushPanel
            tagInputId="layer-hardened-tag"
            tag={presetHardenedTag}
            bind:actualTag={hardenedTag}
            bind:busy={hardenedBusy}
            bind:buildLogsExpanded={hardenedLogsExpanded}
            active={active}
            refreshIntervalSeconds={refreshIntervalSeconds}
            tagPlaceholder="e.g. quay.io/org/ros2-jazzy-hardened:noble"
            buildImage={t =>
              physicalAiClient.buildHardenedImage(t, presetConfig, {
                layerPlan: layerCachePlanHardened,
                hummingbirdTools: bakeInTools,
                isFinalArtifact: !wantsSim,
              })}
            onBuildComplete={builtTag => {
              void refreshLocalImages();
              onBuildComplete?.({ watchForSbom: false, builtTag });
            }}
            disabled={buildBusy || !baseImageExists}
            pushRegistry={pushRegistry} />
        </div>
      {/if}

      {#if wantsSim}
        <div class="flex flex-col gap-1">
          <span class="text-xs font-medium text-[var(--pd-content-text)]"
            >{needsHardened ? '3' : '2'}. Simulation image</span>
          {#if !simParentReady || (needsHardened && hardenedBusy)}
            <p class="text-sm p-3 rounded pai-banner-warning">
              {#if needsHardened && hardenedBusy}
                Wait for the hardened image build to finish — the simulation image must layer on top of that result, not
                an older image still tagged locally.
              {:else if needsHardened && !hardenedImageExists}
                Build the hardened image (step 2) first — the simulation image layers on top of it.
              {:else}
                Build the base image (step 1) first — the simulation image depends on it.
              {/if}
            </p>
          {/if}
          <BuildPushPanel
            tagInputId="layer-sim-tag"
            tag={presetSimTag}
            bind:actualTag={simTag}
            bind:busy={simBusy}
            bind:buildLogsExpanded={simLogsExpanded}
            active={active}
            refreshIntervalSeconds={refreshIntervalSeconds}
            tagPlaceholder="e.g. quay.io/org/ros2-sim:latest"
            buildImage={t =>
              physicalAiClient.buildSimulationImage(t, presetConfig, {
                layerPlan: layerCachePlanSim,
                parentImageTag: needsHardened ? hardenedTag : undefined,
                generateSbom: selectedHbApps.includes('syft'),
                sbomFormat,
                bundledTools: bakeInTools,
                isFinalArtifact: true,
              })}
            onBuildComplete={builtTag => {
              void refreshLocalImages();
              onBuildComplete?.({ watchForSbom: selectedHbApps.includes('syft'), builtTag });
            }}
            disabled={buildBusy || simBuildDisabled}
            pushRegistry={pushRegistry} />
        </div>
      {/if}
    {:else}
      {#if result.level === 'blocked' && !compactPresetsQuickStart}
        <label class="flex flex-row items-center gap-2 text-xs text-[var(--pd-content-text)]">
          <input type="checkbox" bind:checked={attemptAnyway} />
          Attempt anyway — I understand this is expected to fail at the {result.failsAtStep} step
        </label>
      {/if}
      {#if !compactPresetsQuickStart}
        <p class="text-xs pai-text-muted">
          Builds directly from the generated Containerfile above. It will either produce a plain image or fail for real
          at the step the verdict predicts.
        </p>
        <p class="text-xs pai-text-muted">
          Target: <span class="font-mono">{targetArch}</span>{#if targetArch !== hostArch}
            <span>
              (cross-building via QEMU on this {hostArch} host — expect a slower build; image tagged
              <span class="font-mono">-{targetArch}</span>)</span>
          {/if}
        </p>
      {/if}
      <BuildPushPanel
        tagInputId="layer-build-tag"
        tag={containerfileTag}
        bind:busy={customBuildBusy}
        active={active}
        refreshIntervalSeconds={refreshIntervalSeconds}
        tagPlaceholder="e.g. quay.io/org/custom-layer:latest"
        buildImage={t =>
          physicalAiClient.buildFromContainerfile(t, containerfile, platformForArch(targetArch), {
            generateSbom: selectedHbApps.includes('syft'),
            sbomFormat,
            bundledTools: bakeInTools,
            isFinalArtifact: true,
            layerPlan: layerCachePlan,
            bundleSimRuntime: selectionNeedsBundledSimRuntime(selection),
            simRuntimeAssetDir: managedSimBundleAssetDir(selection),
            verifyHooks: managedSimVerifyHooks(selection),
          })}
        onBuildComplete={builtTag => {
          void refreshLocalImages();
          onBuildComplete?.({ watchForSbom: selectedHbApps.includes('syft'), builtTag });
        }}
        disabled={buildDisabled}
        pushRegistry={pushRegistry} />
    {/if}
  </div>
</div>
