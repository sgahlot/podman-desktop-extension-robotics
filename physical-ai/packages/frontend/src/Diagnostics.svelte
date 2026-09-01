<script lang="ts">
import { onMount, onDestroy } from 'svelte';
import { get } from 'svelte/store';
import { router } from 'tinro';
import { physicalAiClient } from './api/client';
import type { SimContainerInfo } from '/@shared/src/types/SimulationContainer';
import type { TopicInfo } from '/@shared/src/types/TopicInfo';
import type { OpenShiftContext, OpenShiftWorkload } from '/@shared/src/types/OpenShiftDeploy';
import RobotDiagnosticsPanel from './lib/RobotDiagnosticsPanel.svelte';
import type { DiagnosticsTarget } from './lib/RobotDiagnosticsPanel.types';
import QuickLinks from './lib/QuickLinks.svelte';
import { navigationLayout } from './lib/navigationLayout';
import { lastOpenShiftSelection } from './lib/simSelection';

/**
 * Deep-link query params (see lib/diagnosticsLink.ts): `target=local&containerId=...&robot=...`
 * or `target=oc&namespace=...&workload=...&robot=...&context=...`. Both remain fully supported
 * as a way to arrive pre-selected on a specific simulation — the Diagnose buttons on both
 * Simulation pages use them. `target` also picks which tab opens by default.
 */
export let query: Record<string, string> = {};

let activeTab: 'local' | 'oc' = query.target === 'oc' ? 'oc' : 'local';

function switchTab(tab: 'local' | 'oc'): void {
  activeTab = tab;
  if (tab === 'oc') void activateOcTab();
}

// --- Local tab ---

let localLoading = true;
let localRefreshing = false;
let containers: SimContainerInfo[] = [];
let selectedContainerId = '';
let staleContainerNote = '';

/** Topics for the *selected* container only (see ensureTopicsLoaded) — fetching them for every
 * discovered container up front would be wasted work for containers the user never picks. */
let selectedTopics: TopicInfo[] = [];
let topicsLoadedForContainerId = '';

/**
 * Rebuilds the local container list and re-picks a selection. `preferId` (set on Refresh) keeps
 * the current selection when it still exists instead of snapping back to the deep-link/first-
 * container default.
 */
async function runLocalDiscovery(preferId: string | undefined): Promise<void> {
  let allContainers: SimContainerInfo[] = [];
  try {
    allContainers = await physicalAiClient.listSimulationContainers();
  } catch {
    // Fail-soft: treated the same as no containers running.
  }
  containers = allContainers.filter(c => c.state === 'running');

  const containerNotFound = !!(
    query.target !== 'oc' &&
    query.containerId &&
    !containers.some(c => c.id === query.containerId)
  );

  if (preferId && containers.some(c => c.id === preferId)) {
    selectedContainerId = preferId;
  } else if (query.target !== 'oc' && query.containerId && containers.some(c => c.id === query.containerId)) {
    selectedContainerId = query.containerId;
  } else {
    selectedContainerId = containers[0]?.id ?? '';
  }

  staleContainerNote =
    containerNotFound && selectedContainerId
      ? "This link's container is no longer running — showing the current simulation instead."
      : '';
}

async function refreshLocal(): Promise<void> {
  localRefreshing = true;
  await runLocalDiscovery(selectedContainerId);
  localRefreshing = false;
}

async function ensureTopicsLoaded(containerId: string): Promise<void> {
  let topics: TopicInfo[] = [];
  try {
    topics = await physicalAiClient.listRosTopics(containerId);
  } catch {
    // Fail-soft: RobotDiagnosticsPanel's node-list probe still finds spawned robots.
  }
  if (selectedContainerId !== containerId) return; // stale response — selection moved on
  selectedTopics = topics;
}

$: {
  if (selectedContainerId) {
    if (topicsLoadedForContainerId !== selectedContainerId) {
      topicsLoadedForContainerId = selectedContainerId;
      selectedTopics = [];
      void ensureTopicsLoaded(selectedContainerId);
    }
  } else if (topicsLoadedForContainerId) {
    topicsLoadedForContainerId = '';
    selectedTopics = [];
  }
}

$: localTarget = (
  selectedContainerId ? { kind: 'podman', containerId: selectedContainerId, topics: selectedTopics } : null
) as DiagnosticsTarget | null;

