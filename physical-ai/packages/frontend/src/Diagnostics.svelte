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
 * as a way to arrive pre-selected on a specific simulation (the Diagnose buttons on both
 * Simulation pages use them) — this page also has its own "Simulation" picker covering every
 * running local container and (namespace/context permitting) OpenShift workload, so a user can
 * browse and switch freely instead of needing a fresh deep link for every target.
 */
export let query: Record<string, string> = {};

interface SimOption {
  key: string;
  label: string;
}

interface ExtraTarget {
  key: string;
  label: string;
  target: DiagnosticsTarget;
}

let loading = true;
let refreshing = false;

let containers: SimContainerInfo[] = [];
let workloads: OpenShiftWorkload[] = [];
/** Namespace/context an OpenShift workload list was actually fetched for — resolved via
 * resolveOpenShiftNamespace() or the manual switcher below, never guessed at render time. */
let ocNamespace = '';
let ocContext: string | undefined = undefined;
/** A deep-linked oc target that doesn't fall inside the auto-resolved namespace/context (e.g. a
 * link to a different namespace than the one this session last used) — added to the option list
 * directly instead of requiring rediscovery, per the deep-link backward-compat contract. */
let extraTarget: ExtraTarget | null = null;

let selectedKey = '';
let staleContainerNote = '';

/** Topics for the *selected* podman option only (see ensureTopicsLoaded) — fetching them for
 * every discovered container up front would be wasted work for options the user never picks. */
let selectedTopics: TopicInfo[] = [];
let topicsLoadedForKey = '';

let switcherOpen = false;
let switcherContexts: { name: string; clusterUrl?: string; namespace?: string }[] = [];
let switcherContext = '';
let switcherNamespace = '';
let switcherProjects: string[] = [];
let switcherNamespaceMenuOpen = false;
let switcherBlurTimeout: ReturnType<typeof setTimeout> | undefined;
let switcherBusy = false;
let switcherError = '';

function podmanKey(id: string): string {
  return `podman:${id}`;
}

function ocKey(namespace: string, workload: string, context: string | undefined): string {
  return `oc:${namespace}/${workload}/${context ?? ''}`;
}

function buildOptions(
  containers: SimContainerInfo[],
  workloads: OpenShiftWorkload[],
  ocNamespace: string,
  ocContext: string | undefined,
  extra: ExtraTarget | null,
): SimOption[] {
  const options: SimOption[] = [
    ...containers.map(c => ({ key: podmanKey(c.id), label: `Local — ${c.name} — ${c.imageTag}` })),
    ...workloads.map(w => ({
      key: ocKey(ocNamespace, w.name, ocContext),
      label: `OpenShift — ${ocNamespace}/${w.name}${w.ready ? '' : ' (starting…)'}`,
    })),
  ];
  if (extra && !options.some(o => o.key === extra.key)) {
    options.push({ key: extra.key, label: extra.label });
  }
  return options;
}

function buildTargetsByKey(
  containers: SimContainerInfo[],
  workloads: OpenShiftWorkload[],
  ocNamespace: string,
  ocContext: string | undefined,
  extra: ExtraTarget | null,
): Map<string, DiagnosticsTarget> {
  const map = new Map<string, DiagnosticsTarget>();
  for (const c of containers) {
    map.set(podmanKey(c.id), { kind: 'podman', containerId: c.id, topics: [] });
  }
  for (const w of workloads) {
    map.set(ocKey(ocNamespace, w.name, ocContext), {
      kind: 'oc',
      namespace: ocNamespace,
      workload: w.name,
      context: ocContext,
    });
  }
  if (extra && !map.has(extra.key)) {
    map.set(extra.key, extra.target);
  }
  return map;
}

/** Builds the deep-linked oc target directly from the query (no RPC needed), unless it's already
 * covered by the auto-discovered namespace/context's own workload list. */
