<script lang="ts">
import { physicalAiClient } from './api/client';
import { onMount } from 'svelte';
import { router } from 'tinro';
import BuildPushPanel from './lib/BuildPushPanel.svelte';
import {
  resolveSimulationProfile,
  simulationImageTag,
} from '/@shared/src/types/SimulationProfiles';
import type { SimulationConfig } from '/@shared/src/types/SimulationConfig';

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
let lastConfigKey = '';

$: currentConfig = { robot, distro, middleware, engine } as SimulationConfig;
$: profile = resolveSimulationProfile(currentConfig);
$: {
  const key = `${ns}|${robot}|${distro}|${middleware}|${engine}`;
  if (key !== lastConfigKey) {
    lastConfigKey = key;
    tag = simulationImageTag(ns, currentConfig) ?? '';
  }
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
  }
});

async function save() {
  saving = true;
  saveSuccess = false;
  saveError = '';

  try {
    await physicalAiClient.saveSimulationConfig(currentConfig);
    saveSuccess = true;
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
          <option value="jazzy" disabled>Jazzy (no simulation image yet — use Build Base Image)</option>
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
        {#if profile}
          <div class="mt-1" style="color: #16a34a;">
            &#10003; Buildable: {profile.label}
          </div>
        {:else}
          <div class="mt-1" style="color: #dc2626;">
            No bundled simulation image for this combination yet.
          </div>
        {/if}
      </div>
    </div>

    <hr class="border-[var(--pd-content-card-border)] my-2" />

    <h2 class="text-xl text-[var(--pd-content-header)]">Build & Push Simulation Image</h2>

    {#if profile && tag}
      <p class="text-sm text-[var(--pd-content-text)]">
        Builds <span class="font-mono">{profile.assetDir}</span> from the bundled Containerfile
        using your current wizard selection (Save is optional for build; required for Story 2 launch later).
      </p>

      <BuildPushPanel
        bind:tag
        buildImage={t => physicalAiClient.buildSimulationImage(t, currentConfig)}
        tagPlaceholder="e.g. quay.io/ecosystem-appeng/ros2-humble-turtlebot3:latest"
        tagInputId="simTag"
      />
    {:else}
      <p class="text-sm p-3 rounded" style="background-color: #fef2f2; color: #991b1b;">
        Cannot build: no simulation Containerfile is bundled for
        <span class="font-mono">{distro}/{robot}/{middleware}/{engine}</span>.
        Choose a supported combination (currently Humble + TurtleBot3 + DDS + Gazebo).
      </p>
    {/if}
  {/if}
</div>
