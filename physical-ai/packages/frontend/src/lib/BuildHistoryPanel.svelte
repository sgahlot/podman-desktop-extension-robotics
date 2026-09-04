<script lang="ts">
import { physicalAiClient } from '../api/client';
import { onMount, onDestroy } from 'svelte';
import type { BuildHistoryEntry } from '/@shared/src/types/BuildHistory';
import { parseSbomPackageCount, sbomItemLabel } from '/@shared/src/types/BuildHistory';
import LayerCacheCompare from './LayerCacheCompare.svelte';
import { formatDurationSeconds } from './formatDuration';

/**
 * Interval/ceiling for the catch-up poll after a build that opted into SBOM generation
 * completes — `syft` runs asynchronously after the build itself is done (see
 * PhysicalAiApiImpl#recordBuildHistory), so a single refresh right at completion would
 * usually show the build but miss its SBOM. refreshAfterBuild stops as soon as the SBOM
 * shows up, so sbomWatchDurationMs is a worst-case ceiling, not a typical wait — but it
 * still needs real headroom: confirmed live on a real 2588-package robotics image that 60s
 * was NOT enough (syft was still running), so this defaults well above that. Overridable
 * for tests. There is no continuous background poll (APPENG-6265) — history only refreshes
 * on mount and when a caller reports a build finished via refreshAfterBuild.
 */
export let sbomWatchIntervalMs = 3000;
export let sbomWatchDurationMs = 5 * 60_000;

let history: BuildHistoryEntry[] = [];
let destroyed = false;

/**
 * Per-build UI/derived state, keyed by the same stable `${tag}-${startedAt}` string used
 * as the {#each} key — NOT array index. History is re-fetched wholesale on every refresh,
 * so a new build prepended to the list would shift every later entry's index; keying
 * expand/format state by index would silently show the wrong entry's SBOM after a refresh.
 */
let sbomExpanded: Record<string, boolean> = {};
/** Full SBOM text, fetched on demand the first time an entry is expanded (APPENG-6265) —
 * the polled `history` list never carries it, since it can run tens of MB and this panel
 * polls every few seconds regardless of whether anything is expanded. */
let sbomRaw: Record<string, string> = {};
/** True while the on-demand SBOM fetch itself is in flight (separate from sbomFormatting,
 * the local pretty-print step that runs after the fetch resolves). */
let sbomFetching: Record<string, boolean> = {};
let sbomFetchError: Record<string, string> = {};
let sbomFormatting: Record<string, boolean> = {};
/** Pretty-printed (indented) SBOM text, computed once per build and cached — an SBOM can
 * be several thousand packages, so re-parsing/re-formatting it on every expand/collapse
 * toggle is what made expanding feel slow. */
let sbomFormatted: Record<string, string> = {};
/** Fallback package/component count for entries recorded before `sbomPackageCount` existed
 * server-side — parsed client-side from the on-demand fetch once, not from the poll. */
let fallbackPackageCounts: Record<string, number | undefined> = {};
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
 * Called by a parent when one of its own build panels just finished — refreshes once
 * immediately, then (only when `watchForSbom` is true) keeps refreshing on an interval
 * until either the just-completed build's SBOM shows up or `sbomWatchDurationMs` elapses,
 * whichever comes first. The newest entry (history[0]) is treated as "the build that just
 * completed" — a reasonable assumption since only one build can run at a time — so we stop
 * polling the moment ITS sbomFormat appears, rather than always waiting out the full
 * ceiling. If it never appears (a slow or failed syft run), the ceiling still bounds this
 * rather than polling indefinitely, matching the backend's own "best-effort, never blocks"
 * treatment of SBOM generation.
 */
export async function refreshAfterBuild(watchForSbom = false): Promise<void> {
  await refresh();
  if (!watchForSbom) return;

  const deadline = Date.now() + sbomWatchDurationMs;
  while (!destroyed && !history[0]?.sbomFormat && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, sbomWatchIntervalMs));
    if (destroyed) return;
    await refresh();
  }
}

