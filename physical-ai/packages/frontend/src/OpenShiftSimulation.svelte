<script lang="ts">
import { physicalAiClient } from './api/client';
import { onMount, onDestroy } from 'svelte';
import { simulationImageTag } from '/@shared/src/types/SimulationProfiles';
import type { SimulationConfig } from '/@shared/src/types/SimulationConfig';
import type { OpenShiftContext, OpenShiftDeployResult, OpenShiftWorkload } from '/@shared/src/types/OpenShiftDeploy';
import RobotControls, { type RobotEntry } from './RobotControls.svelte';

let loading = true;
let context: OpenShiftContext | undefined = undefined;

let name = 'ros2-jazzy-sim';
let namespace = 'sgahlot-pd-extn';
let image = 'quay.io/ecosystem-appeng/ros2-jazzy-sim:noble-amd64';
let useGpu = false;
/**
 * Guaranteed CPU count for the software-render pod; dial to your node sizes.
 * Seeded from the physical-ai.defaultSoftwareRenderCpus setting on mount, then
 * editable per deploy.
 */
let cpu = 8;

let previewYaml = '';
let previewBusy = false;
let previewError = '';
let showPreview = true;

let deploying = false;
let deployError = '';
let deployResult: OpenShiftDeployResult | null = null;
/** Name the current deployResult refers to, so we can drop the panel when it's deleted. */
let deployedName = '';

let workloads: OpenShiftWorkload[] = [];
let listBusy = false;
let listError = '';
let deletingName = '';

// --- In-cluster robot spawn + Nav2, keyed by deployment name ---
let robotsByWorkload: Record<string, RobotEntry[]> = {};
let warmTimer: ReturnType<typeof setInterval> | null = null;

$: config = { name, namespace, image, useGpu, cpu };
$: canDeploy = !!context && !!name && !!namespace && !!image && !deploying;

onMount(async () => {
  try {
    context = await physicalAiClient.getOpenShiftContext();
  } catch {
    context = undefined;
  }
  // Seed the CPU field from the configurable default (still editable per deploy).
  try {
    cpu = await physicalAiClient.getDefaultSoftwareRenderCpus();
  } catch {
    // keep the built-in default
  }
  // Default the image to the current sim config's amd64 tag, when resolvable.
  try {
    const ns = await physicalAiClient.getDefaultNamespace();
    const simConfig = await physicalAiClient.getSimulationConfig();
    const amd64Config = { ...simConfig, targetArch: 'amd64' } as SimulationConfig;
    const tag = simulationImageTag(ns, amd64Config);
    if (tag) image = tag;
  } catch {
    // keep the placeholder default
  }
  loading = false;
  refreshWorkloads();
  warmTimer = setInterval(pollWarmStatus, 3000);
});

onDestroy(() => {
  if (warmTimer) clearInterval(warmTimer);
});

/** Poll Nav2 pre-warm state for robots still warming across all deployments. */
async function pollWarmStatus() {
  let changed = false;
  for (const [wname, robots] of Object.entries(robotsByWorkload)) {
    for (let i = 0; i < robots.length; i++) {
      const robot = robots[i];
      // 'ready'/'failed' are terminal until re-spawn — skip to save exec calls.
      if (robot.warmStatus === 'ready' || robot.warmStatus === 'failed') continue;
      try {
        const status = await physicalAiClient.getRobotWarmStatusInOpenShift(namespace, wname, robot.name);
        if (status !== robot.warmStatus) {
          robots[i] = { ...robot, warmStatus: status };
          changed = true;
        }
      } catch {
        // ignore — keep the last known warm status
      }
    }
  }
  if (changed) robotsByWorkload = robotsByWorkload;
}

async function openRoute(url: string | undefined) {
  if (!url) return;
  try {
    await physicalAiClient.openUrlInBrowser(url);
  } catch (e) {
    listError = e instanceof Error ? e.message : 'Failed to open route';
  }
}

