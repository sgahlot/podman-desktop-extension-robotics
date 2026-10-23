<script lang="ts">
import { physicalAiClient } from './api/client';
import { onMount, onDestroy } from 'svelte';
import { router } from 'tinro';
import type { SimContainerInfo } from '/@shared/src/types/SimulationContainer';
import { SIM_STOPPED_BROWSER_HINT } from '/@shared/src/types/SimulationContainer';
import { isSimLaunchImageRef } from '/@shared/src/security/simImageTrust';
import { imageSupportsNav2Prewarm, simulationBrowserUrl, SPAWN_ENTRYPOINT } from '/@shared/src/security/simInput';
import RobotControls, { type RobotEntry } from './RobotControls.svelte';
import { reconcileAdd, pruneStale } from './lib/robotReconcile';
import { localDiagnosticsHref } from './lib/diagnosticsLink';
import { localTargetKey } from './lib/diagnosticsTargetKey';
import { setSpawnedRobotsForTarget } from './lib/spawnedRobotsStore';
import { clearCachedDiagnostics } from './lib/robotDiagnosticsCache';
import { middlewareLabelForImage } from '/@shared/src/types/middlewareLabels';
import type { EmbeddedRobotProfile } from '/@shared/src/types/EmbeddedRobotProfile';

let localSimImages: string[] = [];
let selectedImage = '';
let selectedMiddleware: 'dds' | 'zenoh' = 'dds';
let containers: SimContainerInfo[] = [];
let launching = false;
let launchError = '';
let actionError = '';
let actionInfo = '';
/** Container ids removed this session — hide until list API stops returning them. */
let removedContainerIds: string[] = [];
let pollTimer: ReturnType<typeof setInterval> | null = null;
export let active = true;
let wasActive = false;
let simImageAllowlist = '';
let robotPackage = 'nav2_minimal_tb3_sim';
let robotLaunchFile = 'launch/spawn_tb3.launch.py';
let robotLaunchArguments =
  'use_sim_time:=True\nnamespace:={name}\nrobot_name:={name}\nx_pose:={x}\ny_pose:={y}\nyaw:={yaw}\nz_pose:=0.01';
let robotLaunchError = '';

let spawnedRobots: RobotEntry[] = [];
/** Whether the running container's robots have been reconciled against `ros2 node list`
 * (APPENG-6250, mirrors OpenShift's `reconciledWorkloads`) — probed at most once per
 * running container, so a page reload/extension restart picks up robots spawned in a
 * prior session without re-probing (or duplicating) on every poll tick. Reset whenever
 * no container is running (see below), so a later launch reconciles fresh. */
let reconciled = false;
/** Consecutive-miss counters for prune debouncing (APPENG-6149/6250) — see `pruneStale`
 * in `lib/robotReconcile.ts` for the prune/grace-period algorithm shared with the
 * OpenShift tab. Only one container runs locally at a time, so robot name alone is a
 * sufficient map key (no workload-name prefix needed). */
let missingStreaks = new Map<string, number>();
let trackedSince = new Map<string, number>();
/** Container ids with the embedded noVNC viewer expanded (APPENG-6283). */
let expandedViewerIds: string[] = [];

$: runningContainer = containers.find(c => c.state === 'running');
$: hasRunning = !!runningContainer;
$: if (!hasRunning && reconciled) {
  reconciled = false;
  missingStreaks = new Map();
  trackedSince = new Map();
}
$: if (!hasRunning && expandedViewerIds.length > 0) {
  expandedViewerIds = [];
}
/** Keep the shared spawned-robots store in sync — covers every mutation path (reconcile,
 * prune, spawnRobot, removeRobot) for free, so RobotDiagnosticsPanel can notice a robot that
 * spawned after its own one-shot fetch already ran, instead of relying solely on that fetch. */
$: if (runningContainer)
  setSpawnedRobotsForTarget(
    localTargetKey(runningContainer.id),
    spawnedRobots.map(r => r.name),
  );