// --- OpenShift tab ---

/** Whether the OpenShift tab's data has been (or is being) loaded at least once — gates the
 * fallback-resolution + RPCs behind first activation, so a local-only user never pays for them. */
let ocActivated = false;
let ocLoading = true;

let ocContexts: { name: string; clusterUrl?: string; namespace?: string }[] = [];
let ocContext = '';
let ocNamespace = '';
let workloads: OpenShiftWorkload[] = [];
let selectedWorkloadName = '';

let ocListBusy = false;
let ocListError = '';
let ocEmptyMessage = '';

let ocProjects: string[] = [];
let ocNamespaceMenuOpen = false;
let ocNamespaceBlurTimeout: ReturnType<typeof setTimeout> | undefined;

$: filteredOcProjects = ocProjects.filter(p => !ocNamespace || p.toLowerCase().includes(ocNamespace.toLowerCase()));
$: ocNamespaceMenuVisible = ocNamespaceMenuOpen && filteredOcProjects.length > 0;

$: ocTarget = (
  ocNamespace && selectedWorkloadName
    ? { kind: 'oc', namespace: ocNamespace, workload: selectedWorkloadName, context: ocContext || undefined }
    : null
) as DiagnosticsTarget | null;

/**
 * Resolves an OpenShift namespace/context to try, in order: (a) the last one used on the
 * Simulation page (lastOpenShiftSelection); (b) the current kube context, if it's bound to a
 * real (non-'default') namespace; (c) the configured default namespace setting; (d) none — the
 * Cluster/Namespace fields stay editable and empty until the user lists manually.
 */
async function resolveOpenShiftNamespace(): Promise<{ namespace: string; context?: string } | null> {
  const stored = get(lastOpenShiftSelection);
  if (stored) return { namespace: stored.namespace, context: stored.context };

  let context: OpenShiftContext | undefined;
  try {
    context = await physicalAiClient.getOpenShiftContext();
  } catch {
    context = undefined;
  }
  if (context?.namespace && context.namespace !== 'default') {
    return { namespace: context.namespace, context: context.context };
  }

  try {
    const fallback = await physicalAiClient.getDefaultOpenShiftNamespace();
    if (fallback) return { namespace: fallback, context: context?.context };
  } catch {
    // Fail soft — the Cluster/Namespace fields are still available for a manual list.
  }

  return null;
}

/**
 * Fetches workloads for the current ocNamespace/ocContext. `explicit` (set for a deep-linked
 * workload) is force-selected regardless of what the list contains — and, if the list doesn't
 * happen to include it, added synthetically so the picker still shows it — matching the
 * deep-link precedence contract: an explicit link always wins over discovery.
 */
async function fetchOcWorkloads(explicit?: string): Promise<void> {
  ocListBusy = true;
  ocListError = '';
  ocEmptyMessage = '';
  try {
    workloads = await physicalAiClient.listOpenShiftDeployments(ocNamespace, ocContext || undefined);
  } catch (e) {
    workloads = [];
    ocListError = e instanceof Error ? e.message : 'Failed to list deployments';
  }

  if (explicit) {
    if (!workloads.some(w => w.name === explicit)) {
      workloads = [
        { name: explicit, namespace: ocNamespace, replicas: 0, readyReplicas: 0, ready: false },
        ...workloads,
      ];
    }
    selectedWorkloadName = explicit;
  } else if (workloads.some(w => w.name === selectedWorkloadName)) {
    // keep the current selection (e.g. re-listing the same namespace)
  } else if (workloads.length > 0) {
    selectedWorkloadName = workloads[0].name;
  } else {
    selectedWorkloadName = '';
    if (!ocListError) ocEmptyMessage = `No simulations found in "${ocNamespace}".`;
  }

  ocListBusy = false;
}

async function refreshOcProjects(): Promise<void> {
  try {
    ocProjects = await physicalAiClient.listOpenShiftProjects(ocContext || undefined);
  } catch {
    ocProjects = [];
  }
}

/**
 * First-activation load for the OpenShift tab: populates the Cluster dropdown, then either
 * builds the deep-linked target directly (skipping auto-resolution entirely) or resolves a
 * namespace/context via the fallback chain and lists its workloads.
 */
