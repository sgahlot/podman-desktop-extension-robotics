<script lang="ts">
import RegistryConfiguration from './lib/RegistryConfiguration.svelte';
</script>

<div class="flex flex-col p-4 gap-4 h-full overflow-auto">
  <h1 class="text-3xl text-[var(--pd-content-header)]">Registry Settings</h1>
  <p class="text-sm text-[var(--pd-content-text)]">
    Configure the registries used by Image Catalog pulls and Image Builder pushes. Registry credentials are managed
    separately in Podman Desktop &rarr; Settings &rarr; Registries.
  </p>
  <RegistryConfiguration open={true} />
</div>
