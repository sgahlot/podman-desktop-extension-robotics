<script lang="ts">
import { physicalAiClient } from '../api/client';
import { onMount, onDestroy } from 'svelte';
import type { BuildHistoryEntry } from '/@shared/src/types/BuildHistory';
import { formatDurationSeconds } from './formatDuration';

/** Poll cadence for picking up history written by a build that finished in the
 * background (fire-and-forget on the backend) — overridable for tests. */
export let pollIntervalMs = 3000;

let history: BuildHistoryEntry[] = [];
let pollTimer: number | null = null;

/**
 * Per-build UI/derived state, keyed by the same stable `${tag}-${startedAt}` string used
 * as the {#each} key — NOT array index. History is re-fetched wholesale on every poll, so
 * a new build prepended to the list would shift every later entry's index; keying expand/
 * format state by index would silently show the wrong entry's SBOM after a poll tick.
 */
let sbomExpanded: Record<string, boolean> = {};
let sbomFormatting: Record<string, boolean> = {};
/** Pretty-printed (indented) SBOM text, computed once per build and cached — an SBOM can
 * be several thousand packages, so re-parsing/re-formatting it on every 3s poll tick (the
 * naive approach) would waste real CPU even while collapsed, and redoing it on every
 * expand/collapse toggle is what made expanding feel slow. */
let sbomFormatted: Record<string, string> = {};
let packageCounts: Record<string, number | undefined> = {};
/** Transient "Copied"/"Copy failed" feedback per build, since the copy can genuinely fail
 * (e.g. a payload over the clipboard RPC's size cap) and silently doing nothing on failure
 * is indistinguishable from the button just not working. */
let copyFeedback: Record<string, string> = {};
/** Full error message for the last failed copy, shown as a tooltip on the button — the
 * button label itself just says "Copy failed", which isn't enough to diagnose why. */
let copyError: Record<string, string> = {};

function entryKey(entry: BuildHistoryEntry): string {
  return `${entry.tag}-${entry.startedAt}`;
}

export async function refresh(): Promise<void> {
  try {
    history = await physicalAiClient.getBuildHistory();
  } catch {
    // keep the last-known list on a transient fetch error
  }
}

/**
 * Item count from an SBOM, or undefined if the shape doesn't match. SPDX uses a
 * `packages` array; CycloneDX uses `components` — check by declared format first
 * (entries recorded before `sbomFormat` existed are always SPDX), falling back to
 * whichever array is actually present if the format is missing/unexpected.
 */
function parsePackageCount(sbom: string, format: BuildHistoryEntry['sbomFormat']): number | undefined {
  try {
    const parsed = JSON.parse(sbom) as { packages?: unknown[]; components?: unknown[] };
    const arr = format === 'cyclonedx-json' ? parsed.components : (parsed.packages ?? parsed.components);
    return Array.isArray(arr) ? arr.length : undefined;
  } catch {
    return undefined;
  }
}

/** "packages" for SPDX, "components" for CycloneDX — matches each format's own terminology. */
function itemLabel(format: BuildHistoryEntry['sbomFormat']): string {
  return format === 'cyclonedx-json' ? 'components' : 'packages';
}

// Compute the item count once per build the first time it's seen, not on every poll —
// cheap for a small SBOM, but a large one (thousands of items) parsed every 3s adds up.
$: for (const entry of history) {
  if (entry.sbom) {
    const key = entryKey(entry);
    if (!(key in packageCounts)) {
      packageCounts = { ...packageCounts, [key]: parsePackageCount(entry.sbom, entry.sbomFormat) };
    }
  }
}

function toggleSbom(entry: BuildHistoryEntry): void {
  const key = entryKey(entry);
  const wasExpanded = !!sbomExpanded[key];
  sbomExpanded = { ...sbomExpanded, [key]: !wasExpanded };
  if (wasExpanded || key in sbomFormatted || !entry.sbom) {
    return;
  }
  // Defer the actual (synchronous, potentially slow for a large SBOM) pretty-print past
  // this click's render so the "Formatting..." placeholder paints first instead of the
  // click appearing to hang.
  sbomFormatting = { ...sbomFormatting, [key]: true };
  const sbom = entry.sbom;
  setTimeout(() => {
    let pretty = sbom;
    try {
      pretty = JSON.stringify(JSON.parse(sbom), null, 2);
    } catch {
      // not JSON (or an unexpected shape) — show the raw text as-is
    }
    sbomFormatted = { ...sbomFormatted, [key]: pretty };
    sbomFormatting = { ...sbomFormatting, [key]: false };
  }, 0);
}

async function copySbom(entry: BuildHistoryEntry): Promise<void> {
  const key = entryKey(entry);
  // Clear any stale error from a previous attempt right away, so a retry doesn't leave
  // old and new feedback both on screen momentarily.
  copyError = { ...copyError, [key]: '' };
  // The extension's own clipboard RPC (extensionApi.env.clipboard), not
  // navigator.clipboard.writeText — the latter silently no-ops in this webview (no
  // clipboard permission granted to the sandboxed frame), which is why "Copy to
  // clipboard" previously did nothing with zero feedback.
  try {
    await physicalAiClient.copyToClipboard(entry.sbom ?? '');
    copyFeedback = { ...copyFeedback, [key]: 'Copied' };
    setTimeout(() => {
      copyFeedback = { ...copyFeedback, [key]: '' };
    }, 1500);
  } catch (err) {
    copyFeedback = { ...copyFeedback, [key]: 'Copy failed' };
    // Shown inline (not just as a hover tooltip — those have a built-in OS/browser hover
    // delay that made this hard to actually read) and left up until the user retries via
    // the button again, rather than auto-clearing on a timer like the success case.
    copyError = { ...copyError, [key]: err instanceof Error ? err.message : String(err) };
  }
}

function formatDuration(ms: number): string {
  return formatDurationSeconds(ms / 1000);
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
      {#each history as entry (entryKey(entry))}
        {@const key = entryKey(entry)}
        {@const pkgCount = packageCounts[key]}
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
              <div class="flex flex-row items-center gap-2 flex-wrap">
                <button type="button" class="pai-btn pai-btn-sm self-start" on:click={() => toggleSbom(entry)}>
                  {sbomExpanded[key] ? '▼' : '▶'} SBOM{pkgCount !== undefined
                    ? ` (${pkgCount} ${itemLabel(entry.sbomFormat)})`
                    : ''}
                </button>
                <button type="button" class="pai-btn pai-btn-sm" on:click={() => copySbom(entry)}>
                  {copyFeedback[key] || 'Copy to clipboard'}
                </button>
                {#if copyError[key]}
                  <span class="text-xs pai-text-error">{copyError[key]}</span>
                {/if}
              </div>
              {#if sbomExpanded[key]}
                {#if sbomFormatting[key]}
                  <p class="text-xs pai-text-muted p-2">
                    Formatting SBOM… large SBOMs (thousands of packages) can take a moment.
                  </p>
                {:else}
                  <div
                    class="rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] font-mono text-xs text-[var(--pd-content-text)]"
                    style="max-height: 300px; overflow: auto; padding: 8px; white-space: pre;">
                    {sbomFormatted[key] ?? entry.sbom}
                  </div>
                {/if}
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
