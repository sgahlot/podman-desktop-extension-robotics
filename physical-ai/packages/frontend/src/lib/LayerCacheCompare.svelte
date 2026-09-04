<script lang="ts">
import type { LayerCacheStatusEntry } from '/@shared/src/types/BuildHistory';
import { formatLayerCacheSummary } from '/@shared/src/types/buildLayerCache';
import LayerCacheCake from './LayerCacheCake.svelte';

/** Side-by-side Option A (text) vs Option B (layer cake) for APPENG-6298 UI pick. */
export let entries: LayerCacheStatusEntry[] = [];
</script>

{#if entries.length > 0}
  <div class="flex flex-col gap-2 rounded border border-dashed border-[var(--pd-content-card-border)] p-2">
    <span class="text-xs font-medium text-[var(--pd-content-text)]">Layer cache — compare UI options</span>
    <div class="flex flex-col gap-1">
      <span class="text-xs pai-text-muted">Option A — summary line</span>
      <div class="text-xs text-[var(--pd-content-text)]">{formatLayerCacheSummary(entries)}</div>
    </div>
    <div class="flex flex-col gap-1">
      <span class="text-xs pai-text-muted">Option B — layer cake</span>
      <LayerCacheCake {entries} />
    </div>
  </div>
{/if}
