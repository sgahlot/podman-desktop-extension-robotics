<script lang="ts">
import { onMount } from 'svelte';
import { physicalAiClient } from '../api/client';
import type { CatalogRegistry } from '/@shared/src/types/ImageCatalog';

export let onSaved: ((registries: CatalogRegistry[]) => void) | undefined = undefined;
export let refreshToken = 0;
export let open = false;

let registryJson = '';
let registryJsonError = '';
let registryJsonSaved = false;
let savingRegistryJson = false;

function formatRegistryJson(raw: string): string {
  if (!raw.trim()) return '';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

async function load(): Promise<void> {
  registryJson = formatRegistryJson(await physicalAiClient.getCatalogRegistriesJson());
}

async function saveRegistryJson(): Promise<void> {
  savingRegistryJson = true;
  registryJsonError = '';
  registryJsonSaved = false;
  try {
    await physicalAiClient.setCatalogRegistriesJson(registryJson);
    registryJson = formatRegistryJson(await physicalAiClient.getCatalogRegistriesJson());
    const registries = await physicalAiClient.getCatalogRegistries();
    onSaved?.(registries);
    window.dispatchEvent(new CustomEvent('physical-ai-registries-updated'));
    registryJsonSaved = true;
  } catch (e) {
    registryJsonError = e instanceof Error ? e.message : 'Invalid catalog registry settings';
  } finally {
    savingRegistryJson = false;
  }
}

onMount(() => {
  void load().catch(e => {
    registryJsonError = e instanceof Error ? e.message : 'Invalid catalog registry settings';
  });
});

$: if (refreshToken > 0) {
  void load().catch(e => {
    registryJsonError = e instanceof Error ? e.message : 'Invalid catalog registry settings';
  });
}
</script>

<details
  open={open}
  class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-3">
  <summary class="cursor-pointer text-sm font-medium text-[var(--pd-content-header)]">Registry configuration</summary>
  <div class="flex flex-col gap-2 mt-3">
    <label for="registry-json" class="text-xs text-[var(--pd-content-text)]">
      Optional JSON array. Each registry id must be unique.
    </label>
    <textarea
      id="registry-json"
      aria-label="Catalog registries JSON"
      bind:value={registryJson}
      rows="8"
      spellcheck="false"
      class="px-3 py-2 text-sm font-mono rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-[var(--pd-content-text)] w-full resize-y"
      placeholder={'[\n  {\n    "id": "docker-hub",\n    "displayName": "Docker Hub",\n    "kind": "docker-hub",\n    "host": "docker.io",\n    "namespace": "library"\n  }\n]'}
    ></textarea>
    <div class="flex flex-row items-center gap-3">
      <button on:click={saveRegistryJson} disabled={savingRegistryJson} class="pai-btn pai-btn-primary">
        {savingRegistryJson ? 'Validating...' : 'Validate & Save'}
      </button>
      {#if registryJsonSaved}
        <span class="text-xs pai-text-success">Saved and applied.</span>
      {/if}
    </div>
    {#if registryJsonError}
      <div class="text-xs p-2 rounded pai-banner-error" role="alert">{registryJsonError}</div>
    {/if}
  </div>
</details>
