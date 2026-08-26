<script lang="ts">
import { physicalAiClient } from './api/client';
import { onMount, onDestroy } from 'svelte';
import { router } from 'tinro';
import type { SimContainerInfo } from '/@shared/src/types/SimulationContainer';
import { SIM_STOPPED_BROWSER_HINT } from '/@shared/src/types/SimulationContainer';
import { isSimLaunchImageRef } from '/@shared/src/security/simImageTrust';
import RobotControls, { type RobotEntry } from './RobotControls.svelte';

let localSimImages: string[] = [];
let selectedImage = '';
let containers: SimContainerInfo[] = [];
let launching = false;
let launchError = '';
let actionError = '';
let actionInfo = '';
/** Container ids removed this session — hide until list API stops returning them. */
let removedContainerIds: string[] = [];
let pollTimer: ReturnType<typeof setInterval> | null = null;
let simImageAllowlist = '';

let spawnedRobots: RobotEntry[] = [];

$: runningContainer = containers.find(c => c.state === 'running');
$: hasRunning = !!runningContainer;

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
  pollContainers();
  pollTimer = setInterval(() => {
    pollContainers();
    pollWarmStatus();
  }, 3000);
});

onDestroy(() => {
  if (pollTimer) clearInterval(pollTimer);
});

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
    const simConfig = await physicalAiClient.getSimulationConfig();
    const launchOptions =
      simConfig.middleware === 'zenoh' ? { env: { RMW_IMPLEMENTATION: 'rmw_zenoh_cpp' } } : undefined;
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

async function spawnRobot(form: { name: string; x: string; y: string; yaw: string }) {
  if (!runningContainer) throw new Error('No running simulation');
  await physicalAiClient.execInSimulation(runningContainer.id, [
    '/entrypoint-spawn-robot.sh',
    form.name,
    form.x,
    form.y,
    form.yaw,
  ]);
  spawnedRobots = [
    ...spawnedRobots,
    {
      name: form.name,
      x: form.x,
      y: form.y,
      navStatus: 'idle',
      navTarget: { x: '2.0', y: '2.0' },
      navReached: null,
      // Backend pre-warms Nav2 for Jazzy only; show "warming…" optimistically there.
      warmStatus: runningContainer?.imageTag?.includes('jazzy') ? 'warming' : undefined,
    },
  ];
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
  spawnedRobots = spawnedRobots.filter((_, i) => i !== index);
}
</script>

<div class="flex flex-col gap-4">
  <p class="text-sm text-[var(--pd-content-text)]">
    Launch a Gazebo world (empty by default), view it in the browser via noVNC, then add TurtleBot3 robots
    interactively. Only local images matching the simulation allowlist can be launched (default <span class="font-mono"
      >ros2-*-sim*</span>
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
    <div class="flex flex-col gap-2 max-w-lg">
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
              <button on:click={() => router.goto('/topics')} class="pai-btn pai-btn-primary text-xs">
                View Topics
              </button>
            {/if}
            <button on:click={() => stopSim(container.id)} class="pai-btn pai-btn-danger text-xs">
              Stop &amp; remove
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Section 3: Add Robot (only when a simulation is running) -->
  {#if hasRunning}
    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 max-w-lg">
      <h2 class="text-sm font-medium text-[var(--pd-content-header)] mb-2">Add TurtleBot3</h2>
      <RobotControls
        robots={spawnedRobots}
        onSpawn={spawnRobot}
        onNavigate={navigateRobot}
        onRemove={removeRobot}
        spawnLabel="Add TurtleBot3"
        idPrefix="local" />
    </div>
  {/if}
</div>
