<script lang="ts">
import './app.css';
import { router } from 'tinro';
import Route from './lib/Route.svelte';
import { onMount } from 'svelte';
import { getRouterState } from './api/client';
import Dashboard from './Dashboard.svelte';

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
    </div>
  </main>
</Route>
