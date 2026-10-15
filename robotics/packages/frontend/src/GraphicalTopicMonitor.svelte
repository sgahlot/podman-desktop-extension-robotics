<style>
.graph-selectable:focus {
  outline: none;
}

.graph-selectable:focus-visible {
  outline: 2px solid var(--pai-accent, #7c3aed);
  outline-offset: 4px;
}

.live-telemetry-toggle {
  border: 1px solid var(--pai-accent, #7c3aed);
  border-radius: 0.6rem;
  background: var(--pd-button-secondary-bg, #ede9fe);
  padding: 0.4rem 0.75rem;
  box-shadow: 0 0 0 1px rgb(124 58 237 / 12%);
  transition:
    box-shadow 120ms ease,
    background-color 120ms ease;
}

.live-telemetry-toggle:hover,
.live-telemetry-toggle:focus-within {
  box-shadow: 0 0 0 2px rgb(124 58 237 / 24%);
}

.live-telemetry-toggle.enabled {
  border-width: 2px;
  padding: calc(0.4rem - 1px) calc(0.75rem - 1px);
  box-shadow: 0 0 0 2px rgb(124 58 237 / 24%);
}

.live-telemetry-toggle input {
  width: 1rem;
  height: 1rem;
  accent-color: var(--pai-accent, #7c3aed);
}

.topic-publish-pulse rect {
  animation: pai-topic-publish-success 900ms ease-out 1;
}

@keyframes pai-topic-publish-success {
  0% {
    filter: drop-shadow(0 0 0 rgb(124 58 237 / 0%));
    stroke-width: 2;
  }
  35% {
    filter: drop-shadow(0 0 10px rgb(124 58 237 / 75%));
    stroke-width: 5;
  }
  100% {
    filter: drop-shadow(0 0 0 rgb(124 58 237 / 0%));
    stroke-width: 2;
  }
}

@media (prefers-reduced-motion: reduce) {
  .topic-publish-pulse rect {
    animation: none;
    stroke-width: 4;
  }
}
</style>

<script lang="ts">
import { onDestroy, onMount } from 'svelte';
import { router } from 'tinro';
import type { SimContainerInfo } from '/@shared/src/types/SimulationContainer';
import type {
  NodeDetail,
  TopicDetailInfo,
  TopicGraphTopology,
  TopicInfo,
  TopicPeekResult,
  TopicPublishResult,
  TopicSchemaResult,
  TopicTelemetry,
} from '/@shared/src/types/TopicInfo';
import { physicalAiClient } from './api/client';
import {
  getRosTopicPublishWarning,
  ROS_TOPIC_PUBLISH_MAX_BYTES,
  topicPublishPayloadBytes,
} from '/@shared/src/ros/topicPublish';
import QuickLinks from './lib/QuickLinks.svelte';
import TopicMonitor from './TopicMonitor.svelte';
import TopicEndpoints from './lib/TopicEndpoints.svelte';
import { navigationLayout } from './lib/navigationLayout';
import { filterTopicsByName, groupTopicsByNamespace } from './lib/topicFilter';

const GRAPH_WIDTH = 1000;
const GRAPH_MIN_HEIGHT = 160;
const MAX_CONNECTED_NODES = 5;
const TOPIC_TELEMETRY_REFRESH_MS = 8000;
const TOPIC_TELEMETRY_SAMPLE_SECONDS = 3;

type ViewMode = 'list' | 'graph' | 'cards';
type FilterKind = 'topic' | 'publisher' | 'subscriber';

let containers: SimContainerInfo[] = [];
let topology: TopicGraphTopology | null = null;
let selectedContainerId = '';
let topicFilterQuery = '';
let publisherFilterQuery = '';
let subscriberFilterQuery = '';
let viewMode: ViewMode = 'graph';
let listVisited = false;
let groupByNamespace = false;
let loading = false;
let error = '';
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollInFlight = false;
let selectedTopic = '';
let selectedNode: NodeDetail | null = null;
let selectedNodeRole: 'publisher' | 'subscriber' = 'publisher';
let expandedPublisherNodes = false;
let expandedSubscriberNodes = false;
let topicDetail: TopicDetailInfo | null = null;
let schema: TopicSchemaResult | null = null;
let peekResult: TopicPeekResult | null = null;
let inspectorLoading = false;
let inspectorError = '';
let schemaLoading = false;
let peekLoading = false;
let publishEditorOpen = false;
let publishPayload = '';
let publishConfirmed = false;
let publishLoading = false;
let publishError = '';
let publishResult: TopicPublishResult | null = null;
let publishGeneration = 0;
let publishPulseTopic = '';
let publishPulseTimer: ReturnType<typeof setTimeout> | null = null;
let topicTelemetry: TopicTelemetry | null = null;
let topicTelemetryLoading = false;
let topicTelemetryError = '';
let liveTelemetryEnabled = false;
let topicTelemetryTimer: ReturnType<typeof setInterval> | null = null;
let topicTelemetryGeneration = 0;
let topicTelemetryInFlight = false;
let queuedTopicTelemetry: { generation: number; containerId: string; topicName: string } | null = null;
let filterReturn: { kind: FilterKind; value: string } | null = null;
let graphScrollTop = 0;
let graphViewportHeight = 0;

$: runningContainers = containers.filter(container => container.state === 'running');
$: if (viewMode === 'list') listVisited = true;
$: topics = topology?.topics ?? [];
$: allNodes = topology?.nodes ?? [];
$: directTopicMatches = topicFilterQuery.trim() ? filterTopicsByName(topics, topicFilterQuery) : [];
$: publisherFilter = publisherFilterQuery.trim().toLowerCase();
$: subscriberFilter = subscriberFilterQuery.trim().toLowerCase();
$: directPublisherMatches = publisherFilter
  ? allNodes.filter(node => node.publishingTopics.length > 0 && nodePath(node).toLowerCase().includes(publisherFilter))
  : [];
$: directSubscriberMatches = subscriberFilter
  ? allNodes.filter(
      node => node.subscribingTopics.length > 0 && nodePath(node).toLowerCase().includes(subscriberFilter),
    )
  : [];
$: filteredTopics = topicFilterQuery.trim() ? directTopicMatches : topics;
$: matchingPublisherTopicNames = new Set(directPublisherMatches.flatMap(node => node.publishingTopics));
$: matchingSubscriberTopicNames = new Set(directSubscriberMatches.flatMap(node => node.subscribingTopics));
$: cardTopics = publisherFilter
  ? topics.filter(topic => matchingPublisherTopicNames.has(topic.name))
  : subscriberFilter
    ? topics.filter(topic => matchingSubscriberTopicNames.has(topic.name))
    : filteredTopics;
$: cardTopicNames = new Set(cardTopics.map(topic => topic.name));
$: matchingCardPublisherCount = directPublisherMatches.filter(node =>
  node.publishingTopics.some(topic => cardTopicNames.has(topic)),
).length;
$: matchingCardSubscriberCount = directSubscriberMatches.filter(node =>
  node.subscribingTopics.some(topic => cardTopicNames.has(topic)),
).length;
$: filteredTopicNames = new Set(topics.map(topic => topic.name));
$: focusActive = Boolean(selectedTopic || selectedNode);
$: resourceFilterActive = Boolean(publisherFilter || subscriberFilter);
$: publishWarning = selectedTopic ? getRosTopicPublishWarning(selectedTopic) : undefined;
$: publishPayloadSize = topicPublishPayloadBytes(publishPayload);
$: activeFilter = publisherFilter
  ? 'publisher'
  : subscriberFilter
    ? 'subscriber'
    : topicFilterQuery.trim()
      ? 'topic'
      : null;
$: graphTopics = focusActive
  ? topics.filter(topic => topicIsRelatedToSelection(topic.name, selectedTopic, selectedNode, selectedNodeRole))
  : resourceFilterActive
    ? []
    : filteredTopics;
$: graphTopicNames = new Set(graphTopics.map(topic => topic.name));
$: publisherNodes = focusActive
  ? selectedNode && !selectedTopic && selectedNodeRole === 'publisher'
    ? [selectedNode]
    : allNodes.filter(node => node.publishingTopics.some(topic => graphTopicNames.has(topic)))
  : directPublisherMatches;
$: subscriberNodes = focusActive
  ? selectedNode && !selectedTopic && selectedNodeRole === 'subscriber'
    ? [selectedNode]
    : allNodes.filter(node => node.subscribingTopics.some(topic => graphTopicNames.has(topic)))
  : directSubscriberMatches;
$: displayedPublisherNodes =
  focusActive && !expandedPublisherNodes ? publisherNodes.slice(0, MAX_CONNECTED_NODES) : publisherNodes;
$: displayedSubscriberNodes =
  focusActive && !expandedSubscriberNodes ? subscriberNodes.slice(0, MAX_CONNECTED_NODES) : subscriberNodes;
$: collapsedPublisherCount = publisherNodes.length - displayedPublisherNodes.length;
$: collapsedSubscriberCount = subscriberNodes.length - displayedSubscriberNodes.length;
$: graphNodes = [
  ...new Map([...displayedPublisherNodes, ...displayedSubscriberNodes].map(node => [nodePath(node), node])).values(),
];
$: graphRowCount = Math.max(
  graphTopics.length,
  displayedPublisherNodes.length + (collapsedPublisherCount > 0 ? 1 : 0),
  displayedSubscriberNodes.length + (collapsedSubscriberCount > 0 ? 1 : 0),
);
$: cardHeight = Math.max(
  44,
  ...[...graphTopics.map(topic => topic.name), ...graphNodes.map(nodePath)].map(
    name => labelLines(name).length * 14 + 20,
  ),
);
$: rowHeight = cardHeight + 20;
$: graphHeight = Math.max(GRAPH_MIN_HEIGHT, 64 + graphRowCount * rowHeight);
$: graphLayout = {
  height: graphHeight,
  cardHeight,
  rowHeight,
  focusedTopicY: selectedTopic
    ? Math.max(
        48 + cardHeight / 2,
        Math.min(
          graphHeight - cardHeight / 2 - 16,
          graphScrollTop + Math.min(graphViewportHeight || graphHeight, graphHeight) / 2,
        ),
      )
    : null,
};
$: topologyLoading = Boolean(selectedContainerId) && topology === null;
$: topicGroups = groupTopicsByNamespace(cardTopics);

$: if (selectedTopic && !filteredTopicNames.has(selectedTopic)) {
  clearSelection();
}

function nodePath(node: NodeDetail): string {
  return node.nodeNamespace === '/' ? `/${node.nodeName}` : `${node.nodeNamespace}/${node.nodeName}`;
}

function topicPublishers(topicName: string): string[] {
  return allNodes.filter(node => node.publishingTopics.includes(topicName)).map(nodePath);
}

function topicSubscribers(topicName: string): string[] {
  return allNodes.filter(node => node.subscribingTopics.includes(topicName)).map(nodePath);
}

function labelLines(value: string): string[] {
  return value.match(/.{1,25}/g) ?? [value];
}

function yFor(index: number, total: number, layout: typeof graphLayout): number {
  if (total <= 1) return layout.height / 2;
  return 48 + layout.cardHeight / 2 + index * layout.rowHeight;
}

function topicY(topicName: string, visibleTopics: TopicInfo[], layout: typeof graphLayout): number {
  if (layout.focusedTopicY !== null && visibleTopics.length === 1) return layout.focusedTopicY;
  return yFor(
    visibleTopics.findIndex(topic => topic.name === topicName),
    visibleTopics.length,
    layout,
  );
}

function trackGraphViewport(node: HTMLDivElement) {
  const measure = () => {
    graphScrollTop = node.scrollTop;
    graphViewportHeight = node.clientHeight;
  };
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
  observer?.observe(node);
  node.addEventListener('scroll', measure, { passive: true });
  measure();
  return {
    destroy() {
      observer?.disconnect();
      node.removeEventListener('scroll', measure);
      graphScrollTop = 0;
      graphViewportHeight = 0;
    },
  };
}

function nodeY(_node: NodeDetail, index: number, total: number, layout: typeof graphLayout): number {
  return yFor(index, total, layout);
}

function topicIsRelatedToSelection(
  topicName: string,
  topic = selectedTopic,
  node = selectedNode,
  role = selectedNodeRole,
): boolean {
  if (topic) return topic === topicName;
  if (node) {
    return (role === 'publisher' ? node.publishingTopics : node.subscribingTopics).includes(topicName);
  }
  return true;
}

function nodeIsRelatedToSelection(node: NodeDetail): boolean {
  if (!selectedTopic && !selectedNode) return true;
  if (selectedTopic) {
    return node.publishingTopics.includes(selectedTopic) || node.subscribingTopics.includes(selectedTopic);
  }
  if (!selectedNode) return true;
  if (nodePath(node) === nodePath(selectedNode)) return true;
  return [...node.publishingTopics, ...node.subscribingTopics].some(topic =>
    [...selectedNode!.publishingTopics, ...selectedNode!.subscribingTopics].includes(topic),
  );
}

function handleKey(event: KeyboardEvent, action: () => void): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    action();
  }
}

function handleWindowKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && (selectedTopic || selectedNode)) {
    if (selectedTopic && selectedNode) selectedNode = null;
    else if (filterReturn) restoreFilterResults();
    else clearSelection();
  }
}