/** Host port mapped to container private port (e.g. 6080 noVNC). */
function hostPortForPrivate(container: SimContainerInfo | undefined, privatePort: number): number {
  if (!container) return privatePort;
  for (const p of container.ports) {
    const m = p.match(/^(\d+):(\d+)\//);
    if (m && Number(m[2]) === privatePort) return Number(m[1]);
  }
  return privatePort;
}

async function loadImages() {
  try {
    simImageAllowlist = await physicalAiClient.getSimulationImageAllowlist();
    const all = await physicalAiClient.listLocalImages();
    localSimImages = all.filter(t => isSimLaunchImageRef(t, simImageAllowlist || null));
    if (localSimImages.length > 0 && !selectedImage) {
      selectedImage = localSimImages[0];
    }
    if (selectedImage && !localSimImages.includes(selectedImage)) {
      selectedImage = localSimImages[0] ?? '';
    }
  } catch {
    localSimImages = [];
  }
}

async function loadEmbeddedRobotProfile() {
  try {
    const profile: EmbeddedRobotProfile | undefined = await physicalAiClient.getEmbeddedRobotProfile();
    if (!profile) return;
    robotPackage = 'ros_gz_sim';
    robotLaunchFile = 'launch/gz_spawn_model.launch.py';
    robotLaunchArguments = [
      `world:=${profile.world}`,
      `file:=/opt/physical-ai/robots/${profile.id}/${profile.modelFile}`,
      'entity_name:={name}',
      'allow_renaming:=False',
    ].join('\n');
  } catch {
    // Generic launch defaults remain available.
  }
}

async function pollContainers() {
  try {
    const listed = await physicalAiClient.listSimulationContainers();
    removedContainerIds = removedContainerIds.filter(id => listed.some(c => c.id === id));
    containers = listed.filter(c => !removedContainerIds.includes(c.id));
    if (containers.some(c => c.state === 'running')) {
      launchError = '';
    }
  } catch {
    // keep previous state
  }
}

onMount(() => {
  loadImages();
  void loadEmbeddedRobotProfile();
  pollContainers().then(reconcileRobots);
  pollTimer = setInterval(() => {
    pollContainers().then(reconcileRobots);
    pollWarmStatus();
    pruneStaleRobots();
  }, 3000);
});

onDestroy(() => {
  if (pollTimer) clearInterval(pollTimer);
});

$: if (active && !wasActive) {
  wasActive = true;
  void loadImages();
  void pollContainers().then(reconcileRobots);
}
$: if (!active) wasActive = false;

async function launchSim() {
  if (!selectedImage || hasRunning) return;
  launching = true;
  launchError = '';
  actionError = '';
  actionInfo = '';
  try {
    // Zenoh middleware (APPENG-5775): the image bakes in both RMW implementations, so
    // selecting zenoh is just an extra env var — entrypoint-gazebo.sh starts the Zenoh
    // router (rmw_zenohd) when it sees this set. Keep passing undefined for the
    // dds/default case so existing behavior (and its test snapshot) is unchanged.
    const launchOptions = selectedMiddleware === 'zenoh' ? { env: { RMW_IMPLEMENTATION: 'rmw_zenoh_cpp' } } : undefined;
    await physicalAiClient.launchSimulation(selectedImage, '', launchOptions);
    spawnedRobots = [];
    await pollContainers();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/already started|304/.test(msg)) {
      await pollContainers();
    } else {
      launchError = msg;
    }
  } finally {
    launching = false;
  }
}

async function stopSim(id: string) {
  actionError = '';
  actionInfo = '';
  try {
    await physicalAiClient.deleteSimulation(id);
    removedContainerIds = [...removedContainerIds, id];
    containers = containers.filter(c => c.id !== id);
    expandedViewerIds = expandedViewerIds.filter(x => x !== id);
    spawnedRobots = [];
    actionInfo = SIM_STOPPED_BROWSER_HINT;
    await pollContainers();
  } catch (e) {
    actionError = e instanceof Error ? e.message : String(e);
  }
}

async function openInBrowser() {
  actionError = '';
  try {
    const port = hostPortForPrivate(runningContainer, 6080);
    await physicalAiClient.openSimulationInBrowser(port, 6080);
  } catch (e) {
    actionError = e instanceof Error ? e.message : String(e);
  }
}

function toggleViewer(id: string) {
  expandedViewerIds = expandedViewerIds.includes(id)
    ? expandedViewerIds.filter(x => x !== id)
    : [...expandedViewerIds, id];
}

