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

<div class="flex flex-col p-4 gap-4">
  <h1 class="text-3xl text-[var(--pd-content-header)]">Physical AI</h1>
  <p class="text-[var(--pd-content-text)]">
    Podman Desktop extension for Physical AI robotics development.
  </p>

  <div class="flex flex-col gap-2 mt-4">
    <div class="text-lg text-[var(--pd-content-header)]">Quick Links</div>
    <div class="grid grid-cols-3 gap-4">
      <button
        on:click={() => router.goto('/images')}
        class="p-4 rounded-lg bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-card-border)] text-left hover:border-purple-500 cursor-pointer"
      >
        <div class="text-lg">Image Catalog</div>
        <div class="text-sm text-gray-700">Browse and pull container images</div>
      </button>
      <div class="p-4 rounded-lg bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-card-border)]">
        <div class="text-lg">Simulation</div>
        <div class="text-sm text-gray-700">Launch ROS2 + Gazebo simulations</div>
        <div class="text-xs text-gray-900 mt-2">Coming soon</div>
      </div>
      <div class="p-4 rounded-lg bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-card-border)]">
        <div class="text-lg">Fleet</div>
        <div class="text-sm text-gray-700">Scale to multi-robot local fleet</div>
        <div class="text-xs text-gray-900 mt-2">Coming soon</div>
      </div>
    </div>
  </div>

  <div class="text-xs text-gray-900 mt-4">
    Status: {status}
  </div>
</div>
