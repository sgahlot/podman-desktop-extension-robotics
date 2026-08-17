<script lang="ts">
import { router } from 'tinro';
import LocalSimulation from './LocalSimulation.svelte';
import OpenShiftSimulation from './OpenShiftSimulation.svelte';

$: tab = $router.path.startsWith('/simulation/openshift') ? 'openshift' : 'local';
</script>

<div class="flex flex-col p-4 gap-4 h-full overflow-hidden">
  <button on:click={() => router.goto('/')} class="pai-link self-start"> &larr; Back to Dashboard </button>
  <h1 class="text-3xl text-[var(--pd-content-header)]">Simulation</h1>

  <div class="flex flex-row gap-1 border-b border-[var(--pd-content-card-border)]">
    <button
      on:click={() => router.goto('/simulation')}
      class="px-4 py-2 text-sm border-b-2 -mb-px {tab === 'local'
        ? 'border-[var(--pd-content-header)] text-[var(--pd-content-header)] font-medium'
        : 'border-transparent pai-text-muted'}">
      Local
    </button>
    <button
      on:click={() => router.goto('/simulation/openshift')}
      class="px-4 py-2 text-sm border-b-2 -mb-px {tab === 'openshift'
        ? 'border-[var(--pd-content-header)] text-[var(--pd-content-header)] font-medium'
        : 'border-transparent pai-text-muted'}">
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
