<script lang="ts">
import type { YamlTreeNode } from '/@shared/src/ros/topicPeek';

export let nodes: YamlTreeNode[] = [];
export let depth = 0;
</script>

<ul class="list-none m-0 p-0 {depth === 0 ? '' : 'pl-3 border-l border-[var(--pd-content-card-border)]'}">
  {#each nodes as node}
    <li class="py-0.5">
      {#if node.children && node.children.length > 0}
        <details open={depth < 2}>
          <summary class="cursor-pointer text-xs font-mono text-[var(--pd-content-header)] select-none">
            {node.key}
          </summary>
          <svelte:self nodes={node.children} depth={depth + 1} />
        </details>
      {:else}
        <div class="text-xs font-mono flex flex-wrap gap-x-2">
          <span class="text-[var(--pd-content-header)]">{node.key}</span>
          {#if node.value !== undefined}
            <span class="text-[var(--pd-content-text)] break-all">{node.value}</span>
          {/if}
        </div>
      {/if}
    </li>
  {/each}
</ul>
