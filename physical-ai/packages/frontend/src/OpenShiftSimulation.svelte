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
 * Projects/namespaces visible on the targeted cluster (S8-21), for the Project/namespace
 * field's type-to-filter combobox. Empty when listing fails (not logged in, `oc`
 * missing) — the field still works as free-text in that case, it just has no suggestions.
 */
let openShiftProjects: string[] = [];
/**
 * Custom combobox state for the Project/namespace field (S8-21). A native
 * `<input list>`/`<datalist>` renders misaligned and with an uncontrollable height in
 * the Podman Desktop (Electron) webview, so suggestions are rendered as a positioned,
 * height-capped menu instead (see the field markup below).
 */
let namespaceMenuOpen = false;
/** Index into `filteredProjects` for keyboard nav; -1 means nothing highlighted. */
let namespaceHighlight = -1;
/** Delays closing the menu on blur just long enough for a click on an option (which
 * blurs the input first) to register as a click before the menu unmounts. */
let namespaceBlurTimeout: ReturnType<typeof setTimeout> | undefined;
/** Whether to include OpenShift/Kubernetes system & default namespaces in the
 * Project/namespace suggestion list (S8-21); off by default to cut noise. Toggled via
 * the "Show system projects" checkbox, only rendered when at least one is present. */
let showSystemProjects = false;
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
/** Consecutive-miss counters for prune debouncing (APPENG-6149), keyed by
 * `${workloadName}::${robotName}`. `listSpawnedRobotsInOpenShift` never throws — it
 * returns `[]` both for a genuinely empty world AND for a transient oc/exec failure — so a
 * single empty poll can't be trusted to mean "this robot is really gone". Requiring the
 * same robot to be confirmed missing across PRUNE_MISS_THRESHOLD consecutive polls before
 * removing it keeps one blip from wiping an actively-driven robot's nav state. */
let missingStreaks = new Map<string, number>();
const PRUNE_MISS_THRESHOLD = 2;
/** Wall-clock time each freshly-spawned robot was first tracked, keyed the same way — set
 * once, never refreshed, and only for spawnRobot (ADD-reconciled robots are already proven
 * alive at add time, so they need no grace at all). A robot with `warmStatus === 'warming'`
 * is skipped entirely below rather than using this — pollWarmStatus and the backend's own
 * bounded pre-warm timeout already own resolving that state precisely. This grace period
 * exists only for the case that signal doesn't cover: Humble spawns, which have no `warming`
 * phase at all, still take a moment for their ROS nodes to register after a Gazebo spawn
 * (the same raw latency the backend's own pre-warm pose-poll accounts for — up to 30 attempts
 * at 1s intervals, #prewarmNav2). */
let trackedSince = new Map<string, number>();
const PRUNE_GRACE_PERIOD_MS = 30_000;
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
/** Suggestions matching the current free-text `namespace` (S8-21), case-insensitive
 * substring match, with system/default namespaces dropped first unless
 * `showSystemProjects` is on. Empty text shows the full (filtered) list, still
 * height-capped + scrollable. */
$: filteredProjects = (
  showSystemProjects ? openShiftProjects : openShiftProjects.filter(p => !isSystemProject(p))
).filter(p => !namespace || p.toLowerCase().includes(namespace.toLowerCase()));
/** Single source of truth for whether the menu is actually shown — `namespaceMenuOpen`
 * is just user intent (focused/typed); it collapses to nothing when there are no
 * matches instead of showing an empty menu. */
$: namespaceMenuVisible = namespaceMenuOpen && filteredProjects.length > 0;
// Reset the highlighted option whenever the filtered list changes (new text typed, or a
// fresh project list arriving from refreshProjects()) so a stale index never points past
// the end of a shorter list.
$: {
  filteredProjects;
  namespaceHighlight = -1;
}

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

/** Well-known OpenShift/Kubernetes system & default namespaces, hidden from the
 * Project/namespace suggestions by default (S8-21). Free-text entry still reaches them. */
