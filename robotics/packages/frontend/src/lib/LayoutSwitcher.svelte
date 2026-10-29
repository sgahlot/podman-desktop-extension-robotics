<script lang="ts">
export let value: 'sidebar' | 'tabs';
export let onSelect: (next: 'sidebar' | 'tabs') => void;
export let compact = false;

const OPTIONS: Array<{ value: 'sidebar' | 'tabs'; label: string }> = [
  { value: 'sidebar', label: 'Sidebar' },
  { value: 'tabs', label: 'Tabs' },
];
</script>

<div class="flex {compact ? 'flex-col' : 'flex-row'} gap-1.5" role="radiogroup" aria-label="Navigation layout">
  {#each OPTIONS as opt (opt.value)}
    <button
      type="button"
      role="radio"
      aria-checked={value === opt.value}
      on:click={() => onSelect(opt.value)}
      class="pai-choice px-2.5 py-1 text-xs rounded {value === opt.value ? 'pai-choice-active' : ''}">
      {opt.label}
    </button>
  {/each}
</div>