function computeExtraTarget(
  workloads: OpenShiftWorkload[],
  ocNamespace: string,
  ocContext: string | undefined,
): ExtraTarget | null {
  if (query.target === 'oc' && query.namespace && query.workload) {
    const context = query.context || undefined;
    const alreadyListed =
      query.namespace === ocNamespace && context === ocContext && workloads.some(w => w.name === query.workload);
    if (!alreadyListed) {
      return {
        key: ocKey(query.namespace, query.workload, context),
        label: `OpenShift — ${query.namespace}/${query.workload}`,
        target: { kind: 'oc', namespace: query.namespace, workload: query.workload, context },
      };
    }
  }
  return null;
}

/** Default-selection priority: keep the current selection if it still resolves (Refresh) → the
 * deep-link query params → first local container → first OpenShift workload → none. */
function pickDefaultKey(map: Map<string, DiagnosticsTarget>, preferKey: string | undefined): string {
  if (preferKey && map.has(preferKey)) return preferKey;

  if (query.target === 'oc' && query.namespace && query.workload) {
    const key = ocKey(query.namespace, query.workload, query.context || undefined);
    if (map.has(key)) return key;
  }

  if (query.containerId && map.has(podmanKey(query.containerId))) {
    return podmanKey(query.containerId);
  }

  for (const [key, t] of map) {
    if (t.kind === 'podman') return key;
  }
  for (const [key, t] of map) {
    if (t.kind === 'oc') return key;
  }
  return '';
}

/**
 * Resolves an OpenShift namespace/context to try, in order: (a) the last one used on the
 * Simulation page (lastOpenShiftSelection); (b) the current kube context, if it's bound to a
 * real (non-'default') namespace; (c) the configured default namespace setting; (d) none — no
 * OpenShift options are shown until the user picks one via the switcher below.
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
    // Fail soft — no OpenShift entries by default; the switcher is still available.
  }

  return null;
}

/**
 * Rebuilds the whole simulation list — local containers plus, namespace permitting, OpenShift
 * workloads — and re-picks a selection. `preferKey` (set on Refresh) keeps the current selection
 * when it still exists instead of snapping back to the default priority chain.
 */
async function runDiscovery(preferKey: string | undefined): Promise<void> {
  let allContainers: SimContainerInfo[] = [];
  try {
    allContainers = await physicalAiClient.listSimulationContainers();
  } catch {
    // Fail-soft: treated the same as no containers running.
  }
  containers = allContainers.filter(c => c.state === 'running');

  const resolvedOc = await resolveOpenShiftNamespace();
  ocNamespace = resolvedOc?.namespace ?? '';
  ocContext = resolvedOc?.context;
  if (ocNamespace) {
    try {
      workloads = await physicalAiClient.listOpenShiftDeployments(ocNamespace, ocContext);
    } catch {
      workloads = [];
    }
  } else {
    workloads = [];
  }

  extraTarget = computeExtraTarget(workloads, ocNamespace, ocContext);
  const map = buildTargetsByKey(containers, workloads, ocNamespace, ocContext, extraTarget);

  const containerNotFound = !!(
    query.containerId &&
    query.target !== 'oc' &&
    !containers.some(c => c.id === query.containerId)
  );

  selectedKey = pickDefaultKey(map, preferKey);
  staleContainerNote =
    containerNotFound && selectedKey
      ? "This link's container is no longer running — showing the current simulation instead."
      : '';
}

async function refresh(): Promise<void> {
  refreshing = true;
  await runDiscovery(selectedKey);
  refreshing = false;
}

onMount(async () => {
  await runDiscovery(undefined);
  loading = false;
});

$: options = buildOptions(containers, workloads, ocNamespace, ocContext, extraTarget);
$: targetsByKey = buildTargetsByKey(containers, workloads, ocNamespace, ocContext, extraTarget);

async function ensureTopicsLoaded(key: string, containerId: string): Promise<void> {
  let topics: TopicInfo[] = [];
  try {
    topics = await physicalAiClient.listRosTopics(containerId);
  } catch {
    // Fail-soft: RobotDiagnosticsPanel's node-list probe still finds spawned robots.
  }
  if (selectedKey !== key) return; // stale response — selection moved on
  selectedTopics = topics;
}

