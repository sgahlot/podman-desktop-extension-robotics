<script lang="ts">
import { physicalAiClient } from './api/client';
import { onMount } from 'svelte';
import { router } from 'tinro';

let status = 'Loading...';

onMount(async () => {
  try {
    status = await physicalAiClient.getStatus();
  } catch {
    status = 'Unable to connect to backend';
  }
});
</script>

<style>
  .card-tooltip {
    position: relative;
  }
  .card-tooltip .tooltip-text {
    visibility: hidden;
    opacity: 0;
    position: absolute;
    bottom: 100%;
    left: 0;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    white-space: nowrap;
    background-color: var(--pai-tooltip-bg);
    color: var(--pai-tooltip-text);
    pointer-events: none;
    transition: opacity 0.15s;
    margin-bottom: 4px;
    z-index: 10;
  }
  .card-tooltip:hover .tooltip-text {
    visibility: visible;
    opacity: 1;
  }
</style>

<div class="flex flex-col p-4 gap-4">
  <h1 class="text-3xl text-[var(--pd-content-header)]">Physical AI</h1>
  <p class="text-[var(--pd-content-text)]">
    Podman Desktop extension for Physical AI robotics development.
  </p>

  <div class="flex flex-col gap-2 mt-4">
    <div class="text-lg text-[var(--pd-content-header)]">Quick Links</div>
    <div class="grid grid-cols-3 gap-4">
      <button
        on:click={() => router.goto('/build')}
        class="card-tooltip pai-card-interactive p-4 rounded-lg bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-card-border)] text-left cursor-pointer"
      >
        <span class="tooltip-text">Build and push ROS2 Jazzy base image</span>
        <div class="text-lg text-[var(--pd-content-header)]">Build &amp; Push Base Image</div>
      </button>
      <button
        on:click={() => router.goto('/images')}
        class="card-tooltip pai-card-interactive p-4 rounded-lg bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-card-border)] text-left cursor-pointer"
      >
        <span class="tooltip-text">Browse and pull container images</span>
        <div class="text-lg text-[var(--pd-content-header)]">Image Catalog</div>
      </button>
      <button
        on:click={() => router.goto('/simulation')}
        class="card-tooltip pai-card-interactive p-4 rounded-lg bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-card-border)] text-left cursor-pointer"
      >
        <span class="tooltip-text">Configure robot simulation environment</span>
        <div class="text-lg text-[var(--pd-content-header)]">Simulation Setup</div>
      </button>
      <div class="card-tooltip p-4 rounded-lg bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-card-border)]">
        <span class="tooltip-text">Scale to multi-robot local fleet</span>
        <div class="text-lg text-[var(--pd-content-header)]">Fleet</div>
        <div class="text-xs pai-text-muted mt-2">Coming soon</div>
      </div>
      <button
        on:click={() => router.goto('/help')}
        class="card-tooltip pai-card-interactive p-4 rounded-lg bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-card-border)] text-left cursor-pointer"
      >
        <span class="tooltip-text">Guide to using this extension</span>
        <div class="text-lg text-[var(--pd-content-header)]">Help</div>
      </button>
    </div>
  </div>

  <div class="text-xs pai-text-muted mt-4">
    Status: {status}
  </div>
</div>
