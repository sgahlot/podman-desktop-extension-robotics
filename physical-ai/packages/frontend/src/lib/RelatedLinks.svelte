<script lang="ts">
import { router } from 'tinro';

/** Contextual links to related pages, rendered as a compact row under a page title. */
export let links: Array<{ label: string; to: string }> = [];
</script>

{#if links.length > 0}
  <div class="flex flex-row flex-wrap items-center gap-x-3 gap-y-1 text-sm">
    <span class="pai-text-muted">Related:</span>
    {#each links as link (link.to)}
      <button on:click={() => router.goto(link.to)} class="pai-link">{link.label} &rarr;</button>
    {/each}
  </div>
{/if}
