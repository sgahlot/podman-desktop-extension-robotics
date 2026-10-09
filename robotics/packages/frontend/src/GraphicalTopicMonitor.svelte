<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { router } from 'tinro';
  import type { SimContainerInfo } from '/@shared/src/types/SimulationContainer';
  import type { TopicInfo } from '/@shared/src/types/TopicInfo';
  import { physicalAiClient } from './api/client';
  import QuickLinks from './lib/QuickLinks.svelte';
  import { navigationLayout } from './lib/navigationLayout';
  import { filterTopicsByName } from './lib/topicFilter';

  let containers: SimContainerInfo[] = [];
  let topics: TopicInfo[] = [];
  let selectedContainerId = '';
  let filterQuery = '';
  let loading = false;
  let error = '';
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let pollInFlight = false;

  $: runningContainers = containers.filter(container => container.state === 'running');
  $: filteredTopics = filterTopicsByName(topics, filterQuery);

  async function refreshTopics() {
    if (!selectedContainerId || pollInFlight) return;
    pollInFlight = true;
    try {
      topics = await physicalAiClient.listRosTopicSummaries(selectedContainerId);
      error = '';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      pollInFlight = false;
    }
  }

  async function refresh() {
    loading = true;
    try {
      await pollContainers();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function pollContainers() {
    try {
      containers = await physicalAiClient.listSimulationContainers();
      const nextRunningContainers = containers.filter(container => container.state === 'running');
      const nextContainerId = nextRunningContainers.find(container => container.id === selectedContainerId)?.id
        ?? nextRunningContainers[0]?.id
        ?? '';
      if (nextContainerId !== selectedContainerId) {
        selectedContainerId = nextContainerId;
        topics = [];
      }
      await refreshTopics();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  onMount(() => {
    void refresh();
    pollTimer = setInterval(() => {
      void pollContainers();
    }, 5000);
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
  });
</script>

<div class="flex flex-col p-4 gap-4 w-full flex-1 min-h-0 min-w-0 overflow-auto">
  {#if $navigationLayout === 'cards'}
    <button on:click={() => router.goto('/')} class="pai-link self-start"> &larr; Back to Dashboard </button>
  {/if}
  <div class="flex flex-row items-center justify-between gap-3 flex-wrap">
    <h1 class="text-3xl text-[var(--pd-content-header)]">Graphical Topic Monitor</h1>
    <div class="flex flex-row gap-1 border border-[var(--pd-content-card-border)] rounded p-1">
      <button class="px-3 py-1 text-xs pai-tab" on:click={() => router.goto('/topics')}>List</button>
      <button class="px-3 py-1 text-xs pai-tab pai-tab-active" aria-current="page">Graph</button>
    </div>
  </div>
  {#if $navigationLayout === 'cards'}
    <QuickLinks links={[{ label: 'Simulation', to: '/simulation' }]} />
  {/if}
  <p class="text-sm text-[var(--pd-content-text)]">
    Explore ROS2 node and topic relationships in a focused topology canvas.
  </p>

  {#if !runningContainers.length}
    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 max-w-lg">
      <p class="text-sm text-[var(--pd-content-text)]">
        No simulation is running. <button on:click={() => router.goto('/simulation')} class="pai-link">Launch one</button>
        to inspect topics.
      </p>
    </div>
  {:else}
    <div class="flex flex-row items-end gap-3 flex-wrap">
      <div class="flex flex-col gap-1">
        <label for="graphContainerSelect" class="text-xs text-[var(--pd-content-text)]">Simulation container</label>
        <select
          id="graphContainerSelect"
          bind:value={selectedContainerId}
          on:change={() => void refreshTopics()}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-[var(--pd-content-text)]">
          {#each runningContainers as container}
            <option value={container.id}>{container.name} — {container.imageTag}</option>
          {/each}
        </select>
      </div>
      <div class="flex flex-col gap-1 min-w-56">
        <label for="graphTopicFilter" class="text-xs text-[var(--pd-content-text)]">Filter topics</label>
        <input
          id="graphTopicFilter"
          type="search"
          bind:value={filterQuery}
          placeholder="Filter by name"
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-[var(--pd-content-text)]" />
      </div>
      <button on:click={() => void refresh()} disabled={loading} class="pai-btn pai-btn-primary">
        {loading ? 'Refreshing...' : 'Refresh'}
      </button>
    </div>

    {#if error}<div class="p-3 rounded text-sm pai-banner-error max-w-lg">{error}</div>{/if}

    <section class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] overflow-hidden">
      <div class="flex flex-row items-center justify-between gap-3 px-4 py-3 border-b border-[var(--pd-content-card-border)]">
        <div>
          <h2 class="text-sm font-medium text-[var(--pd-content-header)]">Topology canvas</h2>
          <p class="text-xs pai-text-muted mt-1">
            {#if filterQuery.trim()}
              {filteredTopics.length} of {topics.length} topics match “{filterQuery.trim()}”.
            {:else}
              {topics.length} topics available. Use the filter to focus the graph.
            {/if}
          </p>
        </div>
        <span class="text-[10px] uppercase tracking-wide pai-text-muted border border-[var(--pd-content-card-border)] rounded px-2 py-1">
          Preview
        </span>
      </div>

      {#if !filterQuery.trim()}
        <div class="relative min-h-72 p-6 grid place-items-center overflow-hidden" role="img" aria-label="ROS topology canvas preview">
          <div class="absolute inset-0 opacity-40" style="background-image: radial-gradient(var(--pd-content-card-border) 1px, transparent 1px); background-size: 20px 20px;"></div>
          <div class="relative w-full max-w-2xl h-48">
            <div class="absolute left-1/2 top-1/2 w-40 h-px bg-[var(--pd-content-card-border)] -translate-x-1/2"></div>
            <div class="absolute left-1/2 top-1/2 h-28 w-px bg-[var(--pd-content-card-border)] -translate-y-1/2"></div>
            <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg border-2 border-[var(--pd-content-accent)] bg-[var(--pd-content-bg)] px-4 py-3 text-center shadow-sm">
              <div class="text-xs font-medium text-[var(--pd-content-header)]">ROS 2 graph</div>
              <div class="text-[10px] pai-text-muted mt-1">{topics.length} topics loaded</div>
            </div>
            <div class="absolute left-0 top-1/2 -translate-y-1/2 rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] px-4 py-3 text-center">
              <div class="text-xs font-medium text-[var(--pd-content-header)]">Nodes</div>
              <div class="text-[10px] pai-text-muted mt-1">publishers</div>
            </div>
            <div class="absolute right-0 top-1/2 -translate-y-1/2 rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] px-4 py-3 text-center">
              <div class="text-xs font-medium text-[var(--pd-content-header)]">Topics</div>
              <div class="text-[10px] pai-text-muted mt-1">subscribers</div>
            </div>
            <div class="absolute left-1/2 bottom-0 -translate-x-1/2 rounded-lg border border-dashed border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] px-4 py-2 text-[10px] pai-text-muted">
              Detailed topology layout coming next
            </div>
          </div>
        </div>
      {/if}

      <div class="border-t border-[var(--pd-content-card-border)]">
        <div class="flex flex-row items-center justify-between gap-3 px-4 py-3">
          <h3 class="text-sm font-medium text-[var(--pd-content-header)]">Topic inventory</h3>
          <span class="text-xs pai-text-muted">{filteredTopics.length} shown</span>
        </div>
        {#if filteredTopics.length === 0}
          <div class="px-4 pb-5 text-sm text-[var(--pd-content-text)]">No topics match the current filter.</div>
        {:else}
          <div class="max-h-[32rem] overflow-auto border-t border-[var(--pd-content-card-border)]">
            <table class="w-full text-xs">
              <thead class="sticky top-0 bg-[var(--pd-content-card-bg)]">
                <tr class="text-left text-[var(--pd-content-text)] border-b border-[var(--pd-content-card-border)]">
                  <th class="p-3">Topic</th>
                  <th class="p-3">Message type</th>
                  <th class="p-3 text-right">Pubs</th>
                  <th class="p-3 text-right">Subs</th>
                </tr>
              </thead>
              <tbody>
                {#each filteredTopics as topic (topic.name)}
                  <tr class="border-b border-[var(--pd-content-card-border)] last:border-b-0">
                    <td class="p-3 font-mono text-[var(--pd-content-header)] break-all">{topic.name}</td>
                    <td class="p-3 font-mono text-[var(--pd-content-text)] break-all">{topic.type}</td>
                    <td class="p-3 text-right text-[var(--pd-content-text)]">{topic.countsPending ? '—' : topic.publishers}</td>
                    <td class="p-3 text-right text-[var(--pd-content-text)]">{topic.countsPending ? '—' : topic.subscribers}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </section>
  {/if}
</div>
