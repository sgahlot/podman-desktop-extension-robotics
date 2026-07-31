<script lang="ts">
import { physicalAiClient } from './api/client';
import { onMount, onDestroy } from 'svelte';
import { router } from 'tinro';
import type { SimContainerInfo } from '/@shared/src/types/SimulationContainer';

let localSimImages: string[] = [];
let selectedImage = '';
let containers: SimContainerInfo[] = [];
let launching = false;
let launchError = '';
let pollTimer: ReturnType<typeof setInterval> | null = null;

let robotName = 'robot_1';
let robotX = '-2.0';
let robotY = '-0.5';
let robotYaw = '0.0';
let spawning = false;
let spawnStatus = '';
let robotCounter = 1;
let spawnedRobots: Array<{ name: string; x: string; y: string; status: string }> = [];

$: runningContainer = containers.find(c => c.state === 'running');
$: hasRunning = !!runningContainer;

async function loadImages() {
  try {
    const all = await physicalAiClient.listLocalImages();
    localSimImages = all.filter(t => /ros2-.*-sim|ros2-.*-turtlebot3/.test(t));
    if (localSimImages.length > 0 && !selectedImage) {
      selectedImage = localSimImages[0];
    }
  } catch {
    localSimImages = [];
  }
}

async function pollContainers() {
  try {
    containers = await physicalAiClient.listSimulationContainers();
    if (containers.some(c => c.state === 'running')) {
      launchError = '';
    }
  } catch {
    // keep previous state
  }
}

async function cleanupExitedContainers() {
  const exited = containers.filter(c => c.state !== 'running');
  for (const c of exited) {
    try { await physicalAiClient.deleteSimulation(c.id); } catch { }
  }
  if (exited.length > 0) await pollContainers();
}

onMount(() => {
  loadImages();
  pollContainers().then(() => cleanupExitedContainers());
  pollTimer = setInterval(pollContainers, 3000);
});

onDestroy(() => {
  if (pollTimer) clearInterval(pollTimer);
});

