<script lang="ts">
import { physicalAiClient } from './api/client';
import { onMount, onDestroy } from 'svelte';
import { simulationImageTag } from '/@shared/src/types/SimulationProfiles';
import { DEFAULT_GPU_TOLERATION } from '/@shared/src/openshift/manifests';
import type { SimulationConfig } from '/@shared/src/types/SimulationConfig';
import type { OpenShiftContext, OpenShiftDeployResult, OpenShiftWorkload } from '/@shared/src/types/OpenShiftDeploy';
import RobotControls, { type RobotEntry } from './RobotControls.svelte';

let loading = true;
let context: OpenShiftContext | undefined = undefined;

let name = 'ros2-jazzy-sim';
/** Seeded from the current kube context's namespace on mount (see onMount); editable.
 * Falls back to the physical-ai.defaultOpenShiftNamespace setting when the context sets
 * none, or sets it to the generic 'default' project (S8-16), instead of silently landing
 * on 'default'. */
let namespace = '';
/** Every context available in the kubeconfig (S8-10), for the cluster picker. */
let kubeContexts: { name: string; clusterUrl?: string; namespace?: string }[] = [];
/**
 * Context name to deploy into and target with every cluster operation (S8-10) — defaults
 * to the kubeconfig's current-context on mount, editable via the Cluster picker.
 * Switching it re-seeds namespace/login status and refreshes the workload list for the
 * newly selected cluster (see onContextChange).
 */
let selectedContext = '';
let loggedIn = true;
let loginMessage = '';
let image = 'quay.io/ecosystem-appeng/ros2-jazzy-sim:noble-amd64';
let useGpu = false;
/**
 * Guaranteed CPU count for the software-render pod; dial to your node sizes.
 * Seeded from the physical-ai.defaultSoftwareRenderCpus setting on mount, then
 * editable per deploy.
 */
let cpu = 8;
/**
 * Taint the GPU pod must tolerate to land on a GPU node (`key[=value][:effect]`).
 * GPU MachineSets commonly taint their nodes; without this the pod sits Pending.
 * Only sent when GPU is enabled.
 */
let gpuToleration = DEFAULT_GPU_TOLERATION;

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
/** Workload names already reconciled against actually-running robots (S8-17) — a
 * ready workload is probed at most once; cleared when its robot state is dropped
 * (deleted or vanished from the list) so a later redeploy of the same name reconciles
 * fresh instead of being skipped forever. */
let reconciledWorkloads = new Set<string>();
let warmTimer: ReturnType<typeof setInterval> | null = null;

$: config = {
  name,
  namespace,
  image,
  useGpu,
  cpu,
  gpuToleration: useGpu ? gpuToleration : undefined,
  context: selectedContext || undefined,
};
$: canDeploy = !!context && !!name && !!namespace && !!image && !deploying && loggedIn;

/**
 * Seeds `namespace` from a context's namespace, applying the same "'default' means
 * unbound" + configured-fallback logic (S8-16) whether it's the initial context on
 * mount or a cluster the user just switched to (onContextChange) — `oc login`
 * commonly sets `namespace: default` explicitly even when the user hasn't picked a
 * real project (`oc project <ns>`), so treating it as a real signal defeats the
 * fallback entirely for the exact case it was meant to fix.
 */
async function seedNamespaceFromContext(ctxNamespace: string | undefined) {
  if (ctxNamespace && ctxNamespace !== 'default') {
    namespace = ctxNamespace;
    return;
  }
  try {
    const fallback = await physicalAiClient.getDefaultOpenShiftNamespace();
    namespace = fallback || ctxNamespace || namespace;
  } catch {
    namespace = ctxNamespace || namespace;
  }
}

/** Pre-check oc login (S8-11) for the selected context, so Deploy/Spawn fail early
 * with a clear message instead of a confusing mid-deploy oc error. */
async function refreshLoginStatus() {
  try {
    const login = await physicalAiClient.checkOpenShiftLogin(selectedContext || undefined);
    loggedIn = login.loggedIn;
    loginMessage = login.message ?? '';
  } catch {
    // Fail open — don't block the UI if the check itself errors unexpectedly; the
    // deploy/oc calls themselves will still surface a clear error if not logged in.
    loggedIn = true;
    loginMessage = '';
  }
}

/** Re-seed namespace/login status and refresh the workload list for the cluster the
 * user just picked from the Cluster dropdown (S8-10). */
async function onContextChange() {
  const entry = kubeContexts.find(c => c.name === selectedContext);
  await seedNamespaceFromContext(entry?.namespace);
  await refreshLoginStatus();
  await refreshWorkloads();
}

