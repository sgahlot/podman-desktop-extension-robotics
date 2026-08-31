<script lang="ts">
import { onMount } from 'svelte';
import { router } from 'tinro';
import { physicalAiClient } from './api/client';
import type { SimContainerInfo } from '/@shared/src/types/SimulationContainer';
import type { TopicInfo } from '/@shared/src/types/TopicInfo';
import RobotDiagnosticsPanel from './lib/RobotDiagnosticsPanel.svelte';
import type { DiagnosticsTarget } from './lib/RobotDiagnosticsPanel.types';
import QuickLinks from './lib/QuickLinks.svelte';
import { navigationLayout } from './lib/navigationLayout';

/**
 * Deep-link query params (see lib/diagnosticsLink.ts): `target=local&containerId=...&robot=...`
 * or `target=oc&namespace=...&workload=...&robot=...&context=...`. OpenShift access is
 * deep-link-only for this pass — no manual namespace/workload/context picker here.
 */
export let query: Record<string, string> = {};

let loading = true;
let target: DiagnosticsTarget | null = null;
let staleContainerNote = '';

/**
 * Resolves the diagnostics target once on mount — no polling, matching this feature's
 * single-fetch invariant. An `oc` target is built directly from the query params (no RPC
 * needed to construct it); resolution/exec failures against it surface later, inside
 * RobotDiagnosticsPanel, the same way an invalid podman container id would.
 */
async function resolveTarget(): Promise<void> {
  if (query.target === 'oc' && query.namespace && query.workload) {
    target = {
      kind: 'oc',
      namespace: query.namespace,
      workload: query.workload,
      context: query.context || undefined,
    };
    loading = false;
    return;
  }

  let containers: SimContainerInfo[] = [];
  try {
    containers = await physicalAiClient.listSimulationContainers();
  } catch {
    // Fail-soft: treated the same as no containers running.
  }
  const runningContainers = containers.filter(c => c.state === 'running');

  let containerId = '';
  if (query.containerId && runningContainers.some(c => c.id === query.containerId)) {
    containerId = query.containerId;
  } else if (runningContainers.length > 0) {
    if (query.containerId) {
      staleContainerNote = "This link's container is no longer running — showing the current simulation instead.";
    }
    containerId = runningContainers[0].id;
  }

  if (!containerId) {
    target = null;
    loading = false;
    return;
  }

  let topics: TopicInfo[] = [];
  try {
    topics = await physicalAiClient.listRosTopics(containerId);
  } catch {
    // Fail-soft: RobotDiagnosticsPanel's node-list probe still finds spawned robots.
  }

  target = { kind: 'podman', containerId, topics };
  loading = false;
}

onMount(() => {
  resolveTarget();
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
  {:else if !target}
    <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4 max-w-lg">
      <p class="text-sm text-[var(--pd-content-text)]">
        No simulation is running.
        <button on:click={() => router.goto('/simulation')} class="pai-link">Launch one</button>
        to view diagnostics.
      </p>
    </div>
  {:else}
    {#if staleContainerNote}
      <div class="text-xs pai-text-muted">{staleContainerNote}</div>
    {/if}
    <RobotDiagnosticsPanel target={target} initialRobotName={query.robot || undefined} />
  {/if}
</div>
