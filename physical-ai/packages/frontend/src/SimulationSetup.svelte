<script lang="ts">
import { physicalAiClient } from './api/client';
import { onMount } from 'svelte';
import { router } from 'tinro';
import BuildPushPanel from './lib/BuildPushPanel.svelte';

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
    setTimeout(() => { saveSuccess = false; }, 3000);
  } catch (e) {
    saveError = e instanceof Error ? e.message : 'Failed to save';
  } finally {
    saving = false;
  }
}
</script>

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

    <BuildPushPanel
      bind:tag
      buildImage={t => physicalAiClient.buildSimulationImage(t)}
      tagPlaceholder="e.g. quay.io/ecosystem-appeng/ros2-humble-turtlebot3:latest"
      tagInputId="simTag"
    />
  {/if}
</div>