async function spawnRobot(form: { name: string; x: string; y: string; yaw: string }) {
  if (!runningContainer) throw new Error('No running simulation');
  robotLaunchError = '';
  missingStreaks.delete(form.name);
  trackedSince.set(form.name, Date.now());
  // A respawned robot under the same name is a new instance — its old cached diagnostics
  // snapshot (if any) is stale and must not be shown as if it were current.
  clearCachedDiagnostics(localTargetKey(runningContainer.id), form.name);
  const isDefaultTurtleBot3 =
    robotPackage.trim() === 'nav2_minimal_tb3_sim' && robotLaunchFile.trim() === 'launch/spawn_tb3.launch.py';
  const arguments_ = robotLaunchArguments
    .split(/\r?\n/)
    .map(argument => argument.trim())
    .filter(Boolean)
    .map(argument =>
      argument
        .replaceAll('{name}', form.name)
        .replaceAll('{x}', form.x)
        .replaceAll('{y}', form.y)
        .replaceAll('{yaw}', form.yaw),
    );
  try {
    if (isDefaultTurtleBot3) {
      // Keep TurtleBot3 on the proven path: its entrypoint owns spawn, bridge
      // readiness/fallback, and the backend's established Nav2 pre-warm flow.
      await physicalAiClient.execInSimulation(runningContainer.id, [
        SPAWN_ENTRYPOINT,
        form.name,
        form.x,
        form.y,
        form.yaw,
      ]);
    } else {
      await physicalAiClient.launchRobotInSimulation(runningContainer.id, {
        packageName: robotPackage.trim(),
        launchFile: robotLaunchFile.trim(),
        arguments: arguments_,
      });
    }
  } catch (error) {
    robotLaunchError = error instanceof Error ? error.message : String(error);
    throw error;
  }
  spawnedRobots = [
    ...spawnedRobots,
    {
      name: form.name,
      x: form.x,
      y: form.y,
      navStatus: 'idle',
      navTarget: { x: '2.0', y: '2.0' },
      navReached: null,
      positionManagedByProfile:
        !isDefaultTurtleBot3 && !robotLaunchArguments.includes('{x}') && !robotLaunchArguments.includes('{y}'),
      livenessManagedByProfile:
        !isDefaultTurtleBot3 && !robotLaunchArguments.includes('{x}') && !robotLaunchArguments.includes('{y}'),
      supportsNavigation: isDefaultTurtleBot3,
      warmStatus: isDefaultTurtleBot3 && imageSupportsNav2Prewarm(runningContainer.imageTag) ? 'warming' : undefined,
    },
  ];
}

/**
 * Reconciles the running container's robot list against what's actually running
 * (APPENG-6250) — spawn/warm state otherwise lives only in frontend memory, so a page
 * reload or extension restart forgets robots spawned earlier even though the container
 * keeps running. Only ever appends missing entries (`reconcileAdd`, shared with the
 * OpenShift tab) — never removes/overwrites ones already tracked.
 */
async function reconcileRobots() {
  if (!runningContainer || reconciled) return;
  reconciled = true;
  let names: string[];
  try {
    names = await physicalAiClient.listSpawnedRobotsInSimulation(runningContainer.id);
  } catch {
    return;
  }
  spawnedRobots = reconcileAdd(spawnedRobots, names);
}

/**
 * Removes tracked robots that no longer actually exist in the running container
 * (APPENG-6250, mirrors APPENG-6149) — e.g. a crash resets the world to empty, but a
 * robot spawned before the crash would otherwise sit in `spawnedRobots` forever, failing
 * every subsequent action against a robot that's gone. Delegates the warming-skip /
 * grace-period / miss-threshold debounce to `pruneStale` (shared with the OpenShift tab).
 */
async function pruneStaleRobots() {
  if (!runningContainer || spawnedRobots.length === 0) return;
  // A 'warming' robot's liveness is already being resolved by pollWarmStatus (and the
  // backend's own bounded pre-warm timeout) — skip the exec call entirely if there's
  // nothing else here that actually needs checking this tick.
  const nodeBackedRobots = spawnedRobots.filter(r => !r.livenessManagedByProfile);
  if (nodeBackedRobots.length === 0 || nodeBackedRobots.every(r => r.warmStatus === 'warming')) return;
  let live: string[];
  try {
    live = await physicalAiClient.listSpawnedRobotsInSimulation(runningContainer.id);
  } catch {
    return;
  }
  const retainedNames = new Set(
    pruneStale({ tracked: nodeBackedRobots, liveNames: live, missingStreaks, trackedSince, keyOf: n => n }).map(
      r => r.name,
    ),
  );
  spawnedRobots = spawnedRobots.filter(r => r.livenessManagedByProfile || retainedNames.has(r.name));
}

/** Poll Nav2 pre-warm state for robots still warming, so the badge tracks reality. */
async function pollWarmStatus() {
  if (!runningContainer || spawnedRobots.length === 0) return;
  let changed = false;
  for (let i = 0; i < spawnedRobots.length; i++) {
    const robot = spawnedRobots[i];
    // 'ready'/'failed' are terminal until re-spawn — skip to save exec calls.
    if (robot.warmStatus === 'ready' || robot.warmStatus === 'failed') continue;
    try {
      const status = await physicalAiClient.getRobotWarmStatus(runningContainer.id, robot.name);
      if (status !== robot.warmStatus) {
        spawnedRobots[i] = { ...spawnedRobots[i], warmStatus: status };
        changed = true;
      }
    } catch {
      // ignore — keep the last known warm status
    }
  }
  if (changed) spawnedRobots = [...spawnedRobots];
}

