<script lang="ts">
import { physicalAiClient } from './api/client';
import { onMount, onDestroy } from 'svelte';
import { router } from 'tinro';
import type { BuildProgress, PushProgress } from '/@shared/src/types/ImageCatalog';

let robot = 'turtlebot3';
let distro = 'humble';
let middleware = 'dds';
let engine = 'gazebo';

let loading = true;
let saving = false;
let saveSuccess = false;
let saveError = '';

let ns = 'ecosystem-appeng';
let tag = '';
let imageExistsLocally = false;

let building = false;
let buildDone = false;
let buildError = '';
let currentStep = 0;
let totalSteps = 0;
let logs: string[] = [];

let pushing = false;
let pushDone = false;
let pushError = '';
let pushStatus = 'Pushing...';
let pushDigest = '';

let buildLogsExpanded = true;

let pollTimer: number | null = null;
let logContainer: HTMLDivElement;

async function checkLocalImage() {
  try {
    const localImages = await physicalAiClient.listLocalImages();
    imageExistsLocally = localImages.includes(tag);
  } catch {
    imageExistsLocally = false;
  }
}

function updateTag() {
  tag = `quay.io/${ns}/ros2-${distro}-${robot}:latest`;
}

onMount(async () => {
  try {
    ns = await physicalAiClient.getDefaultNamespace();
  } catch {
    // default is fine
  }
  try {
    const config = await physicalAiClient.getSimulationConfig();
    robot = config.robot;
    distro = config.distro;
    middleware = config.middleware;
    engine = config.engine;
  } catch {
    // defaults are fine
  } finally {
    loading = false;
    updateTag();
    checkLocalImage();
  }
});

async function save() {
  saving = true;
  saveSuccess = false;
  saveError = '';

  try {
    await physicalAiClient.saveSimulationConfig({ robot, distro, middleware, engine });
    saveSuccess = true;
    updateTag();
    checkLocalImage();
    setTimeout(() => { saveSuccess = false; }, 3000);
  } catch (e) {
    saveError = e instanceof Error ? e.message : 'Failed to save';
  } finally {
    saving = false;
  }
}

async function startBuild() {
  building = true;
  buildDone = false;
  buildError = '';
  currentStep = 0;
  totalSteps = 0;
  logs = [];
  pushDone = false;
  pushError = '';

  try {
    await physicalAiClient.buildSimulationImage(tag);
    startPolling('build');
  } catch (e) {
    building = false;
    buildError = e instanceof Error ? e.message : typeof e === 'string' ? e : 'Build failed to start';
  }
}

async function startPush() {
  pushing = true;
  pushDone = false;
  pushError = '';
  pushDigest = '';
  pushStatus = 'Pushing...';

  try {
    await physicalAiClient.pushImage(tag);
    startPolling('push');
  } catch (e) {
    pushing = false;
    pushError = e instanceof Error ? e.message : typeof e === 'string' ? e : 'Push failed to start';
  }
}

function startPolling(mode: 'build' | 'push') {
  stopPolling();
  pollTimer = window.setInterval(async () => {
    try {
      if (mode === 'build') {
        const progress = await physicalAiClient.getBuildProgress(tag);
        if (progress) {
          logs = progress.logs;
          currentStep = progress.currentStep ?? 0;
          totalSteps = progress.totalSteps ?? 0;
          if (logContainer) logContainer.scrollTop = logContainer.scrollHeight;

          if (progress.done) {
            stopPolling();
            building = false;
            buildDone = true;
            if (progress.error) {
              buildError = progress.error;
            } else {
              imageExistsLocally = true;
            }
          }
        }
      } else {
        const progress = await physicalAiClient.getPushProgress(tag);
        if (progress) {
          pushStatus = progress.status;

          if (progress.done) {
            stopPolling();
            pushing = false;
            pushDone = true;
            if (progress.error) {
              pushError = progress.error;
            } else {
              const digestLine = progress.logs.find(l => l.includes('digest:'));
              if (digestLine) {
                const match = digestLine.match(/digest:\s*(sha256:\w+)/);
                if (match) pushDigest = match[1];
              }
            }
          }
        }
      }
    } catch {
      // ignore polling errors
    }
  }, 500);
}

