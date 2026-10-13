<script lang="ts">
export let names: string[] = [];
export let query = '';
export let role: 'publisher' | 'subscriber';

$: normalizedQuery = query.trim().toLowerCase();
</script>

{#each names as name, index}
  {#if index > 0},
  {/if}
  {#if normalizedQuery && name.toLowerCase().includes(normalizedQuery)}
    <mark
      class="font-mono font-semibold rounded px-1 bg-[var(--pd-button-secondary-bg)] text-[var(--pd-button-secondary-text)]"
      title={`Matching ${role}`}>{name}</mark>
  {:else}
    <span class="font-mono">{name}</span>
  {/if}
{:else}
  None
{/each}
