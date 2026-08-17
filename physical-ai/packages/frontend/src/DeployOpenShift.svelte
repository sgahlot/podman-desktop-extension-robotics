<script lang="ts">
import { physicalAiClient } from './api/client';
import { onMount } from 'svelte';
import { router } from 'tinro';
import { simulationImageTag } from '/@shared/src/types/SimulationProfiles';
import type { SimulationConfig } from '/@shared/src/types/SimulationConfig';
import type { OpenShiftContext, OpenShiftDeployResult, OpenShiftWorkload } from '/@shared/src/types/OpenShiftDeploy';

let loading = true;
let context: OpenShiftContext | undefined = undefined;

let name = 'ros2-jazzy-sim';
let namespace = 'sgahlot-pd-extn';
let image = 'quay.io/ecosystem-appeng/ros2-jazzy-sim:noble-amd64';
let useGpu = false;

let previewYaml = '';
let previewBusy = false;
let previewError = '';

let deploying = false;
let deployError = '';
let deployResult: OpenShiftDeployResult | null = null;

let workloads: OpenShiftWorkload[] = [];
let listBusy = false;
let listError = '';
let deletingName = '';

// --- In-cluster robot spawn + Nav2, keyed by deployment name ---
type OcSpawnedRobot = {
  name: string;
  x: string;
  y: string;
  navStatus: 'idle' | 'navigating' | 'reached' | 'failed';
  navTarget: { x: string; y: string };
};
type SpawnForm = { name: string; x: string; y: string; yaw: string; counter: number };
let robotsByWorkload: Record<string, OcSpawnedRobot[]> = {};
let spawnFormByWorkload: Record<string, SpawnForm> = {};
let spawnBusy: Record<string, boolean> = {};
let spawnError: Record<string, string> = {};
let removingRobot: Record<string, boolean> = {};

function newSpawnForm(): SpawnForm {
  return { name: 'robot_1', x: '-2.0', y: '-0.5', yaw: '0.0', counter: 1 };
}

$: config = { name, namespace, image, useGpu };
$: canDeploy = !!context && !!name && !!namespace && !!image && !deploying;

onMount(async () => {
  try {
    context = await physicalAiClient.getOpenShiftContext();
  } catch {
    context = undefined;
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
});

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
    for (const w of workloads) {
      spawnFormByWorkload[w.name] ??= newSpawnForm();
      robotsByWorkload[w.name] ??= [];
    }
    spawnFormByWorkload = spawnFormByWorkload;
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
    await refreshWorkloads();
  } catch (e) {
    listError = e instanceof Error ? e.message : 'Failed to delete';
  } finally {
    deletingName = '';
  }
}

async function spawnRobot(w: OpenShiftWorkload) {
  const form = spawnFormByWorkload[w.name];
  if (!form) return;
  spawnBusy[w.name] = true;
  spawnError[w.name] = '';
  spawnBusy = spawnBusy;
  spawnError = spawnError;
  try {
    await physicalAiClient.spawnRobotInOpenShift(w.namespace, w.name, form.name, form.x, form.y, form.yaw);
    const robots = robotsByWorkload[w.name] ?? [];
    robots.push({
      name: form.name,
      x: form.x,
      y: form.y,
      navStatus: 'idle',
      navTarget: { x: '2.0', y: '0.5' },
    });
    robotsByWorkload[w.name] = robots;
    robotsByWorkload = robotsByWorkload;
    form.counter += 1;
    form.name = `robot_${form.counter}`;
    spawnFormByWorkload = spawnFormByWorkload;
  } catch (e) {
    spawnError[w.name] = e instanceof Error ? e.message : 'Spawn failed';
    spawnError = spawnError;
  } finally {
    spawnBusy[w.name] = false;
    spawnBusy = spawnBusy;
  }
}

async function removeRobot(w: OpenShiftWorkload, index: number) {
  const robots = robotsByWorkload[w.name];
  const robot = robots?.[index];
  if (!robot) return;
  const key = `${w.name}:${robot.name}`;
  removingRobot[key] = true;
  removingRobot = removingRobot;
  spawnError[w.name] = '';
  spawnError = spawnError;
  try {
    await physicalAiClient.despawnRobotInOpenShift(w.namespace, w.name, robot.name);
    robotsByWorkload[w.name] = robots.filter((_, i) => i !== index);
    robotsByWorkload = robotsByWorkload;
  } catch (e) {
    spawnError[w.name] = e instanceof Error ? e.message : 'Remove failed';
    spawnError = spawnError;
  } finally {
    removingRobot[key] = false;
    removingRobot = removingRobot;
  }
}

async function navigateRobot(w: OpenShiftWorkload, index: number) {
  const robots = robotsByWorkload[w.name];
  const robot = robots?.[index];
  if (!robot) return;
  robot.navStatus = 'navigating';
  robotsByWorkload = robotsByWorkload;
  try {
    const result = await physicalAiClient.sendOpenShiftNavigationGoal(
      w.namespace,
      w.name,
      robot.name,
      Number(robot.navTarget.x),
      Number(robot.navTarget.y),
    );
    robot.navStatus = result.status === 'reached' ? 'reached' : 'failed';
  } catch {
    robot.navStatus = 'failed';
  } finally {
    robotsByWorkload = robotsByWorkload;
  }
}
</script>