function setFilter(kind: FilterKind, event: Event): void {
  const value = (event.currentTarget as HTMLInputElement).value;
  topicFilterQuery = kind === 'topic' ? value : '';
  publisherFilterQuery = kind === 'publisher' ? value : '';
  subscriberFilterQuery = kind === 'subscriber' ? value : '';
  filterReturn = null;
  clearSelection();
}

function beginFilteredFocus(): void {
  if (!activeFilter || filterReturn) return;
  const value =
    activeFilter === 'topic'
      ? topicFilterQuery
      : activeFilter === 'publisher'
        ? publisherFilterQuery
        : subscriberFilterQuery;
  filterReturn = { kind: activeFilter as FilterKind, value };
}

function restoreFilterResults(): void {
  if (!filterReturn) {
    clearSelection();
    topicFilterQuery = '';
    publisherFilterQuery = '';
    subscriberFilterQuery = '';
    return;
  }
  const previous = filterReturn;
  filterReturn = null;
  clearSelection();
  topicFilterQuery = previous.kind === 'topic' ? previous.value : '';
  publisherFilterQuery = previous.kind === 'publisher' ? previous.value : '';
  subscriberFilterQuery = previous.kind === 'subscriber' ? previous.value : '';
}

async function refreshTopology() {
  if (!selectedContainerId || pollInFlight) return;
  pollInFlight = true;
  try {
    topology = await physicalAiClient.getTopicTopology(selectedContainerId);
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
  loading = false;
}

async function pollContainers() {
  try {
    containers = await physicalAiClient.listSimulationContainers();
    const nextRunningContainers = containers.filter(container => container.state === 'running');
    const nextContainerId =
      nextRunningContainers.find(container => container.id === selectedContainerId)?.id ??
      nextRunningContainers[0]?.id ??
      '';
    if (nextContainerId !== selectedContainerId) {
      selectedContainerId = nextContainerId;
      topology = null;
      clearSelection();
    }
    await refreshTopology();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
}

function clearSelection() {
  stopTopicTelemetry();
  resetPublishState();
  clearPublishPulse();
  selectedTopic = '';
  selectedNode = null;
  filterReturn = null;
  topicDetail = null;
  schema = null;
  peekResult = null;
  inspectorError = '';
  expandedPublisherNodes = false;
  expandedSubscriberNodes = false;
}

function resetPublishState(): void {
  publishGeneration += 1;
  publishEditorOpen = false;
  publishPayload = '';
  publishConfirmed = false;
  publishLoading = false;
  publishError = '';
  publishResult = null;
}

function clearPublishPulse(): void {
  if (publishPulseTimer) clearTimeout(publishPulseTimer);
  publishPulseTimer = null;
  publishPulseTopic = '';
}

function pulsePublishedTopic(topicName: string): void {
  clearPublishPulse();
  publishPulseTopic = topicName;
  publishPulseTimer = setTimeout(() => {
    publishPulseTopic = '';
    publishPulseTimer = null;
  }, 900);
}

function togglePublishEditor(): void {
  if (publishEditorOpen) {
    resetPublishState();
    return;
  }
  publishEditorOpen = true;
  publishConfirmed = false;
  publishError = '';
  publishResult = null;
}

async function publishSelectedTopic(): Promise<void> {
  if (!selectedContainerId || !selectedTopic || !topicDetail || publishLoading) return;
  if (!publishConfirmed) {
    publishError = 'Confirm that this one-shot message is safe for the topic subscribers.';
    return;
  }
  if (!publishPayload.trim()) {
    publishError = 'Enter a YAML message payload before publishing.';
    return;
  }
  if (publishPayloadSize > ROS_TOPIC_PUBLISH_MAX_BYTES) {
    publishError = `Message payload exceeds the ${ROS_TOPIC_PUBLISH_MAX_BYTES}-byte limit.`;
    return;
  }

  const requestId = ++publishGeneration;
  const containerId = selectedContainerId;
  const topicName = selectedTopic;
  const confirmed = publishConfirmed;
  publishConfirmed = false;
  publishLoading = true;
  publishError = '';
  publishResult = null;
  try {
    const result = await physicalAiClient.publishRosTopic(containerId, topicName, publishPayload, confirmed);
    if (requestId === publishGeneration && selectedContainerId === containerId && selectedTopic === topicName) {
      publishResult = result;
      pulsePublishedTopic(topicName);
    }
  } catch (e) {
    if (requestId === publishGeneration && selectedContainerId === containerId && selectedTopic === topicName) {
      publishError = e instanceof Error ? e.message : String(e);
    }
  } finally {
    if (requestId === publishGeneration) publishLoading = false;
  }
}

function stopTopicTelemetry(): void {
  topicTelemetryGeneration += 1;
  if (topicTelemetryTimer) clearInterval(topicTelemetryTimer);
  topicTelemetryTimer = null;
  queuedTopicTelemetry = null;
  topicTelemetry = null;
  topicTelemetryLoading = false;
  topicTelemetryError = '';
}

async function requestTopicTelemetry(generation: number, containerId: string, topicName: string): Promise<void> {
  if (topicTelemetryInFlight) {
    queuedTopicTelemetry = { generation, containerId, topicName };
    return;
  }

  topicTelemetryInFlight = true;
  topicTelemetryLoading = true;
  topicTelemetryError = '';
  try {
    const [result] = await physicalAiClient.getTopicTelemetry(containerId, [topicName]);
    if (generation !== topicTelemetryGeneration || selectedContainerId !== containerId || selectedTopic !== topicName) {
      return;
    }
    topicTelemetry = result ?? {
      topicName,
      status: 'unavailable',
      capturedAt: new Date().toISOString(),
      error: 'No telemetry result was returned for the selected topic.',
    };
  } catch (e) {
    if (generation === topicTelemetryGeneration && selectedContainerId === containerId && selectedTopic === topicName) {
      topicTelemetryError = e instanceof Error ? e.message : String(e);
    }
  } finally {
    topicTelemetryInFlight = false;
    topicTelemetryLoading = false;
    const queued = queuedTopicTelemetry;
    queuedTopicTelemetry = null;
    if (
      queued &&
      queued.generation === topicTelemetryGeneration &&
      queued.containerId === selectedContainerId &&
      queued.topicName === selectedTopic
    ) {
      void requestTopicTelemetry(queued.generation, queued.containerId, queued.topicName);
    }
  }
}

function startTopicTelemetry(topicName: string): void {
  stopTopicTelemetry();
  if (!liveTelemetryEnabled || !selectedContainerId || !topicName || viewMode !== 'graph') return;

  const generation = topicTelemetryGeneration;
  const containerId = selectedContainerId;
  void requestTopicTelemetry(generation, containerId, topicName);
  topicTelemetryTimer = setInterval(
    () => void requestTopicTelemetry(generation, containerId, topicName),
    TOPIC_TELEMETRY_REFRESH_MS,
  );
}

function setViewMode(mode: ViewMode): void {
  viewMode = mode;
  if (liveTelemetryEnabled && mode === 'graph' && selectedTopic) startTopicTelemetry(selectedTopic);
  else stopTopicTelemetry();
}

function toggleLiveTelemetry(event: Event): void {
  liveTelemetryEnabled = (event.currentTarget as HTMLInputElement).checked;
  if (liveTelemetryEnabled && selectedTopic && viewMode === 'graph') startTopicTelemetry(selectedTopic);
  else stopTopicTelemetry();
}

function formatPublishRate(rate: number): string {
  return `${rate < 1 ? rate.toFixed(2) : rate.toFixed(1)} Hz`;
}

function formatBandwidth(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1_000_000) return `${(bytesPerSecond / 1_000_000).toFixed(2)} MB/s`;
  if (bytesPerSecond >= 1_000) return `${(bytesPerSecond / 1_000).toFixed(2)} kB/s`;
  return `${bytesPerSecond.toFixed(0)} B/s`;
}

async function selectTopic(topicName: string) {
  if (selectedTopic === topicName) {
    if (filterReturn) restoreFilterResults();
    else clearSelection();
    return;
  }
  stopTopicTelemetry();
  resetPublishState();
  clearPublishPulse();
  beginFilteredFocus();
  selectedTopic = topicName;
  selectedNode = null;
  expandedPublisherNodes = false;
  expandedSubscriberNodes = false;
  topicDetail = null;
  schema = null;
  peekResult = null;
  inspectorError = '';
  startTopicTelemetry(topicName);
  inspectorLoading = true;
  try {
    topicDetail = await physicalAiClient.getRosTopicDetail(selectedContainerId, topicName);
  } catch (e) {
    inspectorError = e instanceof Error ? e.message : String(e);
  } finally {
    inspectorLoading = false;
  }
}

function selectNode(node: NodeDetail, role: 'publisher' | 'subscriber') {
  if (selectedTopic) {
    selectedNode = selectedNode && nodePath(selectedNode) === nodePath(node) ? null : node;
    selectedNodeRole = role;
    return;
  }
  if (selectedNode && nodePath(selectedNode) === nodePath(node)) {
    if (filterReturn) restoreFilterResults();
    else clearSelection();
    return;
  }
  beginFilteredFocus();
  stopTopicTelemetry();
  resetPublishState();
  selectedNode = node;
  selectedNodeRole = role;
  selectedTopic = '';
  expandedPublisherNodes = false;
  expandedSubscriberNodes = false;
  topicDetail = null;
  schema = null;
  peekResult = null;
  inspectorError = '';
}

async function loadSchema() {
  if (!selectedTopic || !topicDetail || schemaLoading) return;
  schemaLoading = true;
  try {
    schema = await physicalAiClient.getRosMessageSchema(selectedContainerId, topicDetail.type);
  } catch (e) {
    inspectorError = e instanceof Error ? e.message : String(e);
  } finally {
    schemaLoading = false;
  }
}

async function peekTopic() {
  if (!selectedTopic || peekLoading) return;
  peekLoading = true;
  inspectorError = '';
  peekResult = null;
  try {
    const result = await physicalAiClient.peekRosTopic(selectedContainerId, selectedTopic);
    if (result.message) peekResult = result;
    else
      inspectorError =
        result.error ?? (result.timedOut ? 'No message received before the peek timeout.' : 'No message received.');
  } catch (e) {
    inspectorError = e instanceof Error ? e.message : String(e);
  } finally {
    peekLoading = false;
  }
}

async function inspectCardTopic(topicName: string) {
  if (selectedTopic !== topicName) await selectTopic(topicName);
  viewMode = 'graph';
  if (liveTelemetryEnabled) startTopicTelemetry(topicName);
}

async function inspectCardNode(topicName: string, path: string, role: 'publisher' | 'subscriber') {
  if (selectedTopic !== topicName) await selectTopic(topicName);
  const node = allNodes.find(candidate => nodePath(candidate) === path);
  if (node) selectNode(node, role);
  viewMode = 'graph';
  if (liveTelemetryEnabled && selectedTopic) startTopicTelemetry(selectedTopic);
}

onMount(() => {
  window.addEventListener('keydown', handleWindowKeydown);
  void refresh();
  pollTimer = setInterval(() => void pollContainers(), 5000);
});

onDestroy(() => {
  window.removeEventListener('keydown', handleWindowKeydown);
  if (pollTimer) clearInterval(pollTimer);
  stopTopicTelemetry();
  clearPublishPulse();
});
</script>

<div class="flex flex-col p-4 gap-4 w-full flex-1 min-h-0 min-w-0 overflow-auto">
  {#if $navigationLayout === 'cards'}
    <button on:click={() => router.goto('/')} class="pai-link self-start"> &larr; Back to Dashboard </button>
  {/if}
  <div class="flex flex-row items-center justify-between gap-3 flex-wrap">
    <h1 class="text-3xl text-[var(--pd-content-header)]">Topic Monitor</h1>
  </div>
  {#if $navigationLayout === 'cards'}
    <QuickLinks links={[{ label: 'Simulation', to: '/simulation' }]} />
  {/if}
  <p class="text-sm text-[var(--pd-content-text)]">
    Explore ROS2 nodes, topics, and publisher/subscriber relationships.
  </p>
  <div
    class="flex items-center justify-between flex-wrap gap-3 rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-3">
    <div class="flex flex-row gap-1" role="group" aria-label="Topic Monitor views">
      <button
        class="px-4 py-2 text-sm pai-tab"
        class:pai-tab-active={viewMode === 'list'}
        aria-pressed={viewMode === 'list'}
        on:click={() => setViewMode('list')}>List</button>
      <button
        class="px-4 py-2 text-sm pai-tab"
        class:pai-tab-active={viewMode === 'graph'}
        aria-pressed={viewMode === 'graph'}
        on:click={() => setViewMode('graph')}>Graph</button>
      <button
        class="px-4 py-2 text-sm pai-tab"
        class:pai-tab-active={viewMode === 'cards'}
        aria-pressed={viewMode === 'cards'}
        on:click={() => setViewMode('cards')}>Cards</button>
    </div>
    <div class="flex items-center gap-4">
      <label
        class="live-telemetry-toggle inline-flex cursor-pointer items-center gap-3 text-xs text-[var(--pd-content-text)]"
        class:enabled={liveTelemetryEnabled}>
        <input
          type="checkbox"
          aria-label="Live telemetry"
          aria-describedby="liveTelemetryHint"
          checked={liveTelemetryEnabled}
          on:change={toggleLiveTelemetry} />
        <span class="flex flex-col gap-0.5">
          <span class="font-semibold text-[var(--pai-accent,#7c3aed)]">Live telemetry</span>
          <span id="liveTelemetryHint" class="text-[10px] pai-text-muted">
            {liveTelemetryEnabled ? 'Sampling selected topic' : 'Off by default · sample selected topic'}
          </span>
        </span>
      </label>
      <span class="text-xs uppercase tracking-wide pai-text-muted">Live</span>
    </div>
  </div>

  {#if listVisited}
    <div class="flex-col gap-4 min-h-0 min-w-0" style:display={viewMode === 'list' ? 'flex' : 'none'}>
      <TopicMonitor
        embedded={true}
        active={viewMode === 'list'}
        sharedTopology={topology}
        sharedContainerId={selectedContainerId}
        sharedContainers={containers}
        bind:filterQuery={topicFilterQuery}
        bind:publisherFilterQuery={publisherFilterQuery}
        bind:subscriberFilterQuery={subscriberFilterQuery}
        on:filterchange={clearSelection} />
    </div>
  {/if}
  {#if viewMode === 'list'}
    <!-- Keep the List component mounted above so its data and inspection state survive tab switches. -->
  {:else if loading && !containers.length}
    <div
      class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 max-w-lg"
      aria-live="polite">
      <p class="text-sm text-[var(--pd-content-text)]">Retrieving simulation containers and topics...</p>
    </div>
  {:else if !runningContainers.length}
    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 max-w-lg">
      <p class="text-sm text-[var(--pd-content-text)]">
        No simulation is running. <button on:click={() => router.goto('/simulation')} class="pai-link"
          >Launch one</button>
        to inspect topics.
      </p>
    </div>
  {:else}
    <div class="flex flex-row items-end gap-3 flex-wrap">
      <div class="flex flex-col gap-1 min-w-64">
        <label for="graphContainerSelect" class="text-xs text-[var(--pd-content-text)]">Simulation container</label>
        <select
          id="graphContainerSelect"
          bind:value={selectedContainerId}
          on:change={() => void refreshTopology()}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-[var(--pd-content-text)]">
          {#each runningContainers as container}
            <option value={container.id}>{container.name} — {container.imageTag}</option>
          {/each}
        </select>
      </div>
      <div class="flex flex-col gap-1 min-w-48">
        <label for="graphPublisherFilter" class="text-xs text-[var(--pd-content-text)]">Filter publishers</label>
        <input
          id="graphPublisherFilter"
          type="search"
          value={publisherFilterQuery}
          on:input={event => setFilter('publisher', event)}
          placeholder="Filter by name"
          class="pai-topic-filter px-3 py-1.5 text-sm rounded border" />
      </div>
      <div class="flex flex-col gap-1 min-w-48">
        <label for="graphTopicFilter" class="text-xs text-[var(--pd-content-text)]">Filter topics</label>
        <input
          id="graphTopicFilter"
          type="search"
          value={topicFilterQuery}
          on:input={event => setFilter('topic', event)}
          placeholder="Filter by name"
          class="pai-topic-filter px-3 py-1.5 text-sm rounded border" />
      </div>
      <div class="flex flex-col gap-1 min-w-48">
        <label for="graphSubscriberFilter" class="text-xs text-[var(--pd-content-text)]">Filter subscribers</label>
        <input
          id="graphSubscriberFilter"
          type="search"
          value={subscriberFilterQuery}
          on:input={event => setFilter('subscriber', event)}
          placeholder="Filter by name"
          class="pai-topic-filter px-3 py-1.5 text-sm rounded border" />
      </div>
      <button on:click={() => void refresh()} disabled={loading} class="pai-btn pai-btn-primary">
        {loading ? 'Refreshing...' : 'Refresh'}
      </button>
    </div>

    {#if error}<div class="p-3 rounded text-sm pai-banner-error max-w-lg">{error}</div>{/if}

    <div class="flex flex-col xl:flex-row items-start gap-4 min-w-0">
      <section
        class="w-full flex-1 min-w-0 rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] overflow-hidden">
        <div
          class="flex flex-row items-center justify-between gap-3 px-4 py-3 border-b border-[var(--pd-content-card-border)]">
          <div>
            <h2 class="text-sm font-medium text-[var(--pd-content-header)]">
              {viewMode === 'cards' ? 'Topic cards' : 'Topology graph'}
            </h2>
            {#if selectedTopic}
              <p class="text-sm text-[var(--pd-content-header)] mt-1 break-all">
                Topic: <span class="font-mono">{selectedTopic}</span>
              </p>
            {/if}
            <p class="text-xs pai-text-muted mt-1">
              {#if viewMode === 'cards'}
                {cardTopics.length}
                {activeFilter ? 'matching topics' : 'topics'}
                {#if publisherFilter}
                  · {matchingCardPublisherCount} matching publishers{/if}
                {#if subscriberFilter}
                  · {matchingCardSubscriberCount} matching subscribers{/if}
                · {topicGroups.length} namespaces
              {:else}
                {graphTopics.length} topics · {graphNodes.length} connected nodes
              {/if}
            </p>
            {#if filterReturn}
              <p class="text-xs text-[var(--pd-content-text)] mt-1 break-all">
                {filterReturn.kind} filter: <span class="font-mono">{filterReturn.value}</span>
              </p>
            {/if}
          </div>
          <div class="flex items-center gap-2">
            {#if viewMode === 'cards'}
              <label class="flex items-center gap-2 text-xs text-[var(--pd-content-text)]">
                <input type="checkbox" bind:checked={groupByNamespace} aria-label="Group by namespace" />
                {groupByNamespace ? 'Topics grouped by namespace' : 'Group by namespace'}
              </label>
            {/if}
            {#if filterReturn}
              <button on:click={restoreFilterResults} class="pai-btn pai-btn-secondary text-xs">
                Back to {filterReturn.kind} results
              </button>
            {:else if activeFilter}
              <button on:click={restoreFilterResults} class="pai-btn pai-btn-secondary text-xs">Clear filter</button>
            {/if}
          </div>
        </div>

        {#if topologyLoading}
          <div class="min-h-72 grid place-items-center p-8 text-sm text-[var(--pd-content-text)]" aria-live="polite">
            Retrieving topics and topology...
          </div>
        {:else if viewMode === 'cards'}
          <div class="p-4 flex flex-col gap-3 max-h-[42rem] overflow-auto">
            {#if cardTopics.length === 0}
              <p class="text-sm text-[var(--pd-content-text)]">No topics match the current filter.</p>
            {:else if groupByNamespace}
              {#each topicGroups as group (group[0])}
                <section class="rounded border border-[var(--pd-content-card-border)]">
                  <h3 class="px-3 py-2 text-xs font-medium text-[var(--pd-content-header)] bg-[var(--pd-content-bg)]">
                    {group[0]}
                    <span class="font-normal pai-text-muted">({group[1].length} topics)</span>
                  </h3>
                  <div class="divide-y divide-[var(--pd-content-card-border)]">
                    {#each group[1] as topic (topic.name)}
                      <details class="p-3 text-xs text-[var(--pd-content-text)]">
                        <summary class="cursor-pointer font-mono">{topic.name}</summary>
                        <div class="mt-2 grid gap-2">
                          <button
                            class="pai-btn text-xs justify-self-start"
                            on:click={() => void inspectCardTopic(topic.name)}>Inspect in Graph</button>
                          <div>
                            <span class="pai-text-muted">Type:</span> <span class="font-mono">{topic.type}</span>
                          </div>
                          <div>
                            <span class="pai-text-muted">Publishers:</span>
                            {#each topicPublishers(topic.name) as publisher}
                              <button
                                class="pai-link font-mono"
                                on:click={() => void inspectCardNode(topic.name, publisher, 'publisher')}
                                ><TopicEndpoints
                                  names={[publisher]}
                                  query={publisherFilterQuery}
                                  role="publisher" /></button
                              >{#if publisher !== topicPublishers(topic.name).at(-1)},
                              {/if}
                            {:else}None{/each}
                          </div>
                          <div>
                            <span class="pai-text-muted">Subscribers:</span>
                            {#each topicSubscribers(topic.name) as subscriber}
                              <button
                                class="pai-link font-mono"
                                on:click={() => void inspectCardNode(topic.name, subscriber, 'subscriber')}
                                ><TopicEndpoints
                                  names={[subscriber]}
                                  query={subscriberFilterQuery}
                                  role="subscriber" /></button
                              >{#if subscriber !== topicSubscribers(topic.name).at(-1)},
                              {/if}
                            {:else}None{/each}
                          </div>
                        </div>
                      </details>
                    {/each}
                  </div>
                </section>
              {/each}
            {:else}
              {#each cardTopics as topic (topic.name)}
                <details
                  class="rounded border border-[var(--pd-content-card-border)] p-3 text-xs text-[var(--pd-content-text)]">
                  <summary class="cursor-pointer font-mono">{topic.name}</summary>
                  <div class="mt-2 grid gap-2">
                    <button
                      class="pai-btn text-xs justify-self-start"
                      on:click={() => void inspectCardTopic(topic.name)}>Inspect in Graph</button>
                    <div><span class="pai-text-muted">Type:</span> <span class="font-mono">{topic.type}</span></div>
                    <div>
                      <span class="pai-text-muted">Publishers:</span>
                      {#each topicPublishers(topic.name) as publisher}
                        <button
                          class="pai-link font-mono"
                          on:click={() => void inspectCardNode(topic.name, publisher, 'publisher')}
                          ><TopicEndpoints names={[publisher]} query={publisherFilterQuery} role="publisher" /></button
                        >{#if publisher !== topicPublishers(topic.name).at(-1)},
                        {/if}
                      {:else}None{/each}
                    </div>
                    <div>
                      <span class="pai-text-muted">Subscribers:</span>
                      {#each topicSubscribers(topic.name) as subscriber}
                        <button
                          class="pai-link font-mono"
                          on:click={() => void inspectCardNode(topic.name, subscriber, 'subscriber')}
                          ><TopicEndpoints
                            names={[subscriber]}
                            query={subscriberFilterQuery}
                            role="subscriber" /></button
                        >{#if subscriber !== topicSubscribers(topic.name).at(-1)},
                        {/if}
                      {:else}None{/each}
                    </div>
                  </div>
                </details>
              {/each}
            {/if}
          </div>
        {:else if graphTopics.length === 0 && !publisherNodes.length && !subscriberNodes.length}
          <div class="min-h-72 grid place-items-center p-8 text-sm text-[var(--pd-content-text)]">
            No topics match the current filter.
          </div>
        {:else}
          <div class="overflow-auto max-h-[42rem]" use:trackGraphViewport>
            <svg
              viewBox={`0 0 ${GRAPH_WIDTH} ${graphHeight}`}
              width={GRAPH_WIDTH}
              height={graphHeight}
              class="block mx-auto shrink-0 bg-[var(--pd-content-bg)]"
              role="img"
              aria-label="ROS 2 topic topology graph">
              <defs>
                <marker id="topicGraphArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" style="fill: var(--pai-accent, #7c3aed)"></path>
                </marker>
              </defs>
              <text x="170" y="30" text-anchor="middle" class="fill-[var(--pd-content-text)] text-[12px]"
                >Publishers</text>
              <text x="500" y="30" text-anchor="middle" class="fill-[var(--pd-content-text)] text-[12px]">Topics</text>
              <text x="830" y="30" text-anchor="middle" class="fill-[var(--pd-content-text)] text-[12px]"
                >Subscribers</text>

              {#if focusActive}
                {#each displayedPublisherNodes as node, nodeIndex (nodePath(node))}
                  {#each node.publishingTopics.filter(topic => graphTopicNames.has(topic)) as topic}
                    {#if topicIsRelatedToSelection(topic) && nodeIsRelatedToSelection(node)}
                      <path
                        d={`M270 ${nodeY(node, nodeIndex, displayedPublisherNodes.length, graphLayout)} H380 V${topicY(topic, graphTopics, graphLayout)} H410`}
                        style="stroke: var(--pai-accent, #7c3aed); fill: none"
                        stroke-opacity="0.55"
                        stroke-width="2"
                        marker-end="url(#topicGraphArrow)"></path>
                    {/if}
                  {/each}
                {/each}
                {#each displayedSubscriberNodes as node, nodeIndex (nodePath(node))}
                  {#each node.subscribingTopics.filter(topic => graphTopicNames.has(topic)) as topic}
                    {#if topicIsRelatedToSelection(topic) && nodeIsRelatedToSelection(node)}
                      <path
                        d={`M590 ${topicY(topic, graphTopics, graphLayout)} H620 V${nodeY(node, nodeIndex, displayedSubscriberNodes.length, graphLayout)} H730`}
                        style="stroke: var(--pai-accent, #7c3aed); fill: none"
                        stroke-opacity="0.55"
                        stroke-width="2"
                        marker-end="url(#topicGraphArrow)"></path>
                    {/if}
                  {/each}
                {/each}
              {/if}

              {#each displayedPublisherNodes as node, nodeIndex (nodePath(node))}
                <g
                  class="graph-selectable"
                  role="button"
                  tabindex="0"
                  aria-label={`Select node ${nodePath(node)}`}
                  aria-pressed={selectedNode ? nodePath(selectedNode) === nodePath(node) : false}
                  on:click={() => selectNode(node, 'publisher')}
                  on:keydown={event => handleKey(event, () => selectNode(node, 'publisher'))}>
                  <title>{nodePath(node)}</title>
                  <rect
                    x="55"
                    y={nodeY(node, nodeIndex, displayedPublisherNodes.length, graphLayout) - cardHeight / 2}
                    width="215"
                    height={cardHeight}
                    rx="8"
                    fill="var(--pd-content-card-bg)"
                    style={`stroke: ${selectedNode && nodePath(selectedNode) === nodePath(node) ? 'var(--pai-accent, #7c3aed)' : 'var(--pd-content-card-border, #e5e7eb)'}`}
                  ></rect>
                  <text
                    x="162"
                    y={nodeY(node, nodeIndex, displayedPublisherNodes.length, graphLayout) -
                      (labelLines(nodePath(node)).length - 1) * 7 +
                      4}
                    text-anchor="middle"
                    class="fill-[var(--pd-content-header)] text-[11px]"
                    >{#each labelLines(nodePath(node)) as line, index}<tspan x="162" dy={index === 0 ? 0 : 14}
                        >{line}</tspan
                      >{/each}</text>
                </g>
              {/each}
              {#each displayedSubscriberNodes as node, nodeIndex (nodePath(node))}
                <g
                  class="graph-selectable"
                  role="button"
                  tabindex="0"
                  aria-label={`Select node ${nodePath(node)}`}
                  aria-pressed={selectedNode ? nodePath(selectedNode) === nodePath(node) : false}
                  on:click={() => selectNode(node, 'subscriber')}
                  on:keydown={event => handleKey(event, () => selectNode(node, 'subscriber'))}>
                  <title>{nodePath(node)}</title>
                  <rect
                    x="730"
                    y={nodeY(node, nodeIndex, displayedSubscriberNodes.length, graphLayout) - cardHeight / 2}
                    width="215"
                    height={cardHeight}
                    rx="8"
                    fill="var(--pd-content-card-bg)"
                    style={`stroke: ${selectedNode && nodePath(selectedNode) === nodePath(node) ? 'var(--pai-accent, #7c3aed)' : 'var(--pd-content-card-border, #e5e7eb)'}`}
                  ></rect>
                  <text
                    x="837"
                    y={nodeY(node, nodeIndex, displayedSubscriberNodes.length, graphLayout) -
                      (labelLines(nodePath(node)).length - 1) * 7 +
                      4}
                    text-anchor="middle"
                    class="fill-[var(--pd-content-header)] text-[11px]"
                    >{#each labelLines(nodePath(node)) as line, index}<tspan x="837" dy={index === 0 ? 0 : 14}
                        >{line}</tspan
                      >{/each}</text>
                </g>
              {/each}
              {#if collapsedPublisherCount > 0}
                <g
                  class="graph-selectable"
                  role="button"
                  tabindex="0"
                  aria-label={`Show ${collapsedPublisherCount} more publishers`}
                  on:click={() => (expandedPublisherNodes = true)}
                  on:keydown={event => handleKey(event, () => (expandedPublisherNodes = true))}>
                  <rect
                    x="55"
                    y={yFor(displayedPublisherNodes.length, graphRowCount, graphLayout) - 20}
                    width="215"
                    height="40"
                    rx="8"
                    style="fill: var(--pd-button-secondary-bg); stroke: var(--pai-accent, #7c3aed)"></rect>
                  <text
                    x="162"
                    y={yFor(displayedPublisherNodes.length, graphRowCount, graphLayout) + 4}
                    text-anchor="middle"
                    class="text-[11px] pai-text-accent">
                    Show {collapsedPublisherCount} more publishers
                  </text>
                </g>
              {/if}
              {#if collapsedSubscriberCount > 0}
                <g
                  class="graph-selectable"
                  role="button"
                  tabindex="0"
                  aria-label={`Show ${collapsedSubscriberCount} more subscribers`}
                  on:click={() => (expandedSubscriberNodes = true)}
                  on:keydown={event => handleKey(event, () => (expandedSubscriberNodes = true))}>
                  <rect
                    x="730"
                    y={yFor(displayedSubscriberNodes.length, graphRowCount, graphLayout) - 20}
                    width="215"
                    height="40"
                    rx="8"
                    style="fill: var(--pd-button-secondary-bg); stroke: var(--pai-accent, #7c3aed)"></rect>
                  <text
                    x="837"
                    y={yFor(displayedSubscriberNodes.length, graphRowCount, graphLayout) + 4}
                    text-anchor="middle"
                    class="text-[11px] pai-text-accent">
                    Show {collapsedSubscriberCount} more subscribers
                  </text>
                </g>
              {/if}
              {#each graphTopics as topic (topic.name)}
                <g
                  class="graph-selectable"
                  class:topic-publish-pulse={publishPulseTopic === topic.name}
                  role="button"
                  tabindex="0"
                  aria-label={`Select topic ${topic.name}`}
                  aria-pressed={selectedTopic === topic.name}
                  on:click={() => void selectTopic(topic.name)}
                  on:keydown={event => handleKey(event, () => void selectTopic(topic.name))}>
                  <title>{topic.name}</title>
                  <rect
                    x="410"
                    y={topicY(topic.name, graphTopics, graphLayout) - cardHeight / 2}
                    width="180"
                    height={cardHeight}
                    rx="8"
                    style={`fill: ${selectedTopic === topic.name ? 'var(--pd-button-secondary-bg, #ede9fe)' : 'var(--pd-content-card-bg, #fff)'}; stroke: ${selectedTopic === topic.name ? 'var(--pai-accent, #7c3aed)' : 'var(--pd-content-card-border, #e5e7eb)'};`}
                    stroke-width="2"></rect>
                  <text
                    x="500"
                    y={topicY(topic.name, graphTopics, graphLayout) - (labelLines(topic.name).length - 1) * 7 + 4}
                    text-anchor="middle"
                    style={`fill: ${selectedTopic === topic.name ? 'var(--pd-button-secondary-text, var(--pai-accent, #7c3aed))' : 'var(--pd-content-header, #111827)'}`}
                    class="text-[11px]"
                    >{#each labelLines(topic.name) as line, index}<tspan x="500" dy={index === 0 ? 0 : 14}>{line}</tspan
                      >{/each}</text>
                </g>
              {/each}
            </svg>
          </div>
          {#if focusActive && (expandedPublisherNodes || expandedSubscriberNodes)}
            <div class="flex flex-wrap gap-3 p-3 border-t border-[var(--pd-content-card-border)]">
              {#if expandedPublisherNodes && publisherNodes.length > MAX_CONNECTED_NODES}<button
                  class="pai-btn text-xs"
                  on:click={() => (expandedPublisherNodes = false)}>Show fewer publishers</button
                >{/if}
              {#if expandedSubscriberNodes && subscriberNodes.length > MAX_CONNECTED_NODES}<button
                  class="pai-btn text-xs"
                  on:click={() => (expandedSubscriberNodes = false)}>Show fewer subscribers</button
                >{/if}
            </div>
          {/if}
        {/if}
      </section>

      <aside
        class="w-full xl:w-80 shrink-0 rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 min-h-64">
        {#if selectedTopic}
          <div class="flex items-start justify-between gap-2 mb-4">
            <div class="min-w-0">
              <h2 class="text-sm font-medium text-[var(--pd-content-header)]">Topic inspector</h2>
              <p class="font-mono text-xs text-[var(--pd-content-text)] break-all mt-1">{selectedTopic}</p>
              {#if selectedNode}
                <p class="text-xs text-[var(--pd-content-text)] break-all mt-2">
                  Selected {selectedNodeRole}: <span class="font-mono">{nodePath(selectedNode)}</span>
                </p>
              {/if}
            </div>
            <button class="pai-btn text-xs" on:click={clearSelection} aria-label="Clear topic selection"
              >Clear selection</button>
          </div>
          {#if inspectorLoading}
            <p class="text-xs text-[var(--pd-content-text)]">Loading topic details...</p>
          {:else if inspectorError}
            <p class="text-xs pai-text-error">{inspectorError}</p>
          {:else if topicDetail}
            <div class="flex flex-col gap-3 text-xs text-[var(--pd-content-text)]">
              <div><span class="pai-text-muted">Type:</span> <span class="font-mono">{topicDetail.type}</span></div>
              <div><span class="pai-text-muted">Publishers:</span> {topicDetail.publishers.length}</div>
              <div><span class="pai-text-muted">Subscribers:</span> {topicDetail.subscribers.length}</div>
              <div class="rounded border border-[var(--pd-content-card-border)] p-2" role="status" aria-live="polite">
                <div class="flex items-center justify-between gap-2">
                  <span class="font-medium">Live telemetry</span>
                  {#if topicTelemetryLoading}<span class="pai-text-muted">Measuring…</span>{/if}
                </div>
                {#if topicTelemetryError}
                  <p class="mt-1 pai-text-error">{topicTelemetryError}</p>
                {:else if !liveTelemetryEnabled}
                  <p class="mt-1 pai-text-muted">Live telemetry is off. Enable it above to sample this topic.</p>
                {:else if topicTelemetry?.status === 'active'}
                  {#if topicTelemetry.publishHz !== undefined}
                    <p class="mt-1">Publish rate: {formatPublishRate(topicTelemetry.publishHz)}</p>
                  {/if}
                  {#if topicTelemetry.bandwidthBytesPerSecond !== undefined}
                    <p>Bandwidth: {formatBandwidth(topicTelemetry.bandwidthBytesPerSecond)}</p>
                  {:else}
                    <p class="pai-text-muted">Bandwidth unavailable</p>
                  {/if}
                {:else if topicTelemetry?.status === 'no-samples'}
                  {#if topicDetail.publishers.length === 0}
                    <p class="mt-1">No publishers discovered for this topic.</p>
                  {:else}
                    <p class="mt-1">
                      No messages observed during this {TOPIC_TELEMETRY_SAMPLE_SECONDS}s sample. The topic may be
                      event-driven, idle, or publishing more slowly than the sample window.
                    </p>
                  {/if}
                {:else if topicTelemetry?.status === 'unavailable'}
                  <p class="mt-1">{topicTelemetry.error ?? 'Telemetry is unavailable for this topic.'}</p>
                {:else if topicTelemetryLoading}
                  <p class="mt-1 pai-text-muted">Sampling the selected topic…</p>
                {:else}
                  <p class="mt-1 pai-text-muted">Select a topic to measure its publish rate.</p>
                {/if}
              </div>
              <div class="flex flex-wrap gap-2">
                <button class="pai-btn text-xs" on:click={() => void loadSchema()} disabled={schemaLoading}>
                  {schemaLoading ? 'Loading...' : 'Schema'}
                </button>
                <button class="pai-btn text-xs" on:click={() => void peekTopic()} disabled={peekLoading}>
                  {peekLoading ? 'Peeking...' : 'Peek'}
                </button>
                <button class="pai-btn text-xs" on:click={togglePublishEditor}>
                  {publishEditorOpen ? 'Cancel publish' : 'Publish'}
                </button>
              </div>
              {#if publishEditorOpen}
                <div class="rounded border border-[var(--pd-content-card-border)] p-3 flex flex-col gap-2">
                  <div>
                    <p class="font-medium">Publish one message</p>
                    <p class="pai-text-muted">Type: <span class="font-mono">{topicDetail.type}</span></p>
                  </div>
                  <label for="topicPublishPayload" class="text-xs">Message payload (YAML)</label>
                  <textarea
                    id="topicPublishPayload"
                    class="w-full min-h-24 rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-2 font-mono text-xs"
                    rows="4"
                    maxlength={ROS_TOPIC_PUBLISH_MAX_BYTES}
                    placeholder={'data: "hello"'}
                    bind:value={publishPayload}
                    on:input={() => {
                      publishError = '';
                      publishResult = null;
                    }}></textarea>
                  <div class="flex flex-wrap items-center justify-between gap-1 text-[11px] pai-text-muted">
                    <span>One-shot · max {ROS_TOPIC_PUBLISH_MAX_BYTES} bytes · 1 send/sec</span>
                    <span>Confirm each send</span>
                    <span>{publishPayloadSize}/{ROS_TOPIC_PUBLISH_MAX_BYTES} bytes</span>
                  </div>
                  {#if publishWarning}<p class="text-xs pai-text-error">{publishWarning}</p>{/if}
                  <label class="flex items-start gap-2 text-xs">
                    <input type="checkbox" bind:checked={publishConfirmed} />
                    <span>I confirm this one-shot message is safe for this topic's subscribers.</span>
                  </label>
                  <button
                    class="pai-btn self-start text-xs"
                    on:click={() => void publishSelectedTopic()}
                    disabled={publishLoading ||
                      !publishConfirmed ||
                      !publishPayload.trim() ||
                      publishPayloadSize > ROS_TOPIC_PUBLISH_MAX_BYTES}>
                    {publishLoading ? 'Publishing...' : 'Publish once'}
                  </button>
                  {#if publishError}<p class="text-xs pai-text-error">{publishError}</p>{/if}
                  {#if publishResult}
                    <p class="text-xs" role="status" aria-live="polite">
                      Published one {publishResult.messageType} message to
                      <span class="font-mono">{publishResult.topicName}</span>.
                    </p>
                  {/if}
                </div>
              {/if}
              {#if schema?.schema}<pre
                  class="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded border border-[var(--pd-content-card-border)] p-2 font-mono">{schema.schema}</pre>{/if}
              {#if peekResult?.message}<pre
                  class="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded border border-[var(--pd-content-card-border)] p-2 font-mono">{peekResult.message}</pre>{/if}
            </div>
          {/if}
        {:else if selectedNode}
          <div class="flex items-start justify-between gap-2 mb-4">
            <div class="min-w-0">
              <h2 class="text-sm font-medium text-[var(--pd-content-header)]">Node inspector</h2>
              <p class="font-mono text-xs text-[var(--pd-content-text)] break-all mt-1">{nodePath(selectedNode)}</p>
            </div>
            <button class="pai-btn text-xs" on:click={clearSelection} aria-label="Clear node selection"
              >Clear selection</button>
          </div>
          <div class="flex flex-col gap-3 text-xs text-[var(--pd-content-text)]">
            <div><span class="pai-text-muted">Publishes:</span> {selectedNode.publishingTopics.length}</div>
            <div class="font-mono break-all">{selectedNode.publishingTopics.join(', ') || 'None'}</div>
            <div><span class="pai-text-muted">Subscribes:</span> {selectedNode.subscribingTopics.length}</div>
            <div class="font-mono break-all">{selectedNode.subscribingTopics.join(', ') || 'None'}</div>
          </div>
        {:else}
          <h2 class="text-sm font-medium text-[var(--pd-content-header)]">Inspector</h2>
          <p class="text-xs text-[var(--pd-content-text)] mt-2">Select a node or topic to inspect its relationships.</p>
        {/if}
      </aside>
    </div>
  {/if}
</div>