$: {
  const opt = targetsByKey.get(selectedKey);
  if (opt?.kind === 'podman') {
    if (topicsLoadedForKey !== selectedKey) {
      topicsLoadedForKey = selectedKey;
      selectedTopics = [];
      void ensureTopicsLoaded(selectedKey, opt.containerId);
    }
  } else if (topicsLoadedForKey) {
    topicsLoadedForKey = '';
    selectedTopics = [];
  }
}

$: target = ((): DiagnosticsTarget | null => {
  const opt = targetsByKey.get(selectedKey);
  if (!opt) return null;
  return opt.kind === 'podman' ? { ...opt, topics: selectedTopics } : opt;
})();

$: filteredSwitcherProjects = switcherProjects.filter(
  p => !switcherNamespace || p.toLowerCase().includes(switcherNamespace.toLowerCase()),
);
$: switcherNamespaceMenuVisible = switcherNamespaceMenuOpen && filteredSwitcherProjects.length > 0;

async function refreshSwitcherProjects(): Promise<void> {
  try {
    switcherProjects = await physicalAiClient.listOpenShiftProjects(switcherContext || undefined);
  } catch {
    switcherProjects = [];
  }
}

/** Opens the namespace/cluster switcher, seeded from whatever namespace/context is already
 * resolved (if any) so overriding it is a small edit rather than starting from scratch. */
async function toggleSwitcher(): Promise<void> {
  if (switcherOpen) {
    switcherOpen = false;
    return;
  }
  switcherOpen = true;
  switcherError = '';
  switcherContext = ocContext ?? switcherContext;
  switcherNamespace = ocNamespace || switcherNamespace;
  try {
    switcherContexts = await physicalAiClient.listKubeContexts();
  } catch {
    switcherContexts = [];
  }
  if (!switcherContext && switcherContexts.length > 0) switcherContext = switcherContexts[0].name;
  await refreshSwitcherProjects();
}

async function onSwitcherContextChange(): Promise<void> {
  await refreshSwitcherProjects();
}

function handleSwitcherNamespaceFocus(): void {
  if (switcherBlurTimeout) clearTimeout(switcherBlurTimeout);
  switcherNamespaceMenuOpen = true;
}

function handleSwitcherNamespaceInput(): void {
  switcherNamespaceMenuOpen = true;
}

function handleSwitcherNamespaceBlur(): void {
  switcherBlurTimeout = setTimeout(() => {
    switcherNamespaceMenuOpen = false;
  }, 150);
}

function selectSwitcherProject(project: string): void {
  switcherNamespace = project;
  switcherNamespaceMenuOpen = false;
}

/** Re-lists workloads for the chosen namespace/context, merges them into the unified option
 * list, and writes the choice into lastOpenShiftSelection so the Simulation page picks it up too. */
async function applySwitcher(): Promise<void> {
  if (!switcherNamespace) return;
  switcherBusy = true;
  switcherError = '';
  try {
    const nextWorkloads = await physicalAiClient.listOpenShiftDeployments(
      switcherNamespace,
      switcherContext || undefined,
    );
    workloads = nextWorkloads;
    ocNamespace = switcherNamespace;
    ocContext = switcherContext || undefined;
    if (switcherContext) {
      lastOpenShiftSelection.set({ context: switcherContext, namespace: switcherNamespace });
    }
    extraTarget = computeExtraTarget(workloads, ocNamespace, ocContext);
    if (workloads.length > 0) {
      selectedKey = ocKey(ocNamespace, workloads[0].name, ocContext);
      switcherOpen = false;
    } else {
      // Nothing to select in this namespace — reconcile selectedKey (it may have pointed at a
      // workload from the previous namespace that's no longer in the rebuilt list) instead of
      // leaving it stranded on a stale key, and keep the switcher open so the message is visible.
      const map = buildTargetsByKey(containers, workloads, ocNamespace, ocContext, extraTarget);
      selectedKey = pickDefaultKey(map, undefined);
      switcherError = `No simulations found in "${ocNamespace}".`;
    }
  } catch (e) {
    switcherError = e instanceof Error ? e.message : 'Failed to list deployments';
  } finally {
    switcherBusy = false;
  }
}