<div class="flex flex-col p-4 gap-4 h-full overflow-auto">
  <button on:click={() => router.goto('/')} class="pai-link self-start"> &larr; Back to Dashboard </button>
  <h1 class="text-3xl text-[var(--pd-content-header)]">Deploy to OpenShift</h1>
  <p class="text-sm text-[var(--pd-content-text)]">
    Deploy a simulation image (Gazebo + noVNC) to your current OpenShift cluster and reach it via a Route. Build an <span
      class="font-mono">amd64</span> image first from the Image Builder.
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
        <h2 class="text-sm font-medium text-[var(--pd-content-header)] mb-2">Manifest preview</h2>
        <pre
          class="text-xs font-mono p-3 rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] overflow-auto max-h-96 whitespace-pre">{previewYaml}</pre>
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
              {#if w.ready && spawnFormByWorkload[w.name]}
                <div class="mt-2 pt-2 border-t border-[var(--pd-content-card-border)] flex flex-col gap-2">
                  <div class="text-xs font-medium text-[var(--pd-content-header)]">Robots</div>

                  <div class="flex flex-row flex-wrap items-end gap-2">
                    <div class="flex flex-col gap-1">
                      <label for="rn-{w.name}" class="text-xs pai-text-muted">Name</label>
                      <input
                        id="rn-{w.name}"
                        bind:value={spawnFormByWorkload[w.name].name}
                        disabled={spawnBusy[w.name]}
                        class="w-28 px-2 py-1 text-xs rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] font-mono" />
                    </div>
                    <div class="flex flex-col gap-1">
                      <label for="rx-{w.name}" class="text-xs pai-text-muted">X</label>
                      <input
                        id="rx-{w.name}"
                        bind:value={spawnFormByWorkload[w.name].x}
                        disabled={spawnBusy[w.name]}
                        class="w-16 px-2 py-1 text-xs rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] font-mono" />
                    </div>
                    <div class="flex flex-col gap-1">
                      <label for="ry-{w.name}" class="text-xs pai-text-muted">Y</label>
                      <input
                        id="ry-{w.name}"
                        bind:value={spawnFormByWorkload[w.name].y}
                        disabled={spawnBusy[w.name]}
                        class="w-16 px-2 py-1 text-xs rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] font-mono" />
                    </div>
                    <div class="flex flex-col gap-1">
                      <label for="ryaw-{w.name}" class="text-xs pai-text-muted">Yaw</label>
                      <input
                        id="ryaw-{w.name}"
                        bind:value={spawnFormByWorkload[w.name].yaw}
                        disabled={spawnBusy[w.name]}
                        class="w-16 px-2 py-1 text-xs rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] font-mono" />
                    </div>
                    <button
                      on:click={() => spawnRobot(w)}
                      disabled={spawnBusy[w.name] || !spawnFormByWorkload[w.name].name}
                      class="pai-btn text-xs">
                      {spawnBusy[w.name] ? 'Spawning…' : 'Spawn'}
                    </button>
                  </div>

                  {#if spawnError[w.name]}
                    <span class="text-xs pai-text-error">{spawnError[w.name]}</span>
                  {/if}

                  {#if (robotsByWorkload[w.name] ?? []).length > 0}
                    <div class="flex flex-col gap-1">
                      {#each robotsByWorkload[w.name] as robot, i (robot.name)}
                        <div class="flex flex-row flex-wrap items-center gap-2 text-xs">
                          <span class="font-mono text-[var(--pd-content-header)] w-24 truncate">{robot.name}</span>
                          <span class="pai-text-muted">→</span>
                          <input
                            aria-label="target X for {robot.name}"
                            bind:value={robot.navTarget.x}
                            disabled={robot.navStatus === 'navigating'}
                            class="w-14 px-2 py-1 rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] font-mono" />
                          <input
                            aria-label="target Y for {robot.name}"
                            bind:value={robot.navTarget.y}
                            disabled={robot.navStatus === 'navigating'}
                            class="w-14 px-2 py-1 rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] font-mono" />
                          <button
                            on:click={() => navigateRobot(w, i)}
                            disabled={robot.navStatus === 'navigating'}
                            class="pai-btn text-xs">Navigate</button>
                          <button
                            on:click={() => removeRobot(w, i)}
                            disabled={removingRobot[`${w.name}:${robot.name}`] || robot.navStatus === 'navigating'}
                            class="pai-btn pai-btn-danger text-xs">
                            {removingRobot[`${w.name}:${robot.name}`] ? 'Removing…' : 'Remove'}
                          </button>
                          <span
                            class={robot.navStatus === 'reached'
                              ? 'pai-text-success'
                              : robot.navStatus === 'failed'
                                ? 'pai-text-error'
                                : robot.navStatus === 'navigating'
                                  ? 'pai-text-accent'
                                  : 'pai-text-muted'}>
                            {robot.navStatus === 'navigating'
                              ? 'Navigating…'
                              : robot.navStatus === 'reached'
                                ? 'Reached'
                                : robot.navStatus === 'failed'
                                  ? 'Failed'
                                  : 'Idle'}
                          </span>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
