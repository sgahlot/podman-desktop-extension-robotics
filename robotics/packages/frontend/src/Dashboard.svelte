<script lang="ts">
import { physicalAiClient } from './api/client';
import { onMount } from 'svelte';
import { router } from 'tinro';
import { resolveOpenShiftNamespace } from './lib/resolveOpenShiftNamespace';

export let active = true;
let wasActive = false;

let status = 'Loading...';
let localRos2ImageCount = 0;
let localImagesLoaded = false;
let localSimCount = 0;
let localSimCountLoaded = false;
let openShiftSimCount = 0;
let openShiftSimCountLoaded = false;

/** Last path segment before any tag/digest, e.g. `quay.io/ns/ros2-jazzy-sim:noble` -> `ros2-jazzy-sim`. */
function imageName(ref: string): string {
  const tail = ref.slice(ref.lastIndexOf('/') + 1);
  const colonIdx = tail.indexOf(':');
  return colonIdx >= 0 ? tail.slice(0, colonIdx) : tail;
}

function openExternal(url: string): void {
  void physicalAiClient.openUrlInBrowser(url);
}

async function refreshOverviewMetrics(): Promise<void> {
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
    localSimCount = containers.filter(c => c.state === 'running').length;
  } catch {
    localSimCount = 0;
  } finally {
    localSimCountLoaded = true;
  }

  try {
    const resolved = await resolveOpenShiftNamespace();
    if (resolved?.namespace) {
      const workloads = await physicalAiClient.listOpenShiftDeployments(resolved.namespace, resolved.context);
      openShiftSimCount = workloads.length;
    } else {
      openShiftSimCount = 0;
    }
  } catch {
    openShiftSimCount = 0;
  } finally {
    openShiftSimCountLoaded = true;
  }
}

onMount(async () => {
  try {
    status = await physicalAiClient.getStatus();
  } catch {
    status = 'Unable to connect to backend';
  }
});

$: if (active && !wasActive) {
  wasActive = true;
  void refreshOverviewMetrics();
}
$: if (!active) wasActive = false;
</script>

<div class="flex flex-col p-4 gap-4 h-full overflow-auto">
  <h1 class="text-3xl text-[var(--pd-content-header)]">Robotics</h1>
  <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
    <h2 class="text-lg font-medium text-[var(--pd-content-header)]">Welcome to Robotics</h2>
    <p class="text-sm text-[var(--pd-content-text)] mt-2">
      Robotics gives developers a GUI-driven path from local development to OpenShift deployment — no terminal required.
      Build ROS 2 base and simulation images, launch TurtleBot3 in Gazebo, drive it with Nav2, and inspect live ROS 2
      topics.
    </p>
    <button on:click={() => router.goto('/help')} class="pai-link mt-2">Read the full guide &rarr;</button>
  </div>

  <div
    class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 flex flex-col gap-3">
    <h2 class="text-lg font-medium text-[var(--pd-content-header)]">Get started</h2>
    <p class="text-sm text-[var(--pd-content-text)]">
      New here? Build a ROS 2 image, launch a simulation, navigate the robot, then watch its topics.
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
      <button
        on:click={() => router.goto('/images')}
        class="pai-card-interactive rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 min-w-[10rem] text-left cursor-pointer">
        <div class="text-2xl font-semibold text-[var(--pd-content-header)]">
          {localImagesLoaded ? localRos2ImageCount : '…'}
        </div>
        <div class="text-xs pai-text-muted mt-1">Local ROS 2 images</div>
      </button>
      <button
        aria-label="Local simulations"
        on:click={() => router.goto('/simulation')}
        class="pai-card-interactive rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 min-w-[10rem] text-left cursor-pointer">
        <div class="text-2xl font-semibold text-[var(--pd-content-header)]">
          {localSimCountLoaded ? localSimCount : '…'}
        </div>
        <div class="text-xs pai-text-muted mt-1">local</div>
      </button>
      <button
        aria-label="OpenShift simulations"
        on:click={() => router.goto('/simulation/openshift')}
        class="pai-card-interactive rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 min-w-[10rem] text-left cursor-pointer">
        <div class="text-2xl font-semibold text-[var(--pd-content-header)]">
          {openShiftSimCountLoaded ? openShiftSimCount : '…'}
        </div>
        <div class="text-xs pai-text-muted mt-1">OpenShift</div>
      </button>
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
