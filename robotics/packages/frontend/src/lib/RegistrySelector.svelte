<script lang="ts">
import { onDestroy, onMount } from 'svelte';
import { physicalAiClient } from '../api/client';
import type { CatalogRegistry } from '/@shared/src/types/ImageCatalog';

export let selectedRegistry: CatalogRegistry | undefined = undefined;
export let disabled = false;

let registries: CatalogRegistry[] = [];

async function loadRegistries(): Promise<void> {
  try {
    registries = await physicalAiClient.getCatalogRegistries();
    const selectedId = selectedRegistry?.id;
    selectedRegistry = registries.find(registry => registry.id === selectedId) ?? registries[0];
  } catch {
    registries = [];
    selectedRegistry = undefined;
  }
}

onMount(() => {
  void loadRegistries();
  window.addEventListener('physical-ai-registries-updated', loadRegistries);
});

onDestroy(() => {
  window.removeEventListener('physical-ai-registries-updated', loadRegistries);
});
</script>

{#if registries.length > 0}
  <div class="w-full max-w-2xl rounded-lg border border-[var(--pai-accent)] bg-[var(--pd-content-card-bg)] p-3">
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <label for="image-builder-registry" class="text-sm font-semibold text-[var(--pd-content-header)] shrink-0"
        >Registry</label>
      <select
        id="image-builder-registry"
        aria-label="Push registry for this tab"
        value={selectedRegistry?.id ?? ''}
        disabled={disabled}
        on:change={event => {
          selectedRegistry = registries.find(
            registry => registry.id === (event.currentTarget as HTMLSelectElement).value,
          );
        }}
        class="px-3 py-2 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] w-72">
        {#each registries as registry}
          <option value={registry.id}>{registry.displayName} ({registry.host}/{registry.namespace})</option>
        {/each}
      </select>
      <a href="#/registries" class="pai-link text-sm shrink-0">Manage registries in Registry Settings</a>
    </div>
  </div>
{/if}
