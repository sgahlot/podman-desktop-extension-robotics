<script lang="ts">
import RegistryConfiguration from './lib/RegistryConfiguration.svelte';
import QuickLinks from './lib/QuickLinks.svelte';
import { navigationLayout } from './lib/navigationLayout';
import { router } from 'tinro';
</script>

<div class="flex flex-col p-4 gap-4 h-full overflow-auto">
  {#if $navigationLayout === 'cards'}
    <button on:click={() => router.goto('/')} class="pai-link self-start"> &larr; Back to Dashboard </button>
  {/if}
  <h1 class="text-3xl text-[var(--pd-content-header)]">Registry Settings</h1>
  {#if $navigationLayout === 'cards'}
    <QuickLinks
      links={[
        { label: 'Image Catalog', to: '/images' },
        { label: 'Image Builder', to: '/build' },
      ]} />
  {/if}
  <p class="text-sm text-[var(--pd-content-text)]">
    Configure the registries used by Image Catalog pulls and Image Builder pushes. Registry credentials are managed
    separately in Podman Desktop &rarr; Settings &rarr; Registries.
  </p>
  <RegistryConfiguration open={true} />
</div>