async function navigateRobot(index: number) {
  if (!runningContainer) return;
  const robot = spawnedRobots[index];
  if (!robot) return;
  const targetX = parseFloat(robot.navTarget.x);
  const targetY = parseFloat(robot.navTarget.y);
  if (isNaN(targetX) || isNaN(targetY)) return;

  const snapshot = { x: robot.navTarget.x, y: robot.navTarget.y };
  spawnedRobots[index] = { ...robot, navStatus: 'navigating', navReached: null };
  spawnedRobots = [...spawnedRobots];

  try {
    const result = await physicalAiClient.sendNavigationGoal(runningContainer.id, robot.name, targetX, targetY);
    spawnedRobots[index] = {
      ...spawnedRobots[index],
      navStatus: result.status === 'reached' ? 'reached' : 'failed',
      navReached: snapshot,
    };
  } catch {
    spawnedRobots[index] = { ...spawnedRobots[index], navStatus: 'failed', navReached: snapshot };
  }
  spawnedRobots = [...spawnedRobots];
}

async function removeRobot(index: number) {
  if (!runningContainer) return;
  const robot = spawnedRobots[index];
  if (!robot) return;
  await physicalAiClient.despawnRobot(runningContainer.id, robot.name);
  missingStreaks.delete(robot.name);
  trackedSince.delete(robot.name);
  clearCachedDiagnostics(localTargetKey(runningContainer.id), robot.name);
  spawnedRobots = spawnedRobots.filter((_, i) => i !== index);
}

function diagnoseRobot(index: number): void {
  if (!runningContainer) return;
  const robot = spawnedRobots[index];
  if (!robot) return;
  router.goto(localDiagnosticsHref(runningContainer.id, robot.name));
}
</script>