async function preview() {
  previewBusy = true;
  previewError = '';
  try {
    const res = await physicalAiClient.generateOpenShiftManifests(config);
    previewYaml = res.yaml;
    showPreview = true;
  } catch (e) {
    previewError = e instanceof Error ? e.message : 'Failed to render manifests';
    previewYaml = '';
  } finally {
    previewBusy = false;
  }
}

async function deploy() {
  deploying = true;
  deployError = '';
  deployResult = null;
  try {
    deployResult = await physicalAiClient.deployToOpenShift(config);
    deployedName = name;
    await refreshWorkloads();
  } catch (e) {
    deployError = e instanceof Error ? e.message : 'Deploy failed';
  } finally {
    deploying = false;
  }
}

async function refreshWorkloads() {
  if (!namespace) {
    workloads = [];
    return;
  }
  listBusy = true;
  listError = '';
  try {
    workloads = await physicalAiClient.listOpenShiftDeployments(namespace);
    // Drop robot state for deployments that no longer exist; seed the rest.
    const names = new Set(workloads.map(w => w.name));
    for (const key of Object.keys(robotsByWorkload)) {
      if (!names.has(key)) delete robotsByWorkload[key];
    }
    for (const w of workloads) {
      robotsByWorkload[w.name] ??= [];
    }
    robotsByWorkload = robotsByWorkload;
  } catch (e) {
    listError = e instanceof Error ? e.message : 'Failed to list deployments';
    workloads = [];
  } finally {
    listBusy = false;
  }
}

async function remove(w: OpenShiftWorkload) {
  deletingName = w.name;
  try {
    await physicalAiClient.deleteOpenShiftDeployment(w.namespace, w.name);
    // Clear this deployment's robot list and the stale result panel.
    delete robotsByWorkload[w.name];
    robotsByWorkload = robotsByWorkload;
    if (deployedName === w.name) {
      deployResult = null;
      deployedName = '';
    }
    await refreshWorkloads();
  } catch (e) {
    listError = e instanceof Error ? e.message : 'Failed to delete';
  } finally {
    deletingName = '';
  }
}

async function spawnRobot(w: OpenShiftWorkload, form: { name: string; x: string; y: string; yaw: string }) {
  await physicalAiClient.spawnRobotInOpenShift(w.namespace, w.name, form.name, form.x, form.y, form.yaw);
  robotsByWorkload[w.name] = [
    ...(robotsByWorkload[w.name] ?? []),
    {
      name: form.name,
      x: form.x,
      y: form.y,
      navStatus: 'idle',
      navTarget: { x: '2.0', y: '0.5' },
      navReached: null,
      // Backend pre-warms Nav2 for Jazzy only; show "warming…" optimistically there.
      warmStatus: w.image?.includes('jazzy') ? 'warming' : undefined,
    },
  ];
  robotsByWorkload = robotsByWorkload;
}

async function navigateRobot(w: OpenShiftWorkload, index: number) {
  const robots = robotsByWorkload[w.name];
  const robot = robots?.[index];
  if (!robot) return;
  const snapshot = { x: robot.navTarget.x, y: robot.navTarget.y };
  robots[index] = { ...robot, navStatus: 'navigating', navReached: null };
  robotsByWorkload = robotsByWorkload;
  try {
    const result = await physicalAiClient.sendOpenShiftNavigationGoal(
      w.namespace,
      w.name,
      robot.name,
      Number(robot.navTarget.x),
      Number(robot.navTarget.y),
    );
    robots[index] = {
      ...robots[index],
      navStatus: result.status === 'reached' ? 'reached' : 'failed',
      navReached: snapshot,
    };
  } catch {
    robots[index] = { ...robots[index], navStatus: 'failed', navReached: snapshot };
  }
  robotsByWorkload = robotsByWorkload;
}

async function removeRobot(w: OpenShiftWorkload, index: number) {
  const robots = robotsByWorkload[w.name];
  const robot = robots?.[index];
  if (!robot) return;
  await physicalAiClient.despawnRobotInOpenShift(w.namespace, w.name, robot.name);
  robotsByWorkload[w.name] = robots.filter((_, i) => i !== index);
  robotsByWorkload = robotsByWorkload;
}
</script>

