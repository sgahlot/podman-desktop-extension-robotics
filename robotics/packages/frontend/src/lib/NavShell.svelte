<script lang="ts">
import { router } from 'tinro';
import LayoutSwitcher from './LayoutSwitcher.svelte';
import { NAV_ITEMS } from './navItems';

export let layout: 'sidebar' | 'tabs' | 'cards';
export let onLayoutChange: (next: 'sidebar' | 'tabs' | 'cards') => void;

// Reactive active-route detection — same pattern as Simulation.svelte:7 ($router.path).
$: activePath = $router.path;

// `activePath` is passed in explicitly so Svelte tracks it as a dependency of the
// class/aria expressions below; reading it from the closure would make the highlight
// stale (it would only recompute when `to` changes, which never happens).
function isActive(to: string, path: string): boolean {
  return to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`);
}

function goto(to: string): void {
  router.goto(to);
}
</script>

<div class="flex flex-col flex-1 min-h-0 overflow-hidden">
  {#if layout === 'tabs'}
    <div
      class="flex flex-row items-center justify-between gap-2 border-b border-[var(--pd-content-card-border)] px-2 shrink-0">
      <div class="flex flex-row gap-1 overflow-x-auto" role="tablist" aria-label="Primary navigation">
        {#each NAV_ITEMS as item (item.label)}
          {#if item.to}
            {@const to = item.to}
            <button
              role="tab"
              aria-selected={isActive(to, activePath)}
              on:click={() => goto(to)}
              class="px-4 py-2 text-sm pai-tab {isActive(to, activePath) ? 'pai-tab-active' : ''}">
              {item.label}
            </button>
          {:else}
            <button
              type="button"
              role="tab"
              aria-selected="false"
              aria-disabled="true"
              disabled
              title={item.tooltip}
              class="px-4 py-2 text-sm pai-tab pai-nav-item-disabled">
              {item.label}
            </button>
          {/if}
        {/each}
      </div>
      <div class="shrink-0 pr-1">
        <LayoutSwitcher value={layout} onSelect={onLayoutChange} />
      </div>
    </div>
  {/if}

  <div class="flex flex-row flex-1 min-h-0 overflow-hidden">
    {#if layout === 'sidebar'}
      <aside
        class="flex flex-col w-48 shrink-0 h-full border-r border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] overflow-hidden">
        <nav class="flex flex-col gap-1 p-2 flex-1 overflow-auto" aria-label="Primary navigation">
          {#each NAV_ITEMS as item (item.label)}
            {#if item.to}
              {@const to = item.to}
              <button
                on:click={() => goto(to)}
                aria-current={isActive(to, activePath) ? 'page' : undefined}
                class="pai-nav-item {isActive(to, activePath) ? 'pai-nav-item-active' : ''}">
                {item.label}
              </button>
            {:else}
              <div class="pai-nav-item pai-nav-item-disabled" title={item.tooltip} aria-disabled="true">
                {item.label}
                <span class="block text-xs pai-text-muted">Coming soon</span>
              </div>
            {/if}
          {/each}
        </nav>
        <div class="p-2 border-t border-[var(--pd-content-card-border)] shrink-0">
          <span class="text-xs pai-text-muted block mb-1">Layout</span>
          <LayoutSwitcher value={layout} onSelect={onLayoutChange} compact />
        </div>
      </aside>
    {/if}

    <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
      <slot />
    </div>
  </div>
</div>