<div class="flex flex-col gap-4">
  <p class="text-sm text-[var(--pd-content-text)]">
    Launch a Gazebo world (empty by default), view it in the browser via noVNC, then add robots using launch
    configurations already installed in the selected image. Only local images matching the simulation allowlist can be
    launched (default <span class="font-mono">ros2-*-sim*</span>
    / <span class="font-mono">ros2-*-turtlebot3</span>).
  </p>

  <!-- Section 1: Launch -->
  <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 max-w-lg">
    <h2 class="text-sm font-medium text-[var(--pd-content-header)] mb-2">Launch Simulation</h2>

    {#if localSimImages.length === 0}
      <div class="flex flex-col gap-2 text-xs text-[var(--pd-content-text)]">
        <p>
          No simulation images found locally. Tags must look like
          <span class="font-mono">…/ros2-*-sim*:…</span> or
          <span class="font-mono">…/ros2-*-turtlebot3:…</span>
          (for example <span class="font-mono">quay.io/&lt;ns&gt;/ros2-jazzy-sim:noble</span>).
        </p>
        <ol class="list-decimal list-inside flex flex-col gap-1 pl-1">
          <li>
            Open
            <button type="button" on:click={() => router.goto('/build')} class="pai-link">Image Builder</button>
            → Quick Start <span class="font-mono">TurtleBot3 Sim (Jazzy)</span>
          </li>
          <li>Build <strong>Phase 1</strong> (base), then <strong>Phase 2</strong> (sim)</li>
          <li>
            Return here and Launch — the world starts empty; use <strong>Add TurtleBot3</strong> below to spawn a robot
          </li>
        </ol>
      </div>
    {:else}
      <div class="flex flex-col gap-2">
        <label for="simImage" class="text-xs text-[var(--pd-content-text)]">Simulation image</label>
        <select
          id="simImage"
          bind:value={selectedImage}
          disabled={launching || hasRunning}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-[var(--pd-content-text)]">
          {#each localSimImages as img}
            <option value={img}>{img}</option>
          {/each}
        </select>

        <label for="middleware" class="text-xs text-[var(--pd-content-text)]">Middleware</label>
        <select
          id="middleware"
          bind:value={selectedMiddleware}
          disabled={launching || hasRunning}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-[var(--pd-content-text)]">
          <option value="dds">DDS (default)</option>
          <option value="zenoh">Zenoh</option>
        </select>
        <span class="text-xs pai-text-muted">Uses: {middlewareLabelForImage(selectedMiddleware, selectedImage)}</span>

        <button
          on:click={launchSim}
          disabled={launching || hasRunning || !selectedImage}
          class="pai-btn pai-btn-primary self-start mt-1">
          {launching ? 'Launching...' : 'Launch'}
        </button>

        {#if launchError}
          <span class="text-xs pai-text-error">{launchError}</span>
        {/if}
      </div>
    {/if}
  </div>

  {#if actionError}
    <span class="text-xs pai-text-error max-w-lg">{actionError}</span>
  {/if}
  {#if actionInfo}
    <span class="text-xs text-[var(--pd-content-text)] max-w-lg">{actionInfo}</span>
  {/if}

  <!-- Section 2: Running containers -->
  {#if containers.length > 0}
    <div class="flex flex-col gap-2 w-full">
      <h2 class="text-sm font-medium text-[var(--pd-content-header)]">Simulation Containers</h2>

      {#each containers as container (container.id)}
        <div
          class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-3 flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <span
              class="inline-block w-2 h-2 rounded-full {container.state === 'running' ? 'bg-green-500' : 'bg-gray-400'}"
            ></span>
            <span class="text-sm font-medium text-[var(--pd-content-header)]">{container.name}</span>
            <span class="text-xs pai-text-muted ml-auto">{container.state}</span>
          </div>
          <div class="text-xs text-[var(--pd-content-text)] font-mono break-all">{container.imageTag}</div>
          {#if container.ports.length > 0}
            <div class="text-xs pai-text-muted">Ports: {container.ports.join(', ')}</div>
          {/if}
          <div class="flex gap-2 mt-1">
            {#if container.state === 'running'}
              <button on:click={openInBrowser} class="pai-btn pai-btn-primary text-xs"> Open in Browser </button>
              <button on:click={() => toggleViewer(container.id)} class="pai-btn text-xs">
                {expandedViewerIds.includes(container.id) ? 'Hide Viewer' : 'Show Viewer'}
              </button>
              <button on:click={() => router.goto('/topics')} class="pai-btn pai-btn-primary text-xs">
                View Topics
              </button>
            {/if}
            <button on:click={() => stopSim(container.id)} class="pai-btn pai-btn-danger text-xs">
              Stop &amp; remove
            </button>
          </div>
          {#if container.state === 'running' && expandedViewerIds.includes(container.id)}
            <iframe
              title="Simulation viewer ({container.name})"
              src={simulationBrowserUrl(hostPortForPrivate(container, 6080), 6080)}
              class="w-full h-[480px] rounded border border-[var(--pd-content-card-border)] bg-black"></iframe>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <!-- Section 3: Add Robot (only when a simulation is running) -->
  {#if hasRunning}
    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 max-w-lg">
      <h2 class="text-sm font-medium text-[var(--pd-content-header)] mb-2">Add Robot</h2>
      <div class="flex flex-col gap-2 mb-3">
        <label for="robot-package" class="text-xs pai-text-muted">ROS package</label>
        <input
          id="robot-package"
          bind:value={robotPackage}
          placeholder="my_robot_gazebo"
          class="px-2 py-1 text-xs rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-[var(--pd-content-text)] font-mono" />
        <label for="robot-launch-file" class="text-xs pai-text-muted">Launch file</label>
        <input
          id="robot-launch-file"
          bind:value={robotLaunchFile}
          placeholder="launch/spawn.launch.py"
          class="px-2 py-1 text-xs rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-[var(--pd-content-text)] font-mono" />
        <label for="robot-launch-arguments" class="text-xs pai-text-muted"
          >Launch arguments (one <span class="font-mono">name:=value</span> per line)</label>
        <textarea
          id="robot-launch-arguments"
          bind:value={robotLaunchArguments}
          rows="5"
          class="px-2 py-1 text-xs rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-[var(--pd-content-text)] font-mono"
        ></textarea>
        <span class="text-xs pai-text-muted"
          >The package and launch file must already be installed in this simulation image. <span class="font-mono"
            >{'{name}'}</span
          >, <span class="font-mono">{'{x}'}</span>, <span class="font-mono">{'{y}'}</span>, and
          <span class="font-mono">{'{yaw}'}</span> are replaced when you add the robot.</span>
        {#if robotLaunchError}<span class="text-xs pai-text-error">{robotLaunchError}</span>{/if}
      </div>
      <RobotControls
        robots={spawnedRobots}
        onSpawn={spawnRobot}
        onNavigate={navigateRobot}
        onRemove={removeRobot}
        onDiagnose={diagnoseRobot}
        spawnLabel="Add robot"
        idPrefix="local" />
    </div>
  {/if}
</div>
