<script lang="ts">
import { physicalAiClient } from './api/client';
import { onMount } from 'svelte';
import { router } from 'tinro';
import BuildPushPanel from './lib/BuildPushPanel.svelte';

let tag = '';

onMount(async () => {
  const ns = await physicalAiClient.getDefaultNamespace();
  tag = `quay.io/${ns}/ros2-jazzy-base:latest`;
});
</script>

<div class="flex flex-col p-4 gap-4 h-full overflow-auto">
  <button on:click={() => router.goto('/')} class="pai-link self-start">
    &larr; Back to Dashboard
  </button>
  <h1 class="text-3xl text-[var(--pd-content-header)]">Build & Push Base Image</h1>
  <p class="text-sm text-[var(--pd-content-text)]">
    Build the ROS2 Jazzy base image locally and optionally push to a registry.
  </p>

  {#if tag}
    <BuildPushPanel
      bind:tag
      buildImage={t => physicalAiClient.buildBaseImage(t)}
      tagPlaceholder="e.g. quay.io/ecosystem-appeng/ros2-jazzy-base:latest"
      tagInputId="tag"
    />
  {/if}
</div>
