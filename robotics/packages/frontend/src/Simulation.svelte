<script lang="ts">
import { router } from 'tinro';
import LocalSimulation from './LocalSimulation.svelte';
import OpenShiftSimulation from './OpenShiftSimulation.svelte';
import QuickLinks from './lib/QuickLinks.svelte';
import { navigationLayout } from './lib/navigationLayout';
import { lastSimulationTarget } from './lib/simulationViewState';

export let active = true;

$: tab = $router.path.startsWith('/simulation/openshift') ? 'openshift' : $lastSimulationTarget;

$: if (tab === 'openshift') lastSimulationTarget.set('openshift');

function selectTab(target: 'local' | 'openshift') {
  lastSimulationTarget.set(target);
  router.goto(target === 'openshift' ? '/simulation/openshift' : '/simulation');
}
</script>

<div class="flex flex-col p-4 gap-4 h-full overflow-hidden">
  {#if $navigationLayout === 'cards'}
    <button on:click={() => router.goto('/')} class="pai-link self-start"> &larr; Back to Dashboard </button>
  {/if}
  <h1 class="text-3xl text-[var(--pd-content-header)]">Simulation</h1>
  {#if $navigationLayout === 'cards'}
    <QuickLinks
      links={[
        { label: 'Topic Monitor', to: '/topics' },
        { label: 'Image Builder', to: '/build' },
      ]} />
  {/if}

  <div class="flex flex-row gap-1 border-b border-[var(--pd-content-card-border)]">
    <button
      role="tab"
      aria-selected={tab === 'local'}
      on:click={() => selectTab('local')}
      class="px-5 py-2 text-sm pai-tab {tab === 'local' ? 'pai-tab-active' : ''}">
      Local
    </button>
    <button
      role="tab"
      aria-selected={tab === 'openshift'}
      on:click={() => selectTab('openshift')}
      class="px-5 py-2 text-sm pai-tab {tab === 'openshift' ? 'pai-tab-active' : ''}">
      OpenShift
    </button>
  </div>

  <div class="flex-1 min-h-0 overflow-auto">
    {#if tab === 'openshift'}
      <OpenShiftSimulation />
    {:else}
      <LocalSimulation />
    {/if}
  </div>
</div>
