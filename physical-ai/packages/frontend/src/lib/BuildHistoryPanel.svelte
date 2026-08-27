<script lang="ts">
import { physicalAiClient } from '../api/client';
import { onMount, onDestroy } from 'svelte';
import type { BuildHistoryEntry } from '/@shared/src/types/BuildHistory';

/** Poll cadence for picking up history written by a build that finished in the
 * background (fire-and-forget on the backend) — overridable for tests. */
export let pollIntervalMs = 3000;

let history: BuildHistoryEntry[] = [];
let sbomExpanded: Record<number, boolean> = {};
let pollTimer: number | null = null;

export async function refresh(): Promise<void> {
  try {
    history = await physicalAiClient.getBuildHistory();
  } catch {
    // keep the last-known list on a transient fetch error
  }
}

function toggleSbom(index: number): void {
  sbomExpanded = { ...sbomExpanded, [index]: !sbomExpanded[index] };
}

/** Package count from an SPDX-JSON SBOM, or undefined if the shape doesn't match. */
function packageCount(sbom: string): number | undefined {
  try {
    const parsed = JSON.parse(sbom) as { packages?: unknown[] };
    return Array.isArray(parsed.packages) ? parsed.packages.length : undefined;
  } catch {
    return undefined;
  }
}

async function copySbom(sbom: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(sbom);
  } catch {
    // best-effort — clipboard may be unavailable in some hosts
  }
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

onMount(() => {
  void refresh();
  pollTimer = window.setInterval(() => {
    void refresh();
  }, pollIntervalMs);
});

onDestroy(() => {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
});
</script>

<div class="flex flex-col gap-2">
  <h3 class="text-sm font-medium text-[var(--pd-content-header)]">Recent Builds</h3>
  {#if history.length === 0}
    <p class="text-xs pai-text-muted">No builds recorded yet.</p>
  {:else}
    <div class="flex flex-col gap-2">
      {#each history as entry, i (`${entry.tag}-${entry.startedAt}`)}
        {@const pkgCount = entry.sbom ? packageCount(entry.sbom) : undefined}
        <div
          class="rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-3 flex flex-col gap-1">
          <div class="flex flex-row items-center gap-2 flex-wrap">
            <span class="text-xs" aria-label={entry.success ? 'Build succeeded' : 'Build failed'}>
              {entry.success ? '✅' : '❌'}
            </span>
            <span class="text-xs font-mono">{entry.tag}</span>
            <span class="text-xs pai-text-muted">({entry.arch})</span>
            <span class="text-xs pai-text-muted">{formatTimestamp(entry.startedAt)}</span>
            <span class="text-xs pai-text-muted">{formatDuration(entry.durationMs)}</span>
          </div>
          {#if !entry.success && entry.errorMessage}
            <span class="text-xs pai-text-error" title={entry.errorMessage}>{entry.errorMessage}</span>
          {/if}
          {#if entry.sbom}
            <div class="flex flex-col gap-1">
              <div class="flex flex-row items-center gap-2">
                <button type="button" class="pai-btn pai-btn-sm self-start" on:click={() => toggleSbom(i)}>
                  {sbomExpanded[i] ? '▼' : '▶'} SBOM{pkgCount !== undefined ? ` (${pkgCount} packages)` : ''}
                </button>
                <button type="button" class="pai-btn pai-btn-sm" on:click={() => copySbom(entry.sbom ?? '')}>
                  Copy to clipboard
                </button>
              </div>
              {#if sbomExpanded[i]}
                <div
                  class="rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] font-mono text-xs text-[var(--pd-content-text)]"
                  style="max-height: 300px; overflow-y: auto; padding: 8px; white-space: pre-wrap; word-break: break-all;">
                  {entry.sbom}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
