<script lang="ts">
import { createRouteObject } from 'tinro/dist/tinro_lib';
import { router } from 'tinro';
import type { TinroRouteMeta } from 'tinro';
import { saveRouterState } from '../api/client';

export let path = '/*';
export let fallback = false;
export let redirect: boolean | string = false;
export let firstmatch = false;
export let breadcrumb: string | undefined = undefined;
export let isAppMounted: boolean = false;

let showContent = false;
// Keep a route's component tree alive after its first visit so switching pages does
// not discard in-progress work, viewer state, or form selections. Lazy mounting
// avoids starting every page's polling and initial API requests at app startup.
let hasShown = false;
let params: Record<string, string> = {};
let meta: TinroRouteMeta = {} as TinroRouteMeta;

function matchesPath(routePath: string, currentPath: string): boolean {
  if (routePath === '/*') return true;
  if (routePath.endsWith('/*')) {
    const basePath = routePath.slice(0, -2);
    return currentPath === basePath || currentPath.startsWith(`${basePath}/`);
  }
  return currentPath === routePath;
}

const route = createRouteObject({
  fallback,
  onShow() {
    showContent = true;
    hasShown = true;
  },
  onHide() {
    showContent = false;
  },
  onMeta(newMeta: TinroRouteMeta) {
    meta = newMeta;
    params = meta.params;
    if (isAppMounted) {
      saveRouterState({ url: newMeta.url });
    }
  },
});

$: route.update({
  path,
  redirect,
  firstmatch,
  breadcrumb,
});

$: routeVisible = showContent && matchesPath(path, $router.path);
</script>

{#if hasShown}
  <div
    class="flex flex-col flex-1 h-full min-h-0 min-w-0"
    style:display={routeVisible ? 'flex' : 'none'}
    aria-hidden={!routeVisible}>
    <slot params={params} meta={meta} active={routeVisible} />
  </div>
{/if}