<div class="flex flex-col gap-4">
  <p class="text-sm text-[var(--pd-content-text)]">
    Deploy a simulation image (Gazebo + noVNC) to your current OpenShift cluster and reach it via a Route, then spawn
    and navigate robots in it. Build an <span class="font-mono">amd64</span> image first from the Image Builder.
  </p>

  {#if loading}
    <div class="text-sm text-[var(--pd-content-text)]">Loading…</div>
  {:else}
    <!-- Cluster context -->
    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 max-w-2xl">
      <h2 class="text-sm font-medium text-[var(--pd-content-header)] mb-2">Cluster</h2>
      {#if context}
        <div class="text-xs text-[var(--pd-content-text)] flex flex-col gap-1">
          <div><strong>Context:</strong> <span class="font-mono break-all">{context.context}</span></div>
          <div class="opacity-70 font-mono break-all">{context.kubeconfigPath}</div>
        </div>
      {:else}
        <p class="text-sm p-3 rounded pai-banner-error">
          No current Kubernetes/OpenShift context found. Log in first (e.g. <span class="font-mono">oc login</span>),
          then reopen this page.
        </p>
      {/if}
    </div>

    <!-- Deploy form -->
    <div class="flex flex-col gap-4 max-w-2xl">
      <div class="flex flex-col gap-1">
        <label for="dep-name" class="text-xs text-[var(--pd-content-text)]">Name</label>
        <input
          id="dep-name"
          bind:value={name}
          disabled={deploying}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] font-mono" />
        <span class="text-xs pai-text-muted">Used for the Deployment, Service and Route (DNS-1123 label).</span>
      </div>

      <div class="flex flex-col gap-1">
        <label for="dep-ns" class="text-xs text-[var(--pd-content-text)]">Project / namespace</label>
        <input
          id="dep-ns"
          bind:value={namespace}
          on:change={refreshWorkloads}
          disabled={deploying}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] font-mono" />
      </div>

      <div class="flex flex-col gap-1">
        <label for="dep-image" class="text-xs text-[var(--pd-content-text)]">Image (amd64, cluster-pullable)</label>
        <input
          id="dep-image"
          bind:value={image}
          disabled={deploying}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] font-mono" />
        <span class="text-xs pai-text-muted">e.g. quay.io/&lt;ns&gt;/ros2-jazzy-sim:noble-amd64</span>
      </div>

      <div class="flex flex-col gap-1">
        <label class="flex flex-row items-center gap-2 text-sm text-[var(--pd-content-text)]">
          <input type="checkbox" bind:checked={useGpu} disabled={deploying} />
          Cluster has a GPU (NVIDIA GPU operator)
        </label>
        <span class="text-xs pai-text-muted">
          On: request <span class="font-mono">nvidia.com/gpu</span> and use hardware rendering. Off (default): software rendering
          (llvmpipe + headless EGL), safe for a no-GPU cluster.
        </span>
      </div>

      <div class="flex flex-col gap-1">
        <label for="dep-cpu" class="text-xs text-[var(--pd-content-text)]">Software-render CPUs</label>
        <input
          id="dep-cpu"
          type="number"
          min="1"
          max="64"
          step="1"
          bind:value={cpu}
          disabled={deploying || useGpu}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] font-mono w-24" />
        <span class="text-xs pai-text-muted">
          Guaranteed CPUs (requests == limits) for the pod. Seeded from Preferences (Default software-render CPUs); dial
          to your node sizes — an N-CPU pod only schedules on nodes with &ge; N allocatable. Ignored when GPU is on.
        </span>
      </div>

      <div class="flex flex-row items-center gap-3 mt-2">
        <button on:click={preview} disabled={previewBusy || !name || !namespace || !image} class="pai-btn">
          {previewBusy ? 'Rendering…' : 'Preview manifests'}
        </button>
        <button on:click={deploy} disabled={!canDeploy} class="pai-btn pai-btn-primary">
          {deploying ? 'Deploying…' : 'Deploy'}
        </button>
      </div>

      {#if previewError}
        <span class="text-sm pai-text-error">{previewError}</span>
      {/if}
      {#if deployError}
        <span class="text-sm pai-text-error">{deployError}</span>
      {/if}

      {#if deployResult}
        <div class="text-sm p-3 rounded pai-banner-success flex flex-col gap-1">
          <div>{deployResult.message}</div>
          <div class="text-xs opacity-80">Applied: {deployResult.applied.join(', ')}</div>
          {#if deployResult.routeUrl}
            <button on:click={() => openRoute(deployResult?.routeUrl)} class="pai-link self-start">
              Open {deployResult.routeUrl}
            </button>
          {/if}
        </div>
      {/if}
    </div>

    {#if previewYaml}
      <div class="max-w-2xl">
        <div class="flex flex-row items-center gap-2 mb-2">
          <h2 class="text-sm font-medium text-[var(--pd-content-header)]">Manifest preview</h2>
          <button on:click={() => (showPreview = !showPreview)} class="pai-btn pai-btn-sm text-xs">
            {showPreview ? 'Hide' : 'Show'}
          </button>
        </div>
        {#if showPreview}
          <pre
            class="text-xs font-mono p-3 rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] overflow-auto max-h-96 whitespace-pre">{previewYaml}</pre>
        {/if}
      </div>
    {/if}

    <hr class="border-[var(--pd-content-card-border)] my-2" />

    <!-- Deployed workloads -->
    <div class="max-w-2xl flex flex-col gap-2">
      <div class="flex flex-row items-center gap-3">
        <h2 class="text-xl text-[var(--pd-content-header)]">Deployed simulations</h2>
        <button on:click={refreshWorkloads} disabled={listBusy || !namespace} class="pai-btn text-sm">
          {listBusy ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {#if listError}
        <span class="text-sm pai-text-error">{listError}</span>
      {/if}

      {#if workloads.length === 0}
        <p class="text-sm pai-text-muted">
          No physical-ai deployments in <span class="font-mono">{namespace}</span> yet.
        </p>
      {:else}
        <div class="flex flex-col gap-2">
          {#each workloads as w (w.name)}
            <div
              class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-3 flex flex-col gap-1">
              <div class="flex flex-row items-center justify-between gap-3">
                <div class="font-medium text-[var(--pd-content-header)] font-mono">{w.name}</div>
                <div class="flex flex-row items-center gap-2">
                  <span class="text-xs {w.ready ? 'pai-text-success' : 'pai-text-warning'}">
                    {w.readyReplicas}/{w.replicas} ready
                  </span>
                  <button
                    on:click={() => remove(w)}
                    disabled={deletingName === w.name}
                    class="pai-btn pai-btn-danger text-xs">
                    {deletingName === w.name ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
              {#if w.image}
                <div class="text-xs font-mono opacity-70 break-all">{w.image}</div>
              {/if}
              {#if w.routeUrl}
                <button
                  on:click={() => openRoute(w.routeUrl)}
                  class="pai-link pai-link-sm self-start break-all text-left">
                  Open {w.routeUrl}
                </button>
              {:else}
                <span class="text-xs pai-text-muted">Route not admitted yet.</span>
              {/if}

              <!-- In-cluster robot spawn + Nav2 -->
              {#if w.ready}
                <div class="mt-2 pt-2 border-t border-[var(--pd-content-card-border)] flex flex-col gap-2">
                  <div class="text-xs font-medium text-[var(--pd-content-header)]">Robots</div>
                  <RobotControls
                    robots={robotsByWorkload[w.name] ?? []}
                    onSpawn={form => spawnRobot(w, form)}
                    onNavigate={i => navigateRobot(w, i)}
                    onRemove={i => removeRobot(w, i)}
                    idPrefix={`oc-${w.name}`} />
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