function isSystemProject(name: string): boolean {
  return name === 'default' || name === 'openshift' || name.startsWith('openshift-') || name.startsWith('kube-');
}

/** Refresh the project/namespace suggestions (S8-21) for the targeted cluster. Fails
 * soft to [] — the combobox still accepts free text if listing fails. */
async function refreshProjects() {
  try {
    openShiftProjects = await physicalAiClient.listOpenShiftProjects(selectedContext || undefined);
  } catch {
    openShiftProjects = [];
  }
}

/** Open the Project/namespace menu on focus (S8-21); cancels a pending blur-close from a
 * previous focus/blur cycle. */
function handleNamespaceFocus() {
  if (namespaceBlurTimeout) clearTimeout(namespaceBlurTimeout);
  namespaceMenuOpen = true;
}

/** Keep the menu open while typing; `namespaceMenuVisible` collapses it automatically
 * once there are no matches for the new text. */
function handleNamespaceInput() {
  namespaceMenuOpen = true;
}

/** Close the menu shortly after blur rather than immediately — clicking an option blurs
 * the input first, and without this delay the menu would unmount before the option's
 * click handler runs. */
function handleNamespaceBlur() {
  namespaceBlurTimeout = setTimeout(() => {
    namespaceMenuOpen = false;
  }, 150);
}

/** Commit a suggestion from the custom Project/namespace dropdown (S8-21) — mirrors the
 * input's own `on:change` side effect so picking a project immediately retargets the
 * workload list, exactly like typing one and committing it. */
function selectProject(project: string) {
  namespace = project;
  namespaceMenuOpen = false;
  refreshWorkloads();
}

/** Arrow-key nav + Enter-to-select/commit + Escape-to-close for the custom combobox. */
function handleNamespaceKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (!namespaceMenuVisible) {
      namespaceMenuOpen = true;
      return;
    }
    namespaceHighlight = Math.min(namespaceHighlight + 1, filteredProjects.length - 1);
  } else if (e.key === 'ArrowUp') {
    if (!namespaceMenuVisible) return;
    e.preventDefault();
    namespaceHighlight = Math.max(namespaceHighlight - 1, 0);
  } else if (e.key === 'Enter') {
    if (namespaceMenuVisible && namespaceHighlight >= 0) {
      e.preventDefault();
      selectProject(filteredProjects[namespaceHighlight]);
    } else {
      namespaceMenuOpen = false;
      refreshWorkloads();
    }
  } else if (e.key === 'Escape') {
    namespaceMenuOpen = false;
    namespaceHighlight = -1;
  }
}

/** Re-seed namespace/login status and refresh the workload list + project suggestions
 * for the cluster the user just picked from the Cluster dropdown (S8-10). */
async function onContextChange() {
  const entry = kubeContexts.find(c => c.name === selectedContext);
  await seedNamespaceFromContext(entry?.namespace);
  await refreshLoginStatus();
  await refreshWorkloads();
  await refreshProjects();
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
  await refreshProjects();
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
    await pruneStaleRobots();
  }, 3000);
});

