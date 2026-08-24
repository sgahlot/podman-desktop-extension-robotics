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

<script lang="ts">
import { physicalAiClient } from './api/client';
import { onMount } from 'svelte';
import { router } from 'tinro';
import LayoutSwitcher from './lib/LayoutSwitcher.svelte';

export let layout: 'sidebar' | 'tabs' | 'cards' = 'cards';
export let onLayoutChange: ((next: 'sidebar' | 'tabs' | 'cards') => void) | undefined = undefined;

let status = 'Loading...';
let localRos2ImageCount = 0;
let localImagesLoaded = false;
let runningSimCount = 0;
let simCountLoaded = false;

/** Last path segment before any tag/digest, e.g. `quay.io/ns/ros2-jazzy-sim:noble` -> `ros2-jazzy-sim`. */
function imageName(ref: string): string {
  const tail = ref.slice(ref.lastIndexOf('/') + 1);
  const colonIdx = tail.indexOf(':');
  return colonIdx >= 0 ? tail.slice(0, colonIdx) : tail;
}

function openExternal(url: string): void {
  void physicalAiClient.openUrlInBrowser(url);
}

onMount(async () => {
  try {
    status = await physicalAiClient.getStatus();
  } catch {
    status = 'Unable to connect to backend';
  }

  try {
    const images = await physicalAiClient.listLocalImages();
    localRos2ImageCount = images.filter(ref => imageName(ref).includes('ros2-')).length;
  } catch {
    localRos2ImageCount = 0;
  } finally {
    localImagesLoaded = true;
  }

  try {
    const containers = await physicalAiClient.listSimulationContainers();
    runningSimCount = containers.length;
  } catch {
    runningSimCount = 0;
  } finally {
    simCountLoaded = true;
  }
});
</script>