async function activateOcTab(): Promise<void> {
  if (ocActivated) return;
  ocActivated = true;
  ocLoading = true;

  try {
    ocContexts = await physicalAiClient.listKubeContexts();
  } catch {
    ocContexts = [];
  }

  if (query.target === 'oc' && query.namespace && query.workload) {
    ocNamespace = query.namespace;
    ocContext = query.context || '';
    await fetchOcWorkloads(query.workload);
  } else {
    const resolved = await resolveOpenShiftNamespace();
    ocNamespace = resolved?.namespace ?? '';
    ocContext = resolved?.context ?? (ocContexts.length > 0 ? ocContexts[0].name : '');
    if (ocNamespace) {
      await fetchOcWorkloads();
    }
  }

  await refreshOcProjects();
  ocLoading = false;
}

async function onOcContextChange(): Promise<void> {
  // The namespace/workload picked under the previous cluster almost certainly doesn't exist on
  // this one — clear them so the panel doesn't probe a stale (new context, old namespace/workload)
  // combination against it before the user re-lists.
  workloads = [];
  selectedWorkloadName = '';
  ocEmptyMessage = '';
  ocListError = '';
  await refreshOcProjects();
}

/** Explicit "List simulations" action (not fired on every keystroke) for manually entered
 * Cluster/Namespace values. Writes the choice into lastOpenShiftSelection on success, same as
 * the Simulation page, so the two pages stay in sync. */
async function listOcSimulations(): Promise<void> {
  if (!ocNamespace) return;
  await fetchOcWorkloads();
  if (!ocListError && ocContext) {
    lastOpenShiftSelection.set({ context: ocContext, namespace: ocNamespace });
  }
}

function handleOcNamespaceFocus(): void {
  if (ocNamespaceBlurTimeout) clearTimeout(ocNamespaceBlurTimeout);
  ocNamespaceMenuOpen = true;
}

function handleOcNamespaceInput(): void {
  ocNamespaceMenuOpen = true;
}

function handleOcNamespaceBlur(): void {
  ocNamespaceBlurTimeout = setTimeout(() => {
    ocNamespaceMenuOpen = false;
  }, 150);
}

function selectOcProject(project: string): void {
  ocNamespace = project;
  ocNamespaceMenuOpen = false;
}

onMount(async () => {
  await runLocalDiscovery(undefined);
  localLoading = false;
  if (activeTab === 'oc') await activateOcTab();
});

onDestroy(() => {
  if (ocNamespaceBlurTimeout) clearTimeout(ocNamespaceBlurTimeout);
});
</script>