onDestroy(() => {
  if (warmTimer) clearInterval(warmTimer);
  if (namespaceBlurTimeout) clearTimeout(namespaceBlurTimeout);
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
        clearMissingStreaksForWorkload(key);
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
  // No trackedSince entry needed — a reconciled robot was, by definition, just confirmed
  // alive (it's in `names`), so it's immediately eligible for normal prune debounce with
  // no startup grace required.
  robotsByWorkload[w.name] = [
    ...(robotsByWorkload[w.name] ?? []),
    // x/y aren't recoverable from `ros2 node list` alone, so they're omitted — the row
    // shows just the robot name rather than a meaningless "(?, ?)".
    ...missing.map(n => ({
      name: n,
      navStatus: 'idle' as const,
      navTarget: { x: '0', y: '0' },
      navReached: null,
    })),
  ];
  robotsByWorkload = robotsByWorkload;
}

function clearMissingStreaksForWorkload(wname: string) {
  const prefix = `${wname}::`;
  for (const key of missingStreaks.keys()) {
    if (key.startsWith(prefix)) missingStreaks.delete(key);
  }
  for (const key of trackedSince.keys()) {
    if (key.startsWith(prefix)) trackedSince.delete(key);
  }
}

/**
 * Removes tracked robots that no longer actually exist in the running world (APPENG-6149,
 * S8-18) — e.g. a pod crash/restart resets a Path B world to empty, but a robot spawned
 * before the crash otherwise sits in `robotsByWorkload` forever, failing every subsequent
 * action (Navigate, Nav2 warm-up) against a robot that's gone. Unlike `reconcileRobots`
 * (ADD direction, gated to run once per ready workload), this runs on every poll tick —
 * the crash this fixes can happen mid-session, well after that one-time reconcile already
 * ran, so a once-only check would miss it.
 *
 * Only ever checks robots whose existing phase actually warrants it: a `'warming'` robot
 * is skipped (its own state machine already owns resolving that), an unconfirmed robot
 * still within its startup grace period is skipped, and only a robot confirmed missing
 * across PRUNE_MISS_THRESHOLD consecutive polls is actually removed.
 */
async function pruneStaleRobots() {
  let changed = false;
  for (const w of workloads) {
    if (!w.ready) continue;
    const tracked = robotsByWorkload[w.name];
    if (!tracked || tracked.length === 0) continue;
    // A 'warming' robot's liveness is already being resolved by pollWarmStatus (and the
    // backend's own bounded pre-warm timeout) — skip the exec call entirely if there's
    // nothing else here that actually needs checking this tick.
    if (tracked.every(r => r.warmStatus === 'warming')) continue;
    let live: string[];
    try {
      live = await physicalAiClient.listSpawnedRobotsInOpenShift(w.namespace, w.name, selectedContext || undefined);
    } catch {
      continue;
    }
    const liveNames = new Set(live);
    const now = Date.now();
    const keep: RobotEntry[] = [];
    for (const robot of tracked) {
      const key = `${w.name}::${robot.name}`;
      if (robot.warmStatus === 'warming') {
        // Still initializing — its own state machine will resolve to 'ready'/'failed';
        // don't count this tick's absence against it.
        keep.push(robot);
        continue;
      }
      if (liveNames.has(robot.name)) {
        missingStreaks.delete(key);
        keep.push(robot);
        continue;
      }
      const since = trackedSince.get(key);
      if (since !== undefined && now - since < PRUNE_GRACE_PERIOD_MS) {
        // Still within its startup grace window (Humble spawn, no warmStatus signal) —
        // not suspicious yet.
        keep.push(robot);
        continue;
      }
      const streak = (missingStreaks.get(key) ?? 0) + 1;
      if (streak >= PRUNE_MISS_THRESHOLD) {
        missingStreaks.delete(key);
        trackedSince.delete(key);
      } else {
        missingStreaks.set(key, streak);
        keep.push(robot);
      }
    }
    if (keep.length !== tracked.length) {
      robotsByWorkload[w.name] = keep;
      changed = true;
    }
  }
  if (changed) robotsByWorkload = robotsByWorkload;
}

async function remove(w: OpenShiftWorkload) {
  deletingName = w.name;
  try {
    await physicalAiClient.deleteOpenShiftDeployment(w.namespace, w.name, selectedContext || undefined);
    // Clear this deployment's robot list and the stale result panel.
    delete robotsByWorkload[w.name];
    reconciledWorkloads.delete(w.name);
    clearMissingStreaksForWorkload(w.name);
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
  const key = `${w.name}::${form.name}`;
  missingStreaks.delete(key);
  trackedSince.set(key, Date.now());
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
  const key = `${w.name}::${robot.name}`;
  missingStreaks.delete(key);
  trackedSince.delete(key);
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
        <!-- Custom filtered combobox (S8-21), replacing a native <input list>/<datalist>:
             the datalist popup rendered misaligned (floating over the next field) and its
             height was uncontrollable in the Podman Desktop (Electron) webview. This menu
             is anchored under the input, height-capped + scrollable, and still lets you
             commit any free-text value — a failed/empty project listing (not logged in,
             `oc` missing) degrades cleanly. -->
        <div class="relative">
          <input
            id="dep-ns"
            role="combobox"
            aria-expanded={namespaceMenuVisible}
            aria-controls="dep-ns-listbox"
            aria-autocomplete="list"
            aria-activedescendant={namespaceHighlight >= 0 ? `dep-ns-option-${namespaceHighlight}` : undefined}
            bind:value={namespace}
            on:focus={handleNamespaceFocus}
            on:input={handleNamespaceInput}
            on:keydown={handleNamespaceKeydown}
            on:blur={handleNamespaceBlur}
            on:change={() => refreshWorkloads()}
            disabled={deploying}
            placeholder="e.g. my-project"
            autocomplete="off"
            class="w-full px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] font-mono" />
          {#if namespaceMenuVisible}
            <ul
              id="dep-ns-listbox"
              role="listbox"
              class="absolute top-full left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] shadow-lg">
              {#each filteredProjects as project, i (project)}
                <!-- Selection is fully reachable via keyboard through handleNamespaceKeydown
                     (ArrowUp/Down + Enter) on the input itself; the click here is a pointer
                     convenience, so no separate keyboard handler belongs on the option. -->
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <li
                  id={`dep-ns-option-${i}`}
                  role="option"
                  aria-selected={i === namespaceHighlight}
                  on:mousedown|preventDefault
                  on:click={() => selectProject(project)}
                  class="px-3 py-1.5 text-sm font-mono cursor-pointer text-[var(--pd-content-text)] {i ===
                  namespaceHighlight
                    ? 'bg-[var(--pd-content-card-border)]'
                    : ''}">
                  {project}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
        {#if openShiftProjects.length > 0}
          <span class="text-xs pai-text-muted">
            Click to browse available projects, or type to filter — any value is allowed.
          </span>
        {/if}
        {#if openShiftProjects.some(isSystemProject)}
          <label class="flex flex-row items-center gap-2 text-xs text-[var(--pd-content-text)]">
            <input type="checkbox" bind:checked={showSystemProjects} disabled={deploying} />
            Show system projects (default, openshift-*, kube-*)
          </label>
        {/if}
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

      {#if deploying}
        <!-- In-progress feedback (S8-1): the Deploy button also flips to "Deploying…",
             but a banner makes the pending state obvious while manifests are applied. -->
        <div class="text-sm p-3 rounded pai-banner-info flex flex-row items-center gap-2">
          <span class="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse"></span>
          Deploying <span class="font-mono">{name}</span> to <span class="font-mono">{namespace}</span>…
        </div>
      {/if}

      {#if deployResult && !deploying}
        <!-- Three-line summary from structured fields (S8-4). The route link lives in the
             Deployed simulations list below once the pod is ready, so it isn't repeated
             here (S8-3). -->
        <div class="text-sm p-3 rounded pai-banner-success flex flex-col gap-1">
          <div>
            Deployed
            <span class="font-mono font-semibold text-[var(--pd-content-header)]">{deployResult.name}</span>
            to
            <span class="font-mono font-semibold pai-text-accent">{deployResult.namespace}</span>
          </div>
          <div class="text-xs opacity-80">
            Route:
            {#if deployResult.routeUrl}
              <span class="font-mono break-all">{deployResult.routeUrl}</span>
            {:else}
              pending admission…
            {/if}
          </div>
          <div class="text-xs opacity-80">Applied: {deployResult.applied.join(', ')}</div>
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
              <!-- Only offer the route link once the pod is ready AND the route is admitted
                   (S8-5): a route can be admitted before the pod serves, so opening it early
                   just yields a 503. -->
              {#if w.ready && w.routeUrl}
                <button
                  on:click={() => openRoute(w.routeUrl)}
                  class="pai-link pai-link-sm self-start break-all text-left">
                  Open {w.routeUrl}
                </button>
              {:else if w.routeUrl}
                <span class="text-xs pai-text-muted">Route admitted; waiting for the pod to be ready…</span>
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
