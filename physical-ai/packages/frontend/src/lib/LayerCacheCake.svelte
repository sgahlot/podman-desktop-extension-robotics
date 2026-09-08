<script lang="ts">
import type { LayerCacheStatusEntry } from '/@shared/src/types/BuildHistory';
import { formatLayerCacheSummary, layerCacheOutcomeLabel } from '/@shared/src/types/buildLayerCache';

/** Per-slice Podman cache status — inline flow chips (APPENG-6298). */
export let entries: LayerCacheStatusEntry[] = [];
</script>

{#if entries.length > 0}
  <div
    class="flex flex-row flex-wrap items-center gap-x-1 gap-y-1"
    role="img"
    aria-label={formatLayerCacheSummary(entries)}>
    {#each entries as entry, i}
      {#if i > 0}
        <span class="text-xs pai-text-muted px-0.5 select-none" aria-hidden="true">→</span>
      {/if}
      <div
        class="rounded border px-1.5 py-0.5 text-xs flex flex-row items-center gap-1 whitespace-nowrap"
        class:pai-banner-success={entry.cached || entry.reused}
        class:pai-banner-warning={!entry.cached && !entry.reused}>
        <span class="font-medium text-[var(--pd-content-text)]">{entry.layer}</span>
        <span>{layerCacheOutcomeLabel(entry)}</span>
      </div>
    {/each}
  </div>
{/if}
