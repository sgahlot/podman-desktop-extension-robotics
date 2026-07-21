<script lang="ts">
import './app.css';
import { router } from 'tinro';
import Route from './lib/Route.svelte';
import { onMount } from 'svelte';
import { getRouterState } from './api/client';
import Dashboard from './Dashboard.svelte';
import ImageCatalog from './ImageCatalog.svelte';
import Help from './Help.svelte';
import BuildBaseImage from './BuildBaseImage.svelte';

router.mode.hash();

let isMounted = false;
onMount(() => {
  const state = getRouterState();
  router.goto(state.url);
  isMounted = true;
});
</script>

<Route path="/*" breadcrumb="Physical AI" isAppMounted={isMounted} let:meta>
  <main class="flex flex-col w-screen h-screen overflow-hidden bg-[var(--pd-content-bg)]">
    <div class="flex flex-row w-full h-full overflow-hidden">
      <Route path="/" breadcrumb="Dashboard">
        <Dashboard />
      </Route>
      <Route path="/images" breadcrumb="Image Catalog">
        <ImageCatalog />
      </Route>
      <Route path="/help" breadcrumb="Help">
        <Help />
      </Route>
      <Route path="/build" breadcrumb="Build & Push Base Image">
        <BuildBaseImage />
      </Route>
    </div>
  </main>
</Route>
