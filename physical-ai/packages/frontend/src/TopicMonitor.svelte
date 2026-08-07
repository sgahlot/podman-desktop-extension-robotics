<script lang="ts">
import { physicalAiClient } from './api/client';
import { onMount, onDestroy } from 'svelte';
import { router } from 'tinro';
import type { SimContainerInfo } from '/@shared/src/types/SimulationContainer';
import type {
  TopicInfo,
  TopicDetailInfo,
  TopicNodeInfo,
  TopicPeekResult,
  TopicSchemaResult,
} from '/@shared/src/types/TopicInfo';
import { parseEchoYamlTree, shortMessageType, PEEK_TIMEOUT_DEFAULT_SEC } from '/@shared/src/ros/topicPeek';
import MessageTree from './lib/MessageTree.svelte';

let containers: SimContainerInfo[] = [];
let selectedContainerId = '';
let topics: TopicInfo[] = [];
let loading = false;
let error = '';
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollInFlight = false;

let expandedTopic: string | null = null;
let topicDetail: TopicDetailInfo | null = null;
let loadingDetail = false;
let detailError = '';

let schema: TopicSchemaResult | null = null;
let loadingSchema = false;
let schemaError = '';
let showSchema = false;

let peeking = false;
let peekResult: TopicPeekResult | null = null;
let peekError = '';
let peekTimedOut = false;
let peekView: 'tree' | 'raw' = 'tree';
let copyFeedback = '';
let peekTimeoutSec = PEEK_TIMEOUT_DEFAULT_SEC;

$: runningContainers = containers.filter(c => c.state === 'running');
$: hasRunning = runningContainers.length > 0;
$: peekTree = peekResult?.message ? parseEchoYamlTree(peekResult.message) : [];
$: peekTreeUsable = peekTree.length > 0;

$: if (hasRunning && !selectedContainerId) {
  selectedContainerId = runningContainers[0].id;
}

$: if (selectedContainerId && !runningContainers.find(c => c.id === selectedContainerId)) {
  selectedContainerId = '';
  topics = [];
  error = '';
  expandedTopic = null;
  topicDetail = null;
  clearInspector();
}

$: if (expandedTopic && !topics.find(t => t.name === expandedTopic)) {
  expandedTopic = null;
  topicDetail = null;
  clearInspector();
}

function nodePath(node: TopicNodeInfo): string {
  if (node.nodeNamespace === '/' || node.nodeNamespace === '') {
    return `/${node.nodeName}`.replace(/\/+/g, '/');
  }
  return `${node.nodeNamespace}/${node.nodeName}`.replace(/\/+/g, '/');
}

function formatCapturedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function clearInspector() {
  peekResult = null;
  peekError = '';
  peekTimedOut = false;
  peeking = false;
  peekView = 'tree';
  copyFeedback = '';
  schema = null;
  loadingSchema = false;
  schemaError = '';
  showSchema = false;
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
  const targetId = selectedContainerId;
  pollInFlight = true;
  try {
    const next = await physicalAiClient.listRosTopics(targetId);
    if (selectedContainerId !== targetId) return;
    topics = next;
    error = '';
  } catch (e) {
    if (selectedContainerId !== targetId) return;
    error = e instanceof Error ? e.message : String(e);
  } finally {
    pollInFlight = false;
  }
}

async function refresh() {
  loading = true;
  await pollContainers();
  try {
    peekTimeoutSec = await physicalAiClient.getTopicPeekTimeoutSeconds();
  } catch {
    peekTimeoutSec = PEEK_TIMEOUT_DEFAULT_SEC;
  }
  if (selectedContainerId) {
    await pollTopics();
  }
  loading = false;
}

async function loadSchema(containerId: string, messageType: string) {
  if (!messageType || messageType === 'unknown') {
    schema = null;
    schemaError = 'Message type unknown — schema unavailable.';
    return;
  }
  loadingSchema = true;
  schemaError = '';
  schema = null;
  try {
    const result = await physicalAiClient.getRosMessageSchema(containerId, messageType);
    if (selectedContainerId !== containerId || expandedTopic === null) return;
    schema = result;
    if (result.error) schemaError = result.error;
  } catch (e) {
    if (selectedContainerId !== containerId) return;
    schemaError = e instanceof Error ? e.message : String(e);
  } finally {
    loadingSchema = false;
  }
}

async function toggleTopicDetail(topicName: string) {
  if (expandedTopic === topicName) {
    expandedTopic = null;
    topicDetail = null;
    detailError = '';
    clearInspector();
    return;
  }

  const targetId = selectedContainerId;
  const topic = topics.find(t => t.name === topicName);
  expandedTopic = topicName;
  loadingDetail = true;
  topicDetail = null;
  detailError = '';
  clearInspector();

  try {
    const detail = await physicalAiClient.getRosTopicDetail(targetId, topicName);
    if (selectedContainerId !== targetId || expandedTopic !== topicName) return;
    topicDetail = detail;
    void loadSchema(targetId, detail.type || topic?.type || '');
  } catch (e) {
    if (selectedContainerId !== targetId || expandedTopic !== topicName) return;
    detailError = e instanceof Error ? e.message : String(e);
  } finally {
    loadingDetail = false;
  }
}

