<script lang="ts">
import './app.css';
import { router } from 'tinro';
import Route from './lib/Route.svelte';
import NavShell from './lib/NavShell.svelte';
import { onMount } from 'svelte';
import { getRouterState, physicalAiClient } from './api/client';
import Dashboard from './Dashboard.svelte';
import ImageCatalog from './ImageCatalog.svelte';
import Help from './Help.svelte';
import ImageBuilder from './SimulationSetup.svelte';
import Simulation from './Simulation.svelte';
import TopicMonitor from './TopicMonitor.svelte';
import Diagnostics from './Diagnostics.svelte';
import { navigationLayout as navigationLayoutStore } from './lib/navigationLayout';

router.mode.hash();

let isMounted = false;
let navigationLayout: 'sidebar' | 'tabs' | 'cards' = 'sidebar';

function setNavigationLayout(next: 'sidebar' | 'tabs' | 'cards'): void {
  navigationLayout = next;
  navigationLayoutStore.set(next);
  void physicalAiClient.setNavigationLayout(next);
}

onMount(async () => {
  try {
    navigationLayout = await physicalAiClient.getNavigationLayout();
    navigationLayoutStore.set(navigationLayout);
  } catch {
    // default sidebar
  }
  const state = getRouterState();
  router.goto(state.url);
  isMounted = true;
});
</script>

<Route path="/*" breadcrumb="Physical AI" isAppMounted={isMounted} let:meta>
  <main class="flex flex-col w-screen h-screen overflow-hidden bg-[var(--pd-content-bg)]">
    <!-- min-h-0 lets the active page become the scroll container instead of growing past the viewport -->
    <NavShell layout={navigationLayout} onLayoutChange={setNavigationLayout}>
      <Route path="/" breadcrumb="Dashboard">
        <Dashboard layout={navigationLayout} onLayoutChange={setNavigationLayout} />
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
      <Route path="/diagnostics" breadcrumb="Diagnostics" let:meta>
        <Diagnostics query={meta.query} />
      </Route>
      <!-- Back-compat: the old standalone Deploy page is now the Simulation → OpenShift tab. -->
      <Route path="/deploy" redirect="/simulation/openshift" />
    </NavShell>
  </main>
</Route>