async function launchSim() {
  if (!selectedImage || hasRunning) return;
  launching = true;
  launchError = '';
  try {
    await physicalAiClient.launchSimulation(selectedImage, '', undefined);
    spawnedRobots = [];
    robotCounter = 1;
    robotName = 'robot_1';
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
  try {
    await physicalAiClient.deleteSimulation(id);
    spawnedRobots = [];
    await pollContainers();
  } catch {
    // will update on next poll
  }
}

async function deleteSim(id: string) {
  try {
    await physicalAiClient.deleteSimulation(id);
    spawnedRobots = [];
    await pollContainers();
  } catch {
    // will update on next poll
  }
}

async function openInBrowser() {
  await physicalAiClient.openSimulationInBrowser(6080);
}

async function spawnRobot() {
  if (!runningContainer) return;
  spawning = true;
  spawnStatus = '';
  try {
    await physicalAiClient.execInSimulation(runningContainer.id, [
      '/entrypoint-spawn-robot.sh', robotName, robotX, robotY, robotYaw,
    ]);
    spawnedRobots = [...spawnedRobots, { name: robotName, x: robotX, y: robotY, status: 'Spawned' }];
    robotCounter++;
    robotName = `robot_${robotCounter}`;
    spawnStatus = '';
  } catch (e) {
    spawnStatus = `Error: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    spawning = false;
  }
}
</script>

<div class="flex flex-col p-4 gap-4 h-full overflow-auto">
  <button on:click={() => router.goto('/')} class="pai-link self-start">
    &larr; Back to Dashboard
  </button>
  <h1 class="text-3xl text-[var(--pd-content-header)]">Simulation</h1>
  <p class="text-sm text-[var(--pd-content-text)]">
    Launch a Gazebo world (empty by default), view it in the browser via noVNC, then add TurtleBot3 robots interactively.
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
          <li>Return here and Launch — the world starts empty; use <strong>Add TurtleBot3</strong> below to spawn a robot</li>
        </ol>
      </div>
    {:else}
      <div class="flex flex-col gap-2">
        <label for="simImage" class="text-xs text-[var(--pd-content-text)]">Simulation image</label>
        <select
          id="simImage"
          bind:value={selectedImage}
          disabled={launching || hasRunning}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-[var(--pd-content-text)]"
        >
          {#each localSimImages as img}
            <option value={img}>{img}</option>
          {/each}
        </select>

        {#if hasRunning}
          <div class="flex items-center gap-2">
            <span class="text-xs pai-text-warning">A simulation is already running.</span>
            <button
              on:click={() => runningContainer && stopSim(runningContainer.id)}
              class="pai-btn text-xs"
            >
              Stop
            </button>
          </div>
        {/if}

        <button
          on:click={launchSim}
          disabled={launching || hasRunning || !selectedImage}
          class="pai-btn pai-btn-primary self-start mt-1"
        >
          {launching ? 'Launching...' : 'Launch'}
        </button>

        {#if launchError}
          <span class="text-xs pai-text-error">{launchError}</span>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Section 2: Running containers -->
  {#if containers.length > 0}
    <div class="flex flex-col gap-2 max-w-lg">
      <h2 class="text-sm font-medium text-[var(--pd-content-header)]">Simulation Containers</h2>

      {#each containers as container (container.id)}
        <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-3 flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <span class="inline-block w-2 h-2 rounded-full {container.state === 'running' ? 'bg-green-500' : 'bg-gray-400'}"></span>
            <span class="text-sm font-medium text-[var(--pd-content-header)]">{container.name}</span>
            <span class="text-xs pai-text-muted ml-auto">{container.state}</span>
          </div>
          <div class="text-xs text-[var(--pd-content-text)] font-mono break-all">{container.imageTag}</div>
          {#if container.ports.length > 0}
            <div class="text-xs pai-text-muted">Ports: {container.ports.join(', ')}</div>
          {/if}
          <div class="flex gap-2 mt-1">
            {#if container.state === 'running'}
              <button on:click={openInBrowser} class="pai-btn pai-btn-primary text-xs">
                Open in Browser
              </button>
              <button on:click={() => stopSim(container.id)} class="pai-btn text-xs">
                Stop
              </button>
            {:else}
              <button on:click={() => deleteSim(container.id)} class="pai-btn text-xs">
                Delete
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Section 3: Add Robot -->
  <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 max-w-lg {hasRunning ? '' : 'opacity-50'}">
    <h2 class="text-sm font-medium text-[var(--pd-content-header)] mb-2">Add TurtleBot3</h2>
    {#if !hasRunning}
      <p class="text-xs pai-text-muted">Launch a simulation first to add robots.</p>
    {:else}
      <div class="flex flex-col gap-2">
        <div class="grid grid-cols-4 gap-2">
          <div class="flex flex-col gap-1">
            <label for="robotName" class="text-xs text-[var(--pd-content-text)]">Name</label>
            <input
              id="robotName"
              type="text"
              bind:value={robotName}
              disabled={spawning}
              class="px-2 py-1 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-[var(--pd-content-text)]"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label for="robotX" class="text-xs text-[var(--pd-content-text)]">X</label>
            <input
              id="robotX"
              type="text"
              bind:value={robotX}
              disabled={spawning}
              class="px-2 py-1 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-[var(--pd-content-text)]"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label for="robotY" class="text-xs text-[var(--pd-content-text)]">Y</label>
            <input
              id="robotY"
              type="text"
              bind:value={robotY}
              disabled={spawning}
              class="px-2 py-1 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-[var(--pd-content-text)]"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label for="robotYaw" class="text-xs text-[var(--pd-content-text)]">Yaw</label>
            <input
              id="robotYaw"
              type="text"
              bind:value={robotYaw}
              disabled={spawning}
              class="px-2 py-1 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-[var(--pd-content-text)]"
            />
          </div>
        </div>

        <button
          on:click={spawnRobot}
          disabled={spawning || !robotName}
          class="pai-btn pai-btn-primary self-start"
        >
          {spawning ? 'Spawning...' : 'Add TurtleBot3'}
        </button>

        {#if spawnStatus}
          <span class="text-xs pai-text-error">{spawnStatus}</span>
        {/if}

        {#if spawnedRobots.length > 0}
          <div class="mt-2">
            <div class="text-xs font-medium text-[var(--pd-content-header)] mb-1">Spawned Robots</div>
            {#each spawnedRobots as robot}
              <div class="text-xs text-[var(--pd-content-text)] flex gap-2">
                <span class="font-mono">{robot.name}</span>
                <span class="pai-text-muted">({robot.x}, {robot.y})</span>
                <span class="pai-text-success">{robot.status}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