<div class="flex flex-col p-4 gap-4 w-full flex-1 min-h-0 min-w-0 overflow-auto">
  {#if $navigationLayout === 'cards'}
    <button on:click={() => router.goto('/')} class="pai-link self-start"> &larr; Back to Dashboard </button>
  {/if}
  <h1 class="text-3xl text-[var(--pd-content-header)]">Diagnostics</h1>
  {#if $navigationLayout === 'cards'}
    <QuickLinks links={[{ label: 'Simulation', to: '/simulation' }]} />
  {/if}
  <p class="text-sm text-[var(--pd-content-text)]">
    Plain-language TF/costmap/sensor snapshots for a running robot — one-shot, click Refresh to re-capture.
  </p>

  <div class="flex flex-row gap-1 border-b border-[var(--pd-content-card-border)]">
    <button
      role="tab"
      aria-selected={activeTab === 'local'}
      on:click={() => switchTab('local')}
      class="px-5 py-2 text-sm pai-tab {activeTab === 'local' ? 'pai-tab-active' : ''}">
      Local
    </button>
    <button
      role="tab"
      aria-selected={activeTab === 'oc'}
      on:click={() => switchTab('oc')}
      class="px-5 py-2 text-sm pai-tab {activeTab === 'oc' ? 'pai-tab-active' : ''}">
      OpenShift
    </button>
  </div>

  {#if activeTab === 'local'}
    {#if localLoading}
      <div class="flex flex-1 flex-col items-center justify-center gap-2 min-h-[200px]">
        <span class="inline-block w-3 h-3 rounded-full bg-current pai-text-accent animate-pulse"></span>
        <span class="text-sm pai-text-muted">Loading…</span>
      </div>
    {:else}
      <div class="flex flex-row items-end gap-3 flex-wrap">
        {#if containers.length > 0}
          <div class="flex flex-col gap-1">
            <label for="simulationSelect" class="text-xs text-[var(--pd-content-text)]">Simulation</label>
            <select
              id="simulationSelect"
              bind:value={selectedContainerId}
              class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-[var(--pd-content-text)]">
              {#each containers as c}
                <option value={c.id}>{c.name} — {c.imageTag}</option>
              {/each}
            </select>
          </div>
        {/if}
        <button on:click={refreshLocal} disabled={localRefreshing} class="pai-btn pai-btn-primary">
          {localRefreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {#if staleContainerNote}
        <div class="text-xs pai-text-muted">{staleContainerNote}</div>
      {/if}

      {#if !localTarget}
        <div
          class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 max-w-lg">
          <p class="text-sm text-[var(--pd-content-text)]">
            No simulation is running.
            <button on:click={() => router.goto('/simulation')} class="pai-link">Launch one</button>
            to view diagnostics.
          </p>
        </div>
      {:else}
        <RobotDiagnosticsPanel target={localTarget} initialRobotName={query.robot || undefined} />
      {/if}
    {/if}
  {:else}
    <div class="flex flex-col gap-3">
      <div class="flex flex-row items-end gap-3 flex-wrap">
        <div class="flex flex-col gap-1">
          <label for="diag-oc-context" class="text-xs text-[var(--pd-content-text)]">Cluster</label>
          <select
            id="diag-oc-context"
            bind:value={ocContext}
            on:change={onOcContextChange}
            class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-[var(--pd-content-text)] font-mono">
            {#each ocContexts as ctx}
              <option value={ctx.name}>{ctx.clusterUrl ?? ctx.name}</option>
            {/each}
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label for="diag-oc-namespace" class="text-xs text-[var(--pd-content-text)]">Project / namespace</label>
          <div class="relative">
            <input
              id="diag-oc-namespace"
              role="combobox"
              aria-expanded={ocNamespaceMenuVisible}
              aria-controls="diag-oc-namespace-listbox"
              aria-autocomplete="list"
              bind:value={ocNamespace}
              on:focus={handleOcNamespaceFocus}
              on:input={handleOcNamespaceInput}
              on:blur={handleOcNamespaceBlur}
              autocomplete="off"
              placeholder="e.g. my-project"
              class="w-full px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-[var(--pd-content-text)] font-mono" />
            {#if ocNamespaceMenuVisible}
              <ul
                id="diag-oc-namespace-listbox"
                role="listbox"
                class="absolute top-full left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] shadow-lg">
                {#each filteredOcProjects as project (project)}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <li
                    role="option"
                    aria-selected={project === ocNamespace}
                    on:mousedown|preventDefault
                    on:click={() => selectOcProject(project)}
                    class="px-3 py-1.5 text-sm font-mono cursor-pointer text-[var(--pd-content-text)] hover:bg-[var(--pd-content-card-border)]">
                    {project}
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        </div>
        <button
          type="button"
          on:click={listOcSimulations}
          disabled={ocListBusy || !ocNamespace}
          class="pai-btn pai-btn-primary">
          {ocListBusy ? 'Loading…' : 'List simulations'}
        </button>
      </div>

      {#if ocListError}
        <span class="text-sm pai-text-error">{ocListError}</span>
      {/if}

      {#if ocLoading}
        <div class="flex flex-1 flex-col items-center justify-center gap-2 min-h-[200px]">
          <span class="inline-block w-3 h-3 rounded-full bg-current pai-text-accent animate-pulse"></span>
          <span class="text-sm pai-text-muted">Loading…</span>
        </div>
      {:else}
        {#if workloads.length > 1}
          <div class="flex flex-col gap-1 max-w-xs">
            <label for="diag-oc-workload" class="text-xs text-[var(--pd-content-text)]">Simulation</label>
            <select
              id="diag-oc-workload"
              bind:value={selectedWorkloadName}
              class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-[var(--pd-content-text)]">
              {#each workloads as w}
                <option value={w.name}>{w.name}{w.ready ? '' : ' (starting…)'}</option>
              {/each}
            </select>
          </div>
        {/if}

        {#if ocEmptyMessage}
          <p class="text-sm pai-text-muted">{ocEmptyMessage}</p>
        {:else if ocTarget}
          <RobotDiagnosticsPanel target={ocTarget} initialRobotName={query.robot || undefined} />
        {/if}
      {/if}
    </div>
  {/if}
</div>