/** Fetches one entry's full SBOM text on demand and caches it — shared by expand and copy,
 * so whichever happens first pays the fetch and the other reuses the cached text. */
async function fetchSbom(entry: BuildHistoryEntry, key: string): Promise<string | undefined> {
  if (key in sbomRaw) return sbomRaw[key];
  const sbom = await physicalAiClient.getBuildHistorySbom(entry.tag, entry.startedAt);
  if (sbom !== undefined) sbomRaw = { ...sbomRaw, [key]: sbom };
  return sbom;
}

async function toggleSbom(entry: BuildHistoryEntry): Promise<void> {
  const key = entryKey(entry);
  const wasExpanded = !!sbomExpanded[key];
  sbomExpanded = { ...sbomExpanded, [key]: !wasExpanded };
  if (wasExpanded || key in sbomFormatted) {
    return;
  }

  sbomFetching = { ...sbomFetching, [key]: true };
  sbomFetchError = { ...sbomFetchError, [key]: '' };
  let sbom: string | undefined;
  try {
    sbom = await fetchSbom(entry, key);
  } catch (err) {
    sbomFetching = { ...sbomFetching, [key]: false };
    sbomFetchError = { ...sbomFetchError, [key]: err instanceof Error ? err.message : String(err) };
    return;
  }
  sbomFetching = { ...sbomFetching, [key]: false };
  if (sbom === undefined) {
    sbomFetchError = { ...sbomFetchError, [key]: 'SBOM is no longer available' };
    return;
  }

  if (entry.sbomPackageCount === undefined && !(key in fallbackPackageCounts)) {
    fallbackPackageCounts = { ...fallbackPackageCounts, [key]: parseSbomPackageCount(sbom, entry.sbomFormat) };
  }

  // Defer the actual (synchronous, potentially slow for a large SBOM) pretty-print past
  // this click's render so the "Formatting..." placeholder paints first instead of the
  // click appearing to hang.
  sbomFormatting = { ...sbomFormatting, [key]: true };
  const fetched = sbom;
  setTimeout(() => {
    let pretty = fetched;
    try {
      pretty = JSON.stringify(JSON.parse(fetched), null, 2);
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
    const sbom = (await fetchSbom(entry, key)) ?? '';
    await physicalAiClient.copyToClipboard(sbom);
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
});

onDestroy(() => {
  destroyed = true;
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
        {@const pkgCount = entry.sbomPackageCount ?? fallbackPackageCounts[key]}
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
          {#if entry.layerCacheStatus?.length}
            <LayerCacheCompare entries={entry.layerCacheStatus} />
          {/if}
          {#if entry.sbomFormat}
            <div class="flex flex-col gap-1">
              <div class="flex flex-row items-center gap-2 flex-wrap">
                <button type="button" class="pai-btn pai-btn-sm self-start" on:click={() => toggleSbom(entry)}>
                  {sbomExpanded[key] ? '▼' : '▶'} SBOM{pkgCount !== undefined
                    ? ` (${pkgCount} ${sbomItemLabel(entry.sbomFormat)})`
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
                {#if sbomFetching[key]}
                  <p class="text-xs pai-text-muted p-2">Fetching SBOM…</p>
                {:else if sbomFetchError[key]}
                  <span class="text-xs pai-text-error">{sbomFetchError[key]}</span>
                {:else if sbomFormatting[key]}
                  <p class="text-xs pai-text-muted p-2">
                    Formatting SBOM… large SBOMs (thousands of packages) can take a moment.
                  </p>
                {:else}
                  <div
                    class="rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] font-mono text-xs text-[var(--pd-content-text)]"
                    style="max-height: 300px; overflow: auto; padding: 8px; white-space: pre;">
                    {sbomFormatted[key] ?? sbomRaw[key]}
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
