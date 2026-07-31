<script lang="ts">
import { physicalAiClient } from './api/client';
import { onMount, onDestroy } from 'svelte';
import { router } from 'tinro';
import type { SimContainerInfo } from '/@shared/src/types/SimulationContainer';
import type { TopicInfo } from '/@shared/src/types/TopicInfo';

let containers: SimContainerInfo[] = [];
let selectedContainerId = '';
let topics: TopicInfo[] = [];
let loading = false;
let error = '';
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollInFlight = false;

$: runningContainers = containers.filter(c => c.state === 'running');
$: hasRunning = runningContainers.length > 0;

$: if (hasRunning && !selectedContainerId) {
  selectedContainerId = runningContainers[0].id;
}

$: if (selectedContainerId && !runningContainers.find(c => c.id === selectedContainerId)) {
  selectedContainerId = '';
  topics = [];
  error = '';
}

async function pollContainers() {
  try {
    containers = await physicalAiClient.listSimulationContainers();
  } catch {
    // keep previous state
  }
}

async function pollTopics() {
  if (!selectedContainerId || pollInFlight) return;
  pollInFlight = true;
  try {
    topics = await physicalAiClient.listRosTopics(selectedContainerId);
    error = '';
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    pollInFlight = false;
  }
}

async function refresh() {
  loading = true;
  await pollContainers();
  if (selectedContainerId) {
    await pollTopics();
  }
  loading = false;
}

onMount(() => {
  refresh();
  pollTimer = setInterval(() => {
    pollContainers();
    pollTopics();
  }, 5000);
});

onDestroy(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<div class="flex flex-col p-4 gap-4 h-full overflow-auto">
  <button on:click={() => router.goto('/')} class="pai-link self-start">
    &larr; Back to Dashboard
  </button>
  <h1 class="text-3xl text-[var(--pd-content-header)]">Topic Monitor</h1>
  <p class="text-sm text-[var(--pd-content-text)]">
    Inspect active ROS2 topics, message types, and publisher/subscriber counts in a running simulation.
  </p>

  {#if !hasRunning}
    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 max-w-lg">
      <p class="text-sm text-[var(--pd-content-text)]">
        No simulation is running.
        <button on:click={() => router.goto('/simulation')} class="pai-link">Launch one</button>
        to inspect topics.
      </p>
    </div>
  {:else}
    <div class="flex flex-row items-end gap-3 flex-wrap">
      <div class="flex flex-col gap-1">
        <label for="containerSelect" class="text-xs text-[var(--pd-content-text)]">Simulation container</label>
        <select
          id="containerSelect"
          bind:value={selectedContainerId}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-[var(--pd-content-text)]"
        >
          {#each runningContainers as c}
            <option value={c.id}>{c.name} — {c.imageTag}</option>
          {/each}
        </select>
      </div>
      <button
        on:click={refresh}
        disabled={loading}
        class="pai-btn pai-btn-primary"
      >
        {loading ? 'Refreshing...' : 'Refresh'}
      </button>
    </div>

    {#if error}
      <div class="p-3 rounded text-sm pai-banner-error max-w-lg">{error}</div>
    {/if}

    {#if topics.length === 0 && !loading && !error}
      <div class="text-sm text-[var(--pd-content-text)]">
        No topics detected yet. The simulation may still be starting up — topics appear once ROS2 nodes are active.
      </div>
    {:else if topics.length > 0}
      <div class="text-xs pai-text-muted">{topics.length} active topics</div>

      <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] overflow-hidden">
        <table class="w-full text-xs">
          <thead>
            <tr class="text-left text-[var(--pd-content-text)] border-b border-[var(--pd-content-card-border)]">
              <th class="p-3 pr-4">Topic</th>
              <th class="p-3 pr-4">Message Type</th>
              <th class="p-3 pr-4 text-right">Pubs</th>
              <th class="p-3 text-right">Subs</th>
            </tr>
          </thead>
          <tbody>
            {#each topics as topic}
              <tr class="border-b border-[var(--pd-content-card-border)] last:border-b-0">
                <td class="p-3 pr-4 font-mono font-medium text-[var(--pd-content-header)]">{topic.name}</td>
                <td class="p-3 pr-4 font-mono text-[var(--pd-content-text)]">{topic.type}</td>
                <td class="p-3 pr-4 text-right text-[var(--pd-content-text)]">{topic.publishers}</td>
                <td class="p-3 text-right text-[var(--pd-content-text)]">{topic.subscribers}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    {#if loading}
      <div class="text-sm text-[var(--pd-content-text)]">Loading topics...</div>
    {/if}
  {/if}
</div>
