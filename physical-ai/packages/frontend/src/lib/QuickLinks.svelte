<script lang="ts">
import { router } from 'tinro';

/** Contextual links to related pages, rendered as a row of chips under a page title. */
export let links: Array<{ label: string; to: string }> = [];
</script>

{#if links.length > 0}
  <div class="flex flex-row flex-wrap items-center gap-x-2 gap-y-1 text-sm">
    <span class="pai-text-muted">Quick Links:</span>
    {#each links as link (link.to)}
      <button
        on:click={() => router.goto(link.to)}
        class="px-2.5 py-0.5 rounded-full border border-[var(--pd-content-card-border)] text-[var(--pd-link,var(--pd-content-text))] hover:bg-[var(--pd-content-card-hover-bg,var(--pd-content-bg))] transition-colors">
        {link.label}
      </button>
    {/each}
  </div>
{/if}