async function peekTopic(topicName: string, event: MouseEvent) {
  event.stopPropagation();
  if (!selectedContainerId || peeking) return;

  const targetId = selectedContainerId;
  peeking = true;
  peekResult = null;
  peekError = '';
  peekTimedOut = false;
  copyFeedback = '';

  try {
    const result = await physicalAiClient.peekRosTopic(targetId, topicName);
    if (selectedContainerId !== targetId || expandedTopic !== topicName) return;
    peekTimedOut = result.timedOut;
    if (result.message) {
      peekResult = result;
      peekView = parseEchoYamlTree(result.message).length > 0 ? 'tree' : 'raw';
    } else {
      peekError = result.error ?? 'No message received';
    }
  } catch (e) {
    if (selectedContainerId !== targetId || expandedTopic !== topicName) return;
    peekError = e instanceof Error ? e.message : String(e);
  } finally {
    peeking = false;
  }
}

async function copyPeek(event: MouseEvent) {
  event.stopPropagation();
  if (!peekResult?.message) return;
  try {
    await navigator.clipboard.writeText(peekResult.message);
    copyFeedback = 'Copied';
    setTimeout(() => {
      copyFeedback = '';
    }, 1500);
  } catch {
    copyFeedback = 'Copy failed';
  }
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

<div class="flex flex-col p-4 gap-4 w-full flex-1 min-h-0 min-w-0 overflow-auto">
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

      <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] overflow-x-auto">
        <table class="w-full text-xs table-fixed">
          <thead>
            <tr class="text-left text-[var(--pd-content-text)] border-b border-[var(--pd-content-card-border)]">
              <th class="p-3 pr-4 w-[40%]">Topic</th>
              <th class="p-3 pr-4 w-[40%]">Message Type</th>
              <th class="p-3 pr-4 text-right w-[10%]">Pubs</th>
              <th class="p-3 text-right w-[10%]">Subs</th>
            </tr>
          </thead>
          <tbody>
            {#each topics as topic}
              <tr
                class="border-b border-[var(--pd-content-card-border)] cursor-pointer hover:bg-[var(--pd-content-bg)] transition-colors"
                on:click={() => toggleTopicDetail(topic.name)}
              >
                <td class="p-3 pr-4 font-mono font-medium text-[var(--pd-content-header)] break-all">
                  <span class="inline-block w-4 text-center text-[var(--pd-content-text)]">{expandedTopic === topic.name ? '▼' : '▶'}</span>
                  {topic.name}
                  <span
                    class="ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] font-sans font-normal pai-text-muted border border-[var(--pd-content-card-border)]"
                    title={topic.type}
                  >{shortMessageType(topic.type)}</span>
                </td>
                <td class="p-3 pr-4 font-mono text-[var(--pd-content-text)] break-all">{topic.type}</td>
                <td class="p-3 pr-4 text-right text-[var(--pd-content-text)]">{topic.publishers}</td>
                <td class="p-3 text-right text-[var(--pd-content-text)]">{topic.subscribers}</td>
              </tr>
              {#if expandedTopic === topic.name}
                <tr class="border-b border-[var(--pd-content-card-border)]">
                  <td colspan="4" class="p-4 pl-6 sm:pl-10 bg-[var(--pd-content-bg)]">
                    {#if loadingDetail}
                      <span class="text-xs text-[var(--pd-content-text)]">Loading detail...</span>
                    {:else if detailError}
                      <span class="text-xs pai-text-error">{detailError}</span>
                    {:else if topicDetail}
                      <div class="flex flex-col gap-4 min-w-0 max-w-full">
                        <!-- Soft topology: two columns (topic already in header); long names wrap -->
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
                          <div class="min-w-0 rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-3">
                            <div class="text-xs font-medium text-[var(--pd-content-header)] mb-2">
                              Publishers ({topicDetail.publishers.length})
                            </div>
                            {#if topicDetail.publishers.length === 0}
                              <span class="text-xs text-[var(--pd-content-text)]">None</span>
                            {:else}
                              {#each topicDetail.publishers as pub}
                                <div
                                  class="text-xs font-mono text-[var(--pd-content-text)] break-all py-0.5"
                                  title={nodePath(pub)}
                                >{nodePath(pub)}</div>
                              {/each}
                            {/if}
                          </div>
                          <div class="min-w-0 rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-3">
                            <div class="text-xs font-medium text-[var(--pd-content-header)] mb-2">
                              Subscribers ({topicDetail.subscribers.length})
                            </div>
                            {#if topicDetail.subscribers.length === 0}
                              <span class="text-xs text-[var(--pd-content-text)]">None</span>
                            {:else}
                              {#each topicDetail.subscribers as sub}
                                <div
                                  class="text-xs font-mono text-[var(--pd-content-text)] break-all py-0.5"
                                  title={nodePath(sub)}
                                >{nodePath(sub)}</div>
                              {/each}
                            {/if}
                          </div>
                        </div>
                        <div class="text-[10px] pai-text-muted font-mono break-all">
                          Flow: publishers → {topicDetail.topicName} → subscribers
                        </div>

                        <!-- Schema -->
                        <div class="pt-2 border-t border-[var(--pd-content-card-border)] min-w-0">
                          <button
                            type="button"
                            class="text-xs pai-link"
                            on:click|stopPropagation={() => (showSchema = !showSchema)}
                          >
                            {showSchema ? 'Hide message schema' : 'Show message schema'}
                          </button>
                          {#if showSchema}
                            <div class="mt-2 min-w-0">
                              {#if loadingSchema}
                                <span class="text-xs text-[var(--pd-content-text)]">Loading schema...</span>
                              {:else if schemaError && !schema?.schema}
                                <span class="text-xs pai-text-error">{schemaError}</span>
                              {:else if schema?.schema}
                                <pre
                                  class="rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] font-mono text-xs text-[var(--pd-content-text)] p-2 overflow-auto max-h-40 whitespace-pre-wrap break-all"
                                >{schema.schema}</pre>
                              {/if}
                            </div>
                          {/if}
                        </div>

                        <!-- Peek inspector -->
                        <div class="flex flex-col gap-2 pt-2 border-t border-[var(--pd-content-card-border)] min-w-0">
                          <div class="flex flex-row items-center gap-2 flex-wrap">
                            <button
                              type="button"
                              class="pai-btn pai-btn-primary text-xs"
                              disabled={peeking}
                              on:click={e => peekTopic(topic.name, e)}
                            >
                              {peeking ? 'Peeking...' : 'Peek'}
                            </button>
                            <span class="text-xs pai-text-muted">
                              One live message (cleaned echo, {peekTimeoutSec}s timeout — Preferences → Physical AI)
                            </span>
                          </div>

                          {#if peekError}
                            <div class="text-xs {peekTimedOut ? 'pai-text-muted' : 'pai-text-error'}">{peekError}</div>
                          {/if}

                          {#if peekResult?.message}
                            <div
                              class="rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-3 flex flex-col gap-2 min-w-0"
                              role="region"
                              aria-label="Peek message"
                            >
                              <div class="flex flex-row flex-wrap items-start justify-between gap-2 min-w-0">
                                <div class="text-xs text-[var(--pd-content-text)] flex flex-col gap-0.5 min-w-0 flex-1">
                                  <div class="break-all">
                                    <span class="pai-text-muted">Topic:</span>
                                    <span class="font-mono ml-1">{peekResult.topicName}</span>
                                  </div>
                                  <div class="break-all">
                                    <span class="pai-text-muted">Type:</span>
                                    <span class="font-mono ml-1">{topicDetail.type}</span>
                                  </div>
                                  <div>
                                    <span class="pai-text-muted">Captured:</span>
                                    <span class="ml-1">{formatCapturedAt(peekResult.capturedAt)}</span>
                                  </div>
                                  {#if peekResult.messageStamp}
                                    <div class="break-all">
                                      <span class="pai-text-muted">Msg stamp:</span>
                                      <span class="font-mono ml-1">{peekResult.messageStamp}</span>
                                      <span class="pai-text-muted ml-1">(ROS/sim time in message — not /clock)</span>
                                    </div>
                                  {/if}
                                  {#if peekResult.truncated}
                                    <div class="pai-text-muted">Message truncated for display.</div>
                                  {/if}
                                </div>
                                <div class="flex flex-row items-center gap-2 shrink-0">
                                  {#if peekTreeUsable}
                                    <div class="inline-flex rounded border border-[var(--pd-content-card-border)] overflow-hidden">
                                      <button
                                        type="button"
                                        class="px-2 py-1 text-xs {peekView === 'tree'
                                          ? 'bg-[var(--pd-content-bg)] text-[var(--pd-content-header)]'
                                          : 'text-[var(--pd-content-text)]'}"
                                        on:click={() => (peekView = 'tree')}
                                      >Tree</button>
                                      <button
                                        type="button"
                                        class="px-2 py-1 text-xs border-l border-[var(--pd-content-card-border)] {peekView === 'raw'
                                          ? 'bg-[var(--pd-content-bg)] text-[var(--pd-content-header)]'
                                          : 'text-[var(--pd-content-text)]'}"
                                        on:click={() => (peekView = 'raw')}
                                      >Raw</button>
                                    </div>
                                  {/if}
                                  <button
                                    type="button"
                                    class="pai-btn text-xs"
                                    on:click={copyPeek}
                                  >{copyFeedback || 'Copy'}</button>
                                </div>
                              </div>

                              {#if peekView === 'tree' && peekTreeUsable}
                                <div class="overflow-auto max-h-64 min-w-0">
                                  <MessageTree nodes={peekTree} />
                                </div>
                              {:else}
                                <pre
                                  class="font-mono text-xs text-[var(--pd-content-text)] overflow-auto max-h-64 whitespace-pre-wrap break-all m-0"
                                >{peekResult.message}</pre>
                              {/if}
                            </div>
                          {/if}
                        </div>
                      </div>
                    {/if}
                  </td>
                </tr>
              {/if}
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