onMount(async () => {
  try {
    context = await physicalAiClient.getOpenShiftContext();
    if (context) selectedContext = context.context;
    await seedNamespaceFromContext(context?.namespace);
  } catch {
    context = undefined;
  }
  try {
    kubeContexts = await physicalAiClient.listKubeContexts();
  } catch {
    kubeContexts = [];
  }
  await refreshLoginStatus();
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
  // Auto-refresh the deployment list + robot warm-status so a newly-ready
  // deployment reveals its Robots section without a manual Refresh click.
  warmTimer = setInterval(async () => {
    await refreshWorkloads({ silent: true });
    await pollWarmStatus();
  }, 3000);
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

/**
 * Refresh the deployed-workloads list. `silent` (used by the auto-refresh timer)
 * skips the busy indicator and, on a transient error, keeps the last-known list
 * instead of clearing it — so the periodic poll never flickers the UI.
 */
async function refreshWorkloads(opts?: { silent?: boolean }) {
  const silent = opts?.silent ?? false;
  if (!namespace) {
    workloads = [];
    return;
  }
  if (!silent) {
    listBusy = true;
    listError = '';
  }
  try {
    workloads = await physicalAiClient.listOpenShiftDeployments(namespace, selectedContext || undefined);
    listError = '';
    // Drop robot state for deployments that no longer exist; seed the rest.
    const names = new Set(workloads.map(w => w.name));
    for (const key of Object.keys(robotsByWorkload)) {
      if (!names.has(key)) {
        delete robotsByWorkload[key];
        reconciledWorkloads.delete(key);
      }
    }
    for (const w of workloads) {
      robotsByWorkload[w.name] ??= [];
      // Reconcile a ready workload's actually-running robots (S8-17) at most once —
      // pollWarmStatus's existing 3s loop already picks up warmStatus for whatever
      // ends up in robotsByWorkload, so no extra polling wire-up is needed here.
      if (w.ready && !reconciledWorkloads.has(w.name)) {
        reconciledWorkloads.add(w.name);
        void reconcileRobots(w);
      }
    }
    robotsByWorkload = robotsByWorkload;
    // Drop a stale result panel if its deployment is gone.
    if (deployedName && !names.has(deployedName)) {
      deployResult = null;
      deployedName = '';
    }
  } catch (e) {
    if (!silent) {
      listError = e instanceof Error ? e.message : 'Failed to list deployments';
      workloads = [];
    }
    // silent: keep the last-known list; a transient oc hiccup shouldn't blank the UI.
  } finally {
    if (!silent) listBusy = false;
  }
}

/**
 * Reconciles a ready workload's robot list against what's actually running in the pod
 * (S8-17) — spawn/warm state otherwise lives only in frontend memory, so a page reload
 * or extension restart forgets robots spawned earlier even though they're still
 * running. Only ever appends missing entries — never removes/overwrites ones already
 * tracked, so it can't clobber live navStatus/navTarget state.
 */
async function reconcileRobots(w: OpenShiftWorkload) {
  let names: string[];
  try {
    names = await physicalAiClient.listSpawnedRobotsInOpenShift(w.namespace, w.name, selectedContext || undefined);
  } catch {
    return;
  }
  const existing = new Set((robotsByWorkload[w.name] ?? []).map(r => r.name));
  const missing = names.filter(n => !existing.has(n));
  if (missing.length === 0) return;
  robotsByWorkload[w.name] = [
    ...(robotsByWorkload[w.name] ?? []),
    // x/y aren't recoverable from `ros2 node list` alone — '?' is a placeholder.
    ...missing.map(n => ({
      name: n,
      x: '?',
      y: '?',
      navStatus: 'idle' as const,
      navTarget: { x: '0', y: '0' },
      navReached: null,
    })),
  ];
  robotsByWorkload = robotsByWorkload;
}

async function remove(w: OpenShiftWorkload) {
  deletingName = w.name;
  try {
    await physicalAiClient.deleteOpenShiftDeployment(w.namespace, w.name, selectedContext || undefined);
    // Clear this deployment's robot list and the stale result panel.
    delete robotsByWorkload[w.name];
    reconciledWorkloads.delete(w.name);
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
  await physicalAiClient.spawnRobotInOpenShift(
    w.namespace,
    w.name,
    form.name,
    form.x,
    form.y,
    form.yaw,
    selectedContext || undefined,
  );
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
      selectedContext || undefined,
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
  await physicalAiClient.despawnRobotInOpenShift(w.namespace, w.name, robot.name, selectedContext || undefined);
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
        <div class="text-xs text-[var(--pd-content-text)] flex flex-col gap-2">
          <div><strong>Context:</strong> <span class="font-mono break-all">{context.context}</span></div>
          <div class="opacity-70 font-mono break-all">{context.kubeconfigPath}</div>
          <div class="flex flex-col gap-1">
            <label for="dep-cluster-url" class="text-xs text-[var(--pd-content-text)]">Cluster URL</label>
            <select
              id="dep-cluster-url"
              bind:value={selectedContext}
              on:change={onContextChange}
              disabled={deploying}
              class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] font-mono">
              {#each kubeContexts as ctx}
                <option value={ctx.name}>{ctx.clusterUrl ?? ctx.name}</option>
              {/each}
            </select>
          </div>
        </div>
      {:else}
        <p class="text-sm p-3 rounded pai-banner-error">
          No current Kubernetes/OpenShift context found. Log in first (e.g. <span class="font-mono">oc login</span>),
          then reopen this page.
        </p>
      {/if}
    </div>

    {#if context && !loggedIn}
      <p class="text-sm p-3 rounded pai-banner-error max-w-2xl">{loginMessage}</p>
    {/if}

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
          on:change={() => refreshWorkloads()}
          disabled={deploying}
          placeholder="e.g. my-project"
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

      {#if useGpu}
        <div class="flex flex-col gap-1">
          <label for="dep-gpu-tol" class="text-xs text-[var(--pd-content-text)]">GPU node taint toleration</label>
          <input
            id="dep-gpu-tol"
            bind:value={gpuToleration}
            disabled={deploying}
            class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] font-mono" />
          <span class="text-xs pai-text-muted">
            <span class="font-mono">key[=value][:effect]</span> — GPU nodes are usually tainted so only GPU workloads
            land there; without a matching toleration the pod stays Pending. Default
            <span class="font-mono">{DEFAULT_GPU_TOLERATION}</span>; a bare <span class="font-mono">key:effect</span>
            tolerates it via <span class="font-mono">Exists</span>.
          </span>
        </div>
      {/if}

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
        <button on:click={() => refreshWorkloads()} disabled={listBusy || !namespace} class="pai-btn text-sm">
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
                    disabled={!loggedIn}
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
