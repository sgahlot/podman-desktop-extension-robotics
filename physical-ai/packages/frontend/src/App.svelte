<script lang="ts">
import './app.css';
import { router } from 'tinro';
import Route from './lib/Route.svelte';
import { onMount } from 'svelte';
import { getRouterState } from './api/client';
import Dashboard from './Dashboard.svelte';
import ImageCatalog from './ImageCatalog.svelte';
import Help from './Help.svelte';
import ImageBuilder from './SimulationSetup.svelte';
import Simulation from './Simulation.svelte';
import TopicMonitor from './TopicMonitor.svelte';

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
    <!-- min-h-0 lets the active page become the scroll container instead of growing past the viewport -->
    <div class="flex flex-row w-full flex-1 min-h-0 overflow-hidden">
      <Route path="/" breadcrumb="Dashboard">
        <Dashboard />
      </Route>
      <Route path="/images" breadcrumb="Image Catalog">
        <ImageCatalog />
      </Route>
      <Route path="/help" breadcrumb="Help">
        <Help />
      </Route>
      <Route path="/build" breadcrumb="Image Builder">
        <ImageBuilder />
      </Route>
      <Route path="/simulation/*" breadcrumb="Simulation">
        <Simulation />
      </Route>
      <Route path="/topics" breadcrumb="Topic Monitor">
        <TopicMonitor />
      </Route>
      <!-- Back-compat: the old standalone Deploy page is now the Simulation → OpenShift tab. -->
      <Route path="/deploy" redirect="/simulation/openshift" />
    </div>
  </main>
</Route>