onDestroy(() => {
  if (switcherBlurTimeout) clearTimeout(switcherBlurTimeout);
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

  {#if loading}
    <div class="flex flex-1 flex-col items-center justify-center gap-2 min-h-[200px]">
      <span class="inline-block w-3 h-3 rounded-full bg-current pai-text-accent animate-pulse"></span>
      <span class="text-sm pai-text-muted">Loading…</span>
    </div>
  {:else}
    <div class="flex flex-row items-end gap-3 flex-wrap">
      {#if options.length > 0}
        <div class="flex flex-col gap-1">
          <label for="simulationSelect" class="text-xs text-[var(--pd-content-text)]">Simulation</label>
          <select
            id="simulationSelect"
            bind:value={selectedKey}
            class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-[var(--pd-content-text)]">
            {#each options as opt}
              <option value={opt.key}>{opt.label}</option>
            {/each}
          </select>
        </div>
      {/if}
      <button on:click={refresh} disabled={refreshing} class="pai-btn pai-btn-primary">
        {refreshing ? 'Refreshing…' : 'Refresh'}
      </button>
      <button type="button" on:click={toggleSwitcher} class="pai-link text-xs">
        {workloads.length > 0 ? 'Switch cluster/namespace' : 'Show OpenShift simulations…'}
      </button>
    </div>

    {#if staleContainerNote}
      <div class="text-xs pai-text-muted">{staleContainerNote}</div>
    {/if}

    {#if switcherOpen}
      <div
        class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 max-w-lg flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <label for="diag-oc-context" class="text-xs text-[var(--pd-content-text)]">Cluster</label>
          <select
            id="diag-oc-context"
            bind:value={switcherContext}
            on:change={onSwitcherContextChange}
            class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] font-mono">
            {#each switcherContexts as ctx}
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
              aria-expanded={switcherNamespaceMenuVisible}
              aria-controls="diag-oc-namespace-listbox"
              aria-autocomplete="list"
              bind:value={switcherNamespace}
              on:focus={handleSwitcherNamespaceFocus}
              on:input={handleSwitcherNamespaceInput}
              on:blur={handleSwitcherNamespaceBlur}
              autocomplete="off"
              placeholder="e.g. my-project"
              class="w-full px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] font-mono" />
            {#if switcherNamespaceMenuVisible}
              <ul
                id="diag-oc-namespace-listbox"
                role="listbox"
                class="absolute top-full left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] shadow-lg">
                {#each filteredSwitcherProjects as project (project)}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <li
                    role="option"
                    aria-selected={project === switcherNamespace}
                    on:mousedown|preventDefault
                    on:click={() => selectSwitcherProject(project)}
                    class="px-3 py-1.5 text-sm font-mono cursor-pointer text-[var(--pd-content-text)] hover:bg-[var(--pd-content-card-border)]">
                    {project}
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        </div>
        <div class="flex flex-row items-center gap-3">
          <button
            type="button"
            on:click={applySwitcher}
            disabled={switcherBusy || !switcherNamespace}
            class="pai-btn pai-btn-primary text-sm">
            {switcherBusy ? 'Loading…' : 'Use this namespace'}
          </button>
          <button type="button" on:click={() => (switcherOpen = false)} class="pai-btn text-sm">Cancel</button>
        </div>
        {#if switcherError}
          <span class="text-sm pai-text-error">{switcherError}</span>
        {/if}
      </div>
    {/if}

    {#if !target}
      <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 max-w-lg">
        <p class="text-sm text-[var(--pd-content-text)]">
          No simulation is running.
          <button on:click={() => router.goto('/simulation')} class="pai-link">Launch one</button>
          to view diagnostics.
        </p>
      </div>
    {:else}
      <RobotDiagnosticsPanel target={target} initialRobotName={query.robot || undefined} />
    {/if}
  {/if}
</div>