function stopPolling() {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

function resetBuild() {
  buildDone = false;
  buildError = '';
  logs = [];
  currentStep = 0;
  totalSteps = 0;
  pushDone = false;
  pushError = '';
  pushDigest = '';
  checkLocalImage();
}

onDestroy(() => {
  stopPolling();
});

$: progressPercent = totalSteps > 0 ? Math.round((currentStep / totalSteps) * 100) : 0;
$: canPush = (imageExistsLocally || (buildDone && !buildError)) && !pushing && !pushDone;
</script>

<style>
  @keyframes indeterminate {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(400%); }
  }
  .push-progress-bar {
    animation: indeterminate 1.5s ease-in-out infinite;
  }
</style>

<div class="flex flex-col p-4 gap-4 h-full overflow-auto">
  <button
    on:click={() => router.goto('/')}
    class="text-sm text-purple-500 hover:underline self-start cursor-pointer"
  >
    &larr; Back to Dashboard
  </button>
  <h1 class="text-3xl text-[var(--pd-content-header)]">Simulation Setup</h1>
  <p class="text-sm text-[var(--pd-content-text)]">
    Configure your robot simulation environment. These selections will be used when launching simulations.
  </p>

  {#if loading}
    <div class="text-sm text-[var(--pd-content-text)]">Loading configuration...</div>
  {:else}
    <div class="flex flex-col gap-4 max-w-md">

      <div class="flex flex-col gap-1">
        <label for="robot" class="text-xs text-[var(--pd-content-text)]">Robot type</label>
        <select
          id="robot"
          bind:value={robot}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]"
        >
          <option value="turtlebot3">TurtleBot3</option>
        </select>
      </div>

      <div class="flex flex-col gap-1">
        <label for="distro" class="text-xs text-[var(--pd-content-text)]">ROS distro</label>
        <select
          id="distro"
          bind:value={distro}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]"
        >
          <option value="humble">Humble (simulation/desktop)</option>
          <option value="jazzy">Jazzy (base/headless)</option>
        </select>
      </div>

      <div class="flex flex-col gap-1">
        <label for="middleware" class="text-xs text-[var(--pd-content-text)]">Middleware</label>
        <select
          id="middleware"
          bind:value={middleware}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]"
        >
          <option value="dds">DDS (default)</option>
          <option value="zenoh" disabled>Zenoh (coming soon)</option>
        </select>
      </div>

      <div class="flex flex-col gap-1">
        <label for="engine" class="text-xs text-[var(--pd-content-text)]">Simulation engine</label>
        <select
          id="engine"
          bind:value={engine}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]"
        >
          <option value="gazebo">Gazebo</option>
        </select>
      </div>

      <div class="flex flex-row items-center gap-3 mt-2">
        <button
          on:click={save}
          disabled={saving}
          class="px-4 py-1.5 text-sm rounded disabled:opacity-50 disabled:cursor-not-allowed"
          style="background-color: #7c3aed; color: #ffffff;"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>

        {#if saveSuccess}
          <span class="text-sm" style="color: #16a34a;">Configuration saved</span>
        {/if}
        {#if saveError}
          <span class="text-sm" style="color: #dc2626;">{saveError}</span>
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
      </div>
    </div>

    <hr class="border-[var(--pd-content-card-border)] my-2" />

    <h2 class="text-xl text-[var(--pd-content-header)]">Build & Push Simulation Image</h2>
    <p class="text-sm text-[var(--pd-content-text)]">
      Build the simulation image locally from the bundled Containerfile and optionally push to a registry.
    </p>

    <div class="flex flex-row gap-3 items-end">
      <div class="flex flex-col gap-1">
        <label for="simTag" class="text-xs text-[var(--pd-content-text)]">Image tag</label>
        <input
          id="simTag"
          type="text"
          bind:value={tag}
          disabled={building || pushing}
          on:change={() => checkLocalImage()}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] w-96"
          placeholder="e.g. quay.io/ecosystem-appeng/ros2-humble-turtlebot3:latest"
        />
      </div>
      {#if !building && !pushing}
        <button
          on:click={startBuild}
          disabled={!tag}
          class="px-4 py-1.5 text-sm rounded disabled:opacity-50 disabled:cursor-not-allowed"
          style="background-color: #7c3aed; color: #ffffff;"
        >
          {imageExistsLocally ? 'Rebuild' : 'Build'}
        </button>
      {/if}
    </div>

    {#if imageExistsLocally && !building && !buildDone}
      <div class="text-xs" style="color: #16a34a;">
        &#10003; Image exists locally: <span class="font-mono">{tag}</span>
      </div>
    {/if}

    {#if building || buildDone}
      <div class="flex flex-col gap-3">
        {#if totalSteps > 0}
          <div class="flex flex-col gap-1">
            <div class="text-xs text-[var(--pd-content-text)]">
              {#if buildDone && !buildError}
                Complete — Step {totalSteps}/{totalSteps}
              {:else}
                Step {currentStep}/{totalSteps}
              {/if}
            </div>
            <div style="background-color: #e5e7eb; border-radius: 4px; height: 8px; width: 100%; max-width: 400px; overflow: hidden;">
              <div style="background-color: {buildError ? '#dc2626' : '#7c3aed'}; height: 100%; width: {buildDone && !buildError ? 100 : progressPercent}%; transition: width 0.3s;"></div>
            </div>
          </div>
        {:else if building}
          <div class="text-xs" style="color: #7c3aed;">Starting build...</div>
        {/if}

        <div class="flex flex-col gap-1">
          <button
            on:click={() => buildLogsExpanded = !buildLogsExpanded}
            class="text-xs text-[var(--pd-content-text)] self-start cursor-pointer hover:underline"
          >
            {buildLogsExpanded ? '▼' : '▶'} Build logs ({logs.length} lines)
          </button>
          {#if buildLogsExpanded}
            <div
              bind:this={logContainer}
              class="rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] font-mono text-xs text-[var(--pd-content-text)]"
              style="max-height: 400px; overflow-y: auto; padding: 8px; white-space: pre-wrap; word-break: break-all;"
            >
              {#each logs as line}
                <div>{line}</div>
              {/each}
              {#if building && logs.length === 0}
                <div style="color: #7c3aed;">Waiting for build output...</div>
              {/if}
            </div>
          {/if}
        </div>

        {#if buildDone}
          <div class="flex flex-row items-center gap-3">
            {#if buildError}
              <div class="text-sm p-3 rounded" style="background-color: #fef2f2; color: #991b1b;">
                Build failed: {buildError}
              </div>
            {:else}
              <div class="text-sm" style="color: #16a34a;">
                Image built successfully: <span class="font-mono">{tag}</span>
              </div>
            {/if}
            <button
              on:click={resetBuild}
              class="text-xs cursor-pointer hover:underline"
              style="color: #7c3aed;"
            >
              Build again
            </button>
          </div>
        {/if}
      </div>
    {/if}

    {#if canPush}
      <div class="flex flex-row items-center gap-3 mt-2">
        <button
          on:click={startPush}
          class="px-4 py-1.5 text-sm rounded"
          style="background-color: #7c3aed; color: #ffffff;"
        >
          Push to Registry
        </button>
        <span class="text-xs text-[var(--pd-content-text)]">Push <span class="font-mono">{tag}</span> to the registry</span>
      </div>
    {/if}

    {#if pushing || pushDone}
      <div class="flex flex-col gap-3 mt-2">
        {#if pushing}
          <div class="text-xs" style="color: #7c3aed;">{pushStatus}</div>
          <div style="background-color: #e5e7eb; border-radius: 4px; height: 8px; width: 100%; max-width: 400px; overflow: hidden;">
            <div class="push-progress-bar" style="background-color: #7c3aed; height: 100%; width: 30%;"></div>
          </div>
        {/if}

        {#if pushDone}
          <div class="flex flex-row items-center gap-3">
            {#if pushError}
              <div class="text-sm p-3 rounded" style="background-color: #fef2f2; color: #991b1b;">
                Push failed: {pushError}
              </div>
              <button
                on:click={startPush}
                class="text-xs cursor-pointer hover:underline"
                style="color: #7c3aed;"
              >
                Retry push
              </button>
            {:else}
              <div class="text-sm" style="color: #16a34a;">
                Image pushed successfully to registry
                {#if pushDigest}
                  <div class="text-xs mt-1" style="color: #4b5563;">
                    <span class="font-mono">{tag}</span>
                    <br />
                    Digest: <span class="font-mono">{pushDigest}</span>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>
