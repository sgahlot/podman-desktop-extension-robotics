<script lang="ts">
export let value: 'sidebar' | 'tabs' | 'cards';
export let onSelect: (next: 'sidebar' | 'tabs' | 'cards') => void;
export let compact = false;

const OPTIONS: Array<{ value: 'sidebar' | 'tabs' | 'cards'; label: string }> = [
  { value: 'sidebar', label: 'Sidebar' },
  { value: 'tabs', label: 'Tabs' },
  { value: 'cards', label: 'Cards' },
];
</script>

<div class="flex {compact ? 'flex-col' : 'flex-row'} gap-1.5" role="radiogroup" aria-label="Navigation layout">
  {#each OPTIONS as opt (opt.value)}
    <button
      type="button"
      role="radio"
      aria-checked={value === opt.value}
      on:click={() => onSelect(opt.value)}
      class="px-2.5 py-1 text-xs rounded border cursor-pointer transition-colors {value === opt.value
        ? 'border-[var(--pd-content-header)] bg-[var(--pd-content-bg)] font-medium text-[var(--pd-content-header)]'
        : 'border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]'}">
      {opt.label}
    </button>
  {/each}
</div>