<div class="flex flex-col p-4 gap-4 h-full overflow-auto">
  <div class="flex flex-row items-start justify-between gap-4">
    <h1 class="text-3xl text-[var(--pd-content-header)]">Physical AI</h1>
    {#if layout === 'cards' && onLayoutChange}
      <div class="flex flex-col items-end gap-1 shrink-0">
        <span class="text-xs pai-text-muted">Layout</span>
        <LayoutSwitcher value={layout} onSelect={onLayoutChange} />
      </div>
    {/if}
  </div>
  <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
    <h2 class="text-lg font-medium text-[var(--pd-content-header)]">Welcome to Physical AI</h2>
    <p class="text-sm text-[var(--pd-content-text)] mt-2">
      Physical AI gives robotics developers a GUI-driven path from local development to OpenShift deployment — no
      terminal required. Build ROS 2 base and simulation images, launch TurtleBot3 in Gazebo, drive it with Nav2, and
      inspect live ROS 2 topics.
    </p>
    <button on:click={() => router.goto('/help')} class="pai-link mt-2">Read the full guide &rarr;</button>
  </div>

  {#if layout === 'cards'}
    <div class="flex flex-col gap-2">
      <div class="text-lg text-[var(--pd-content-header)]">Quick Links</div>
      <div class="grid grid-cols-3 gap-4">
        <button
          on:click={() => router.goto('/build')}
          class="card-tooltip pai-card-interactive p-4 rounded-lg bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-card-border)] text-left cursor-pointer">
          <span class="tooltip-text">Build and push ROS2 base and simulation images</span>
          <div class="text-lg text-[var(--pd-content-header)]">Image Builder</div>
        </button>
        <button
          on:click={() => router.goto('/images')}
          class="card-tooltip pai-card-interactive p-4 rounded-lg bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-card-border)] text-left cursor-pointer">
          <span class="tooltip-text">Browse and pull container images</span>
          <div class="text-lg text-[var(--pd-content-header)]">Image Catalog</div>
        </button>
        <button
          on:click={() => router.goto('/simulation')}
          class="card-tooltip pai-card-interactive p-4 rounded-lg bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-card-border)] text-left cursor-pointer">
          <span class="tooltip-text">Run robot simulations locally or on OpenShift</span>
          <div class="text-lg text-[var(--pd-content-header)]">Simulation</div>
        </button>
        <button
          on:click={() => router.goto('/topics')}
          class="card-tooltip pai-card-interactive p-4 rounded-lg bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-card-border)] text-left cursor-pointer">
          <span class="tooltip-text">View active ROS2 topics and message details</span>
          <div class="text-lg text-[var(--pd-content-header)]">Topic Monitor</div>
        </button>
        <div
          class="card-tooltip p-4 rounded-lg bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-card-border)]">
          <span class="tooltip-text">Scale to multi-robot local fleet</span>
          <div class="text-lg text-[var(--pd-content-header)]">Fleet</div>
          <div class="text-xs pai-text-muted mt-2">Coming soon</div>
        </div>
        <button
          on:click={() => router.goto('/help')}
          class="card-tooltip pai-card-interactive p-4 rounded-lg bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-card-border)] text-left cursor-pointer">
          <span class="tooltip-text">Guide to using this extension</span>
          <div class="text-lg text-[var(--pd-content-header)]">Help</div>
        </button>
      </div>
    </div>
  {/if}

  <div
    class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 flex flex-col gap-3">
    <h2 class="text-lg font-medium text-[var(--pd-content-header)]">Get started</h2>
    <p class="text-sm text-[var(--pd-content-text)]">
      New here? Build a ROS 2 image, launch a simulation, drive the robot, then watch its topics.
    </p>
    <div class="flex flex-wrap gap-2">
      <button
        on:click={() => router.goto('/build')}
        class="px-3 py-1.5 rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-sm text-[var(--pd-content-text)] cursor-pointer">
        1 &middot; Build
      </button>
      <button
        on:click={() => router.goto('/simulation')}
        class="px-3 py-1.5 rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-sm text-[var(--pd-content-text)] cursor-pointer">
        2 &middot; Simulate
      </button>
      <button
        on:click={() => router.goto('/simulation')}
        class="px-3 py-1.5 rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-sm text-[var(--pd-content-text)] cursor-pointer">
        3 &middot; Navigate
      </button>
      <button
        on:click={() => router.goto('/topics')}
        class="px-3 py-1.5 rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-sm text-[var(--pd-content-text)] cursor-pointer">
        4 &middot; Monitor
      </button>
    </div>
    <button on:click={() => router.goto('/build')} class="pai-btn pai-btn-primary self-start"
      >Open Image Builder</button>
  </div>

  <div class="flex flex-col gap-2">
    <h2 class="text-lg font-medium text-[var(--pd-content-header)]">Overview</h2>
    <div class="flex flex-row flex-wrap gap-4">
      <div
        class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 min-w-[10rem]">
        <div class="text-2xl font-semibold text-[var(--pd-content-header)]">
          {localImagesLoaded ? localRos2ImageCount : '…'}
        </div>
        <div class="text-xs pai-text-muted mt-1">Local ROS 2 images</div>
      </div>
      <div
        class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 min-w-[10rem]">
        <div class="text-2xl font-semibold text-[var(--pd-content-header)]">
          {simCountLoaded ? runningSimCount : '…'}
        </div>
        <div class="text-xs pai-text-muted mt-1">Running simulations</div>
      </div>
    </div>
  </div>

  <div class="flex flex-col gap-2">
    <h2 class="text-lg font-medium text-[var(--pd-content-header)]">Explore</h2>
    <div class="grid grid-cols-3 gap-4">
      <button
        on:click={() => openExternal('https://docs.ros.org/en/jazzy/')}
        class="pai-card-interactive rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 text-left cursor-pointer">
        <div class="text-lg text-[var(--pd-content-header)]">ROS 2 Jazzy documentation</div>
        <div class="text-xs pai-text-muted mt-1">Official ROS 2 Jazzy docs.</div>
        <div class="text-xs pai-text-accent mt-2">Learn more &#8599;</div>
      </button>
      <button
        on:click={() => openExternal('https://emanual.robotis.com/docs/en/platform/turtlebot3/overview/')}
        class="pai-card-interactive rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 text-left cursor-pointer">
        <div class="text-lg text-[var(--pd-content-header)]">TurtleBot3</div>
        <div class="text-xs pai-text-muted mt-1">TurtleBot3 platform manual.</div>
        <div class="text-xs pai-text-accent mt-2">Learn more &#8599;</div>
      </button>
      <button
        on:click={() => openExternal('https://docs.nav2.org/')}
        class="pai-card-interactive rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 text-left cursor-pointer">
        <div class="text-lg text-[var(--pd-content-header)]">Nav2</div>
        <div class="text-xs pai-text-muted mt-1">Navigation2 documentation.</div>
        <div class="text-xs pai-text-accent mt-2">Learn more &#8599;</div>
      </button>
      <button
        on:click={() => router.goto('/help')}
        class="pai-card-interactive rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 text-left cursor-pointer">
        <div class="text-lg text-[var(--pd-content-header)]">Extension guide</div>
        <div class="text-xs pai-text-muted mt-1">Full in-app help for this extension.</div>
        <div class="text-xs pai-text-accent mt-2">Open &rarr;</div>
      </button>
    </div>
  </div>

  <div class="text-xs pai-text-muted mt-4">
    Status: {status}
  </div>
</div>
