<script lang="ts">
import { physicalAiClient } from '../api/client';
import { onMount, onDestroy } from 'svelte';
import type { BuildHistoryEntry } from '/@shared/src/types/BuildHistory';
import type { HardenedApp } from '/@shared/src/types/layerCompatibility';
import {
  bundledToolVerificationFor,
  parseSbomPackageCount,
  sbomItemLabel,
  verifiableBundledTools,
} from '/@shared/src/types/BuildHistory';
import { bundledToolSmokeCheckLabel } from '/@shared/src/build/bundledToolSmokeCheck';
import LayerCacheCake from './LayerCacheCake.svelte';
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
/** Entry key while refreshAfterBuild(true) is polling for an async Syft SBOM attach. */
let sbomWatchingKey: string | null = null;
/** Client-side message when the watch window elapses without sbomFormat or sbomErrorMessage. */
let sbomWatchTimedOut: Record<string, string> = {};

const SBOM_GENERATING_MESSAGE =
  'Generating SBOM (Syft scan of the saved image)… Large images can take several minutes.';
const SBOM_WATCH_TIMEOUT_MESSAGE =
  'SBOM is not ready yet. The image built successfully — wait a bit and refresh this page, or rebuild with Syft selected to try again.';

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
let verifyCopyFeedback: Record<string, string> = {};
/** Whole "Bundled apps" block per build row — collapsed by default (like SBOM). */
let bundledAppsSectionExpanded: Record<string, boolean> = {};
/** Per-tool command output inside an expanded Bundled apps section. */
let bundledCheckExpanded: Record<string, boolean> = {};
let bundledAppsBatchRunning: Record<string, boolean> = {};
let bundledAppRunning: Record<string, boolean> = {};

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
export async function refreshAfterBuild(watchForSbom = false, expectedTag?: string): Promise<void> {
  const settleDeadline = Date.now() + 10_000;
  while (Date.now() < settleDeadline) {
    await refresh();
    if (!expectedTag || history.some(entry => entry.tag === expectedTag)) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!watchForSbom) return;

  const newest =
    (expectedTag ? history.find(entry => entry.tag === expectedTag) : undefined) ?? history[0];
  if (!newest?.success) return;

  const watchKey = entryKey(newest);
  sbomWatchingKey = watchKey;
  sbomWatchTimedOut = { ...sbomWatchTimedOut, [watchKey]: '' };

  const deadline = Date.now() + sbomWatchDurationMs;
  while (!destroyed) {
    const entry = history.find(e => entryKey(e) === watchKey);
    if (!entry) break;
    if (entry.sbomFormat || entry.sbomErrorMessage) break;
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, sbomWatchIntervalMs));
    if (destroyed) return;
    await refresh();
  }

  sbomWatchingKey = null;
  const final = history.find(e => entryKey(e) === watchKey);
  if (final && !final.sbomFormat && !final.sbomErrorMessage) {
    sbomWatchTimedOut = { ...sbomWatchTimedOut, [watchKey]: SBOM_WATCH_TIMEOUT_MESSAGE };
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

function formatVerificationOutput(output: string): string {
  try {
    return JSON.stringify(JSON.parse(output), null, 2);
  } catch {
    return output;
  }
}

function verifyRunningKey(key: string, tool: HardenedApp): string {
  return `${key}:${tool}`;
}

function formattedVerificationOutput(output: string): string {
  return formatVerificationOutput(output);
}

function toggleBundledCheck(runKey: string): void {
  bundledCheckExpanded = { ...bundledCheckExpanded, [runKey]: !bundledCheckExpanded[runKey] };
}

function bundledAppOutputToggleLabel(expanded: boolean): string {
  return expanded ? '▼ Output' : '▶ Output';
}

function bundledAppStatusKind(saved: ReturnType<typeof bundledToolVerificationFor>): 'unchecked' | 'passed' | 'failed' {
  if (!saved) return 'unchecked';
  return saved.success ? 'passed' : 'failed';
}

function bundledAppsAllVerified(entry: BuildHistoryEntry, tools: HardenedApp[]): boolean {
  if (tools.length === 0) return false;
  return tools.every(tool => bundledToolVerificationFor(entry, tool)?.success);
}

function bundledAppVerifyDisabled(key: string, runKey: string): boolean {
  return !!bundledAppsBatchRunning[key] || !!bundledAppRunning[runKey];
}

function bundledAppsSectionTitleSuffix(entry: BuildHistoryEntry, tools: HardenedApp[]): string {
  let verified = 0;
  let failed = 0;
  for (const tool of tools) {
    const v = bundledToolVerificationFor(entry, tool);
    if (!v) continue;
    if (v.success) verified++;
    else failed++;
  }
  if (failed > 0) return ` (${failed} failed)`;
  if (verified > 0 && verified === tools.length) return '';
  if (verified > 0) return ` (${verified}/${tools.length} verified)`;
  return '';
}

function toggleBundledAppsSection(key: string, entry: BuildHistoryEntry, tools: HardenedApp[]): void {
  const wasExpanded = !!bundledAppsSectionExpanded[key];
  bundledAppsSectionExpanded = { ...bundledAppsSectionExpanded, [key]: !wasExpanded };
  if (!wasExpanded && tools.length === 1) {
    const saved = bundledToolVerificationFor(entry, tools[0]);
    if (saved) {
      const runKey = verifyRunningKey(key, tools[0]);
      bundledCheckExpanded = { ...bundledCheckExpanded, [runKey]: true };
    }
  }
}

function expandSingleBundledAppOutputIfNeeded(key: string, tools: HardenedApp[]): void {
  if (tools.length !== 1) return;
  bundledCheckExpanded = { ...bundledCheckExpanded, [verifyRunningKey(key, tools[0])]: true };
}

async function runSingleBundledAppCheck(
  entry: BuildHistoryEntry,
  key: string,
  tool: HardenedApp,
  tools: HardenedApp[],
): Promise<void> {
  const runKey = verifyRunningKey(key, tool);
  bundledAppRunning = { ...bundledAppRunning, [runKey]: true };
  try {
    await physicalAiClient.verifyBundledTool(entry.tag, entry.startedAt, tool);
    await refresh();
    bundledCheckExpanded = { ...bundledCheckExpanded, [runKey]: true };
    if (tools.length === 1) {
      expandSingleBundledAppOutputIfNeeded(key, tools);
    }
  } finally {
    bundledAppRunning = { ...bundledAppRunning, [runKey]: false };
  }
}

async function runAllBundledAppChecks(entry: BuildHistoryEntry, key: string, tools: HardenedApp[]): Promise<void> {
  bundledAppsBatchRunning = { ...bundledAppsBatchRunning, [key]: true };
  try {
    for (const tool of tools) {
      await physicalAiClient.verifyBundledTool(entry.tag, entry.startedAt, tool);
    }
    await refresh();
    expandSingleBundledAppOutputIfNeeded(key, tools);
  } finally {
    bundledAppsBatchRunning = { ...bundledAppsBatchRunning, [key]: false };
  }
}

async function copyVerification(key: string, tool: HardenedApp, output: string): Promise<void> {
  const copyKey = verifyRunningKey(key, tool);
  try {
    await physicalAiClient.copyToClipboard(output);
    verifyCopyFeedback = { ...verifyCopyFeedback, [copyKey]: 'Copied' };
    setTimeout(() => {
      verifyCopyFeedback = { ...verifyCopyFeedback, [copyKey]: '' };
    }, 1500);
  } catch {
    verifyCopyFeedback = { ...verifyCopyFeedback, [copyKey]: 'Copy failed' };
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
            <LayerCacheCake entries={entry.layerCacheStatus} />
          {/if}
          {#if entry.success && !entry.sbomFormat && sbomWatchingKey === key}
            <p class="text-xs pai-text-muted" role="status">{SBOM_GENERATING_MESSAGE}</p>
          {:else if entry.sbomErrorMessage}
            <p class="text-xs pai-text-error" role="status">
              <span class="font-medium">SBOM scan failed:</span>
              {entry.sbomErrorMessage}
            </p>
          {:else if sbomWatchTimedOut[key] && !entry.sbomFormat}
            <p class="text-xs pai-text-muted" role="status">{sbomWatchTimedOut[key]}</p>
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
          {#if entry.success && entry.isFinalArtifact && verifiableBundledTools(entry).length}
            {@const bundledApps = verifiableBundledTools(entry)}
            {@const bundledAppsSuffix = bundledAppsSectionTitleSuffix(entry, bundledApps)}
            {@const bundledAppsAllPass = bundledAppsAllVerified(entry, bundledApps)}
            <div class="flex flex-col gap-1">
              <button
                type="button"
                class="pai-btn pai-btn-sm self-start inline-flex items-center gap-1"
                aria-expanded={bundledAppsSectionExpanded[key] ? 'true' : 'false'}
                on:click={() => toggleBundledAppsSection(key, entry, bundledApps)}>
                <span>{bundledAppsSectionExpanded[key] ? '▼' : '▶'} Bundled apps{bundledAppsSuffix}</span>
                {#if bundledAppsAllPass}
                  <span class="pai-text-success" aria-label="All bundled apps verified">✓</span>
                {/if}
              </button>
              {#if bundledAppsSectionExpanded[key]}
                <div class="flex flex-col gap-2 pl-1 border-l-2 border-[var(--pd-content-card-border)]">
                  {#if bundledApps.length > 1}
                    <div class="flex flex-col gap-1">
                      <button
                        type="button"
                        class="pai-btn pai-btn-sm self-start"
                        title="Runs each baked-in CLI inside the image (not OCI signature verification)"
                        on:click={() => runAllBundledAppChecks(entry, key, bundledApps)}
                        disabled={bundledAppsBatchRunning[key]}>
                        {bundledAppsBatchRunning[key] ? 'Verifying all…' : 'Verify all bundled apps'}
                      </button>
                    </div>
                  {/if}
                  <ul class="flex flex-col gap-2 list-none m-0 p-0">
                    {#each bundledApps as tool (tool)}
                      {@const toolLabel = bundledToolSmokeCheckLabel(tool)}
                      {@const saved = bundledToolVerificationFor(entry, tool)}
                      {@const runKey = verifyRunningKey(key, tool)}
                      {@const statusKind = bundledAppStatusKind(saved)}
                      <li class="flex flex-col gap-1">
                        <div class="flex flex-row items-center gap-2 flex-wrap">
                          <span class="text-xs font-medium text-[var(--pd-content-header)] min-w-[4.5rem]"
                            >{toolLabel}</span>
                          {#if statusKind === 'passed'}
                            <span class="text-xs min-w-[5.5rem] pai-text-success">✓ Passed</span>
                          {:else if statusKind === 'failed'}
                            <span class="text-xs min-w-[5.5rem] pai-text-error">Failed</span>
                          {:else}
                            <span class="text-xs min-w-[5.5rem] pai-text-muted">Not checked</span>
                          {/if}
                          <button
                            type="button"
                            class="pai-btn pai-btn-sm"
                            aria-label="Verify {toolLabel}"
                            title="Run this CLI inside the image (not OCI signature verification)"
                            disabled={bundledAppVerifyDisabled(key, runKey)}
                            on:click={() => runSingleBundledAppCheck(entry, key, tool, bundledApps)}>
                            {bundledAppRunning[runKey]
                              ? 'Verifying…'
                              : saved
                                ? 'Re-verify'
                                : 'Verify'}
                          </button>
                          {#if saved}
                            <button
                              type="button"
                              class="pai-btn pai-btn-sm"
                              aria-expanded={bundledCheckExpanded[runKey] ? 'true' : 'false'}
                              on:click={() => toggleBundledCheck(runKey)}>
                              {bundledAppOutputToggleLabel(!!bundledCheckExpanded[runKey])}
                            </button>
                            {#if saved.success && saved.output}
                              <button
                                type="button"
                                class="pai-btn pai-btn-sm"
                                on:click={() =>
                                  copyVerification(key, tool, formattedVerificationOutput(saved.output!))}>
                                {verifyCopyFeedback[runKey] || 'Copy output'}
                              </button>
                            {/if}
                          {/if}
                        </div>
                        {#if saved && bundledCheckExpanded[runKey]}
                          {#if !saved.success && saved.errorMessage}
                            <div class="text-xs p-2 rounded pai-banner-error">
                              <span class="font-medium">{toolLabel}:</span>
                              {saved.errorMessage}
                            </div>
                          {:else if saved.success && saved.output}
                            <pre
                              class="rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] font-mono text-xs text-[var(--pd-content-text)]"
                              style="max-height: 300px; overflow: auto; padding: 8px; white-space: pre-wrap; word-break: break-all;">{formattedVerificationOutput(
                                saved.output,
                              )}</pre>
                          {/if}
                        {/if}
                      </li>
                    {/each}
                  </ul>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
