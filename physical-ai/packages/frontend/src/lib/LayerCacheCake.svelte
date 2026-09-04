<script lang="ts">
import type { LayerCacheStatusEntry } from '/@shared/src/types/BuildHistory';

/** Option B — stacked layer-cake view of per-slice Podman cache status (APPENG-6298). */
export let entries: LayerCacheStatusEntry[] = [];
</script>

{#if entries.length > 0}
  <div
    class="flex flex-col-reverse gap-1 max-w-md"
    role="img"
    aria-label="Composition layer cache stack, base at bottom">
    {#each entries as entry, i}
      <div
        class="rounded border px-2 py-1.5 text-xs flex flex-row items-center justify-between gap-2"
        class:pai-banner-success={entry.cached}
        class:pai-banner-warning={!entry.cached}
        style="margin-inline: {(entries.length - 1 - i) * 6}px;">
        <span class="font-medium text-[var(--pd-content-text)]">{entry.layer}</span>
        <span class="whitespace-nowrap">{entry.cached ? '✓ cached' : '↻ rebuilt'}</span>
      </div>
    {/each}
  </div>
{/if}
