<style>
@keyframes indeterminate {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(400%);
  }
}
.push-progress-bar {
  animation: indeterminate 1.5s ease-in-out infinite;
}
</style>

<script lang="ts">
import { physicalAiClient } from '../api/client';
import { onMount, onDestroy } from 'svelte';
import { formatDurationSeconds } from './formatDuration';

/** Called to start a build for the current tag (fire-and-forget; progress via polling). */
export let buildImage: (tag: string) => Promise<void>;
/** Image tag — bind from parent. Parent updates are adopted when idle (not building/pushing). */
export let tag = '';
export let tagPlaceholder = 'e.g. quay.io/org/image:latest';
export let tagInputId = 'image-tag';
/** True while a build or push is in progress — bind from parent to freeze wizard controls. */
export let busy = false;
/** Called when a build completes successfully (no error). */
export let onBuildComplete: (() => void) | undefined = undefined;
/** When true, the Build button is disabled (e.g. waiting for a prerequisite). */
export let disabled = false;

let inputValue = tag;
let lastSyncedTag = tag;

let imageExistsLocally = false;
/** null = not checked / N/A; true/false = Quay tag presence for quay.io refs */
let imageExistsInRegistry: boolean | null = null;
let registryCheckError = false;

let building = false;
let buildDone = false;
let buildError = '';
let buildCancelled = false;
let cancelling = false;
let currentStep = 0;
let totalSteps = 0;
let logs: string[] = [];
let buildStartedAt: number | undefined;
let buildFinishedAt: number | undefined;

let pushing = false;
let pushDone = false;
let pushError = '';
let pushCancelled = false;
let pushCancelling = false;
let pushStatus = 'Pushing...';
let pushDigest = '';
let pushStartedAt: number | undefined;
let pushFinishedAt: number | undefined;

let buildLogsExpanded = true;

let pollTimer: number | null = null;
let logContainer: HTMLDivElement;

/**
 * Recognizable signatures of a transient upstream package-mirror failure (apt fetch
 * 404s, "Unable to fetch some archives", DNS blips) rather than a real config/code
 * problem — surfaced as a distinct, non-error-colored hint so a mirror desync doesn't
 * read as "the extension/build is broken." Heuristic and apt-focused (the only package
 * manager these Containerfiles use today); a genuine miss here just means the user only
 * sees the raw error, not a regression.
 */
const TRANSIENT_MIRROR_PATTERNS = [
  /\b404\s+Not Found\b/i,
  /Failed to fetch/i,
  /Unable to fetch some archives/i,
  /Temporary failure in name resolution/i,
];
function looksLikeTransientMirrorFailure(buildLogs: string[]): boolean {
  return buildLogs.some(line => TRANSIENT_MIRROR_PATTERNS.some(re => re.test(line)));
}
$: transientMirrorIssue = !!buildError && looksLikeTransientMirrorFailure(logs);
/** Bumps on each image presence check so stale responses are ignored. */
let imageCheckGen = 0;

async function checkLocalImage(imageTag: string = inputValue) {
  if (!imageTag) {
    imageExistsLocally = false;
    imageExistsInRegistry = null;
    registryCheckError = false;
    return;
  }
  const gen = ++imageCheckGen;
  try {
    const localImages = await physicalAiClient.listLocalImages();
    if (gen !== imageCheckGen) return;
    imageExistsLocally = localImages.includes(imageTag);
  } catch {
    if (gen !== imageCheckGen) return;
    imageExistsLocally = false;
  }
  await checkRegistryImage(imageTag, gen);
}

/** Parse quay.io/ns/name:tag — other registries are not checked. */
function parseQuayRef(imageTag: string): { namespace: string; name: string; tag: string } | null {
  const match = imageTag.match(/^quay\.io\/([^/]+)\/([^:]+):(.+)$/);
  if (!match) return null;
  return { namespace: match[1], name: match[2], tag: match[3] };
}

async function checkRegistryImage(imageTag: string = inputValue, gen: number = imageCheckGen) {
  const ref = parseQuayRef(imageTag);
  if (!ref) {
    if (gen === imageCheckGen) {
      imageExistsInRegistry = null;
      registryCheckError = false;
    }
    return;
  }
  try {
    const tags = await physicalAiClient.getImageTags(ref.namespace, ref.name);
    if (gen !== imageCheckGen) return;
    imageExistsInRegistry = tags.some(t => t.name === ref.tag);
    registryCheckError = false;
  } catch {
    if (gen !== imageCheckGen) return;
    // Private repos or network errors — Quay public API often returns 401/404
    imageExistsInRegistry = null;
    registryCheckError = true;
  }
}

function commitTag() {
  lastSyncedTag = inputValue;
  tag = inputValue;
  checkLocalImage(inputValue);
}

async function startBuild() {
  commitTag();
  if (!inputValue) return;

  building = true;
  buildDone = false;
  buildError = '';
  buildCancelled = false;
  cancelling = false;
  currentStep = 0;
  totalSteps = 0;
  logs = [];
  buildStartedAt = Date.now();
  buildFinishedAt = undefined;
  pushDone = false;
  pushError = '';

  try {
    await buildImage(inputValue);
    startPolling('build');
  } catch (e) {
    building = false;
    buildDone = true;
    buildError = e instanceof Error ? e.message : typeof e === 'string' ? e : 'Build failed to start';
    buildFinishedAt = Date.now();
  }
}

async function cancelBuild() {
  if (!inputValue || cancelling || !building) return;
  cancelling = true;
  try {
    await physicalAiClient.cancelBuild(inputValue);
    // Don't wait for the Podman promise — backend marks the build done on cancel.
    stopPolling();
    building = false;
    buildDone = true;
    buildCancelled = true;
    buildError = 'Build cancelled';
    buildFinishedAt = Date.now();
    cancelling = false;
    logs = [...logs, 'Cancel requested — build aborted'];
  } catch (e) {
    cancelling = false;
    buildError = e instanceof Error ? e.message : typeof e === 'string' ? e : 'Failed to cancel build';
  }
}

async function startPush() {
  pushing = true;
  pushDone = false;
  pushError = '';
  pushCancelled = false;
  pushCancelling = false;
  pushDigest = '';
  pushStatus = 'Pushing...';
  pushStartedAt = Date.now();
  pushFinishedAt = undefined;

  try {
    await physicalAiClient.pushImage(inputValue);
    startPolling('push');
  } catch (e) {
    pushing = false;
    pushError = e instanceof Error ? e.message : typeof e === 'string' ? e : 'Push failed to start';
    pushFinishedAt = Date.now();
  }
}

async function cancelPush() {
  if (!inputValue || pushCancelling || !pushing) return;
  pushCancelling = true;
  try {
    await physicalAiClient.cancelPush(inputValue);
    stopPolling();
    pushing = false;
    pushDone = true;
    pushCancelled = true;
    pushError = 'Push cancelled';
    pushFinishedAt = Date.now();
    pushCancelling = false;
  } catch (e) {
    pushCancelling = false;
    pushError = e instanceof Error ? e.message : typeof e === 'string' ? e : 'Failed to cancel push';
  }
}

function startPolling(mode: 'build' | 'push') {
  stopPolling();
  pollTimer = window.setInterval(async () => {
    try {
      if (mode === 'build') {
        const progress = await physicalAiClient.getBuildProgress(inputValue);
        if (progress) {
          logs = progress.logs;
          currentStep = progress.currentStep ?? 0;
          totalSteps = progress.totalSteps ?? 0;
          buildStartedAt = progress.startedAt ?? buildStartedAt;
          buildFinishedAt = progress.finishedAt ?? buildFinishedAt;
          if (logContainer) logContainer.scrollTop = logContainer.scrollHeight;

          if (progress.done) {
            stopPolling();
            building = false;
            buildDone = true;
            cancelling = false;
            buildCancelled = !!progress.cancelled;
            if (progress.error) {
              buildError = progress.error;
            } else {
              imageExistsLocally = true;
              onBuildComplete?.();
            }
          }
        }
      } else {
        const progress = await physicalAiClient.getPushProgress(inputValue);
        if (progress) {
          pushStatus = progress.status;
          pushStartedAt = progress.startedAt ?? pushStartedAt;
          pushFinishedAt = progress.finishedAt ?? pushFinishedAt;

          if (progress.done) {
            stopPolling();
            pushing = false;
            pushDone = true;
            pushCancelling = false;
            pushCancelled = !!progress.cancelled;
            if (progress.error) {
              pushError = progress.error;
            } else {
              imageExistsInRegistry = true;
              registryCheckError = false;
              const digestLine = progress.logs.find(l => l.includes('digest:'));
              if (digestLine) {
                const match = digestLine.match(/digest:\s*(sha256:\w+)/);
                if (match) pushDigest = match[1];
              }
            }
          }
        }
      }
    } catch {
      // ignore polling errors
    }
  }, 500);
}

function stopPolling() {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

function reset() {
  buildDone = false;
  buildError = '';
  buildCancelled = false;
  cancelling = false;
  logs = [];
  currentStep = 0;
  totalSteps = 0;
  buildStartedAt = undefined;
  buildFinishedAt = undefined;
  pushDone = false;
  pushError = '';
  pushCancelled = false;
  pushCancelling = false;
  pushDigest = '';
  pushStartedAt = undefined;
  pushFinishedAt = undefined;
  checkLocalImage();
}

onMount(() => {
  inputValue = tag;
  lastSyncedTag = tag;
  checkLocalImage(tag);
});

onDestroy(() => {
  stopPolling();
});

// Adopt parent-driven tag changes only when idle (avoid mid-build poll key desync).
// Also clears any stale build/push logs and status left over from a previous tag —
// otherwise a completed build's progress/logs stay visible against the new tag.
$: if (tag !== lastSyncedTag && !building && !pushing) {
  inputValue = tag;
  lastSyncedTag = tag;
  reset();
}

$: busy = building || pushing;
$: progressPercent = totalSteps > 0 ? Math.round((currentStep / totalSteps) * 100) : 0;
$: canPush = (imageExistsLocally || (buildDone && !buildError)) && !pushing && !pushDone;
$: buildDurationSec =
  buildStartedAt !== undefined && buildFinishedAt !== undefined
    ? Math.max(0, Math.round((buildFinishedAt - buildStartedAt) / 1000))
    : undefined;
$: pushDurationSec =
  pushStartedAt !== undefined && pushFinishedAt !== undefined
    ? Math.max(0, Math.round((pushFinishedAt - pushStartedAt) / 1000))
    : undefined;
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-row gap-3 items-end">
    <div class="flex flex-col gap-1">
      <label for={tagInputId} class="text-xs text-[var(--pd-content-text)]">Image tag</label>
      <input
        id={tagInputId}
        type="text"
        bind:value={inputValue}
        disabled={building || pushing || disabled}
        on:change={commitTag}
        class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] w-96"
        placeholder={tagPlaceholder} />
    </div>
    {#if !building && !pushing}
      <button on:click={startBuild} disabled={!inputValue || disabled} class="pai-btn pai-btn-primary">
        {imageExistsLocally ? 'Rebuild' : 'Build'}
      </button>
    {:else if building}
      <button on:click={cancelBuild} disabled={cancelling} class="pai-btn pai-btn-danger">
        {cancelling ? 'Cancelling...' : 'Cancel'}
      </button>
    {/if}
  </div>

  {#if imageExistsLocally && !building && !buildDone}
    <div class="text-xs pai-text-success">
      &#10003; Image exists locally: <span class="font-mono">{inputValue}</span>
    </div>
  {/if}

  {#if !building && !pushing}
    {#if imageExistsInRegistry === true}
      <div class="text-xs pai-text-success">
        &#10003; Image exists in registry: <span class="font-mono">{inputValue}</span>
      </div>
    {:else if imageExistsInRegistry === false}
      <div class="text-xs pai-text-muted">Not found in registry yet — push when ready</div>
    {:else if registryCheckError}
      <div class="text-xs pai-text-muted">Registry status unavailable (private repo or Quay unreachable)</div>
    {/if}
  {/if}

  {#if building || buildDone}
    <div class="flex flex-col gap-3">
      {#if totalSteps > 0}
        <div class="flex flex-col gap-1">
          <div class="text-xs text-[var(--pd-content-text)]">
            {#if buildDone && !buildError}
              Complete — Step {totalSteps}/{totalSteps}
            {:else}
              Step {currentStep}/{totalSteps}
            {/if}
          </div>
          <div class="pai-progress-track">
            <div
              class="pai-progress-fill {buildError ? 'pai-progress-fill-error' : ''}"
              style="width: {buildDone && !buildError ? 100 : progressPercent}%;">
            </div>
          </div>
        </div>
      {:else if building}
        <div class="text-xs pai-text-accent">Starting build...</div>
      {/if}

      <div class="flex flex-col gap-1">
        <button on:click={() => (buildLogsExpanded = !buildLogsExpanded)} class="pai-btn pai-btn-sm self-start">
          {buildLogsExpanded ? '▼' : '▶'} Build logs ({logs.length} lines)
        </button>
        {#if buildLogsExpanded}
          <div
            bind:this={logContainer}
            class="rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] font-mono text-xs text-[var(--pd-content-text)]"
            style="max-height: 400px; overflow-y: auto; padding: 8px; white-space: pre-wrap; word-break: break-all;">
            {#each logs as line}
              <div>{line}</div>
            {/each}
            {#if building && logs.length === 0}
              <div class="pai-text-accent">Waiting for build output...</div>
            {/if}
          </div>
        {/if}
      </div>

      {#if buildDone}
        <div class="flex flex-row items-center gap-3">
          {#if buildCancelled}
            <div class="text-sm p-3 rounded pai-banner-warning">
              Build cancelled{#if buildDurationSec !== undefined}
                after {formatDurationSeconds(buildDurationSec)}{/if}
            </div>
          {:else if buildError}
            <div class="flex flex-col gap-2">
              <div class="text-sm p-3 rounded pai-banner-error">
                Build failed: {buildError}
              </div>
              {#if transientMirrorIssue}
                <div class="text-sm p-3 rounded pai-banner-info">
                  This looks like a transient upstream package-mirror issue, not a problem with your build — try "Build
                  again", it usually clears within a few minutes.
                </div>
              {/if}
            </div>
          {:else}
            <div class="text-sm pai-text-success">
              Image built successfully: <span class="font-mono">{inputValue}</span>
              {#if buildDurationSec !== undefined}
                <span class="text-xs pai-text-muted">(built in {formatDurationSeconds(buildDurationSec)})</span>
              {/if}
            </div>
          {/if}
          <button on:click={reset} class="pai-btn pai-btn-sm"> Build again </button>
        </div>
      {/if}
    </div>
  {/if}

  {#if canPush}
    <div class="flex flex-row items-center gap-3 mt-2">
      <button on:click={startPush} class="pai-btn pai-btn-primary"> Push to Registry </button>
      <span class="text-xs text-[var(--pd-content-text)]"
        >Push <span class="font-mono">{inputValue}</span> to the registry</span>
    </div>
  {/if}

  {#if pushing || pushDone}
    <div class="flex flex-col gap-3 mt-2">
      {#if pushing}
        <div class="flex flex-row items-center gap-3">
          <button on:click={cancelPush} disabled={pushCancelling} class="pai-btn pai-btn-danger">
            {pushCancelling ? 'Cancelling...' : 'Cancel push'}
          </button>
          <span class="text-xs pai-text-accent">{pushStatus}</span>
        </div>
        <div class="pai-progress-track">
          <div class="push-progress-bar pai-progress-fill" style="width: 30%;"></div>
        </div>
      {/if}

      {#if pushDone}
        <div class="flex flex-row items-center gap-3">
          {#if pushCancelled}
            <div class="text-sm p-3 rounded pai-banner-warning">
              Push cancelled{#if pushDurationSec !== undefined}
                after {formatDurationSeconds(pushDurationSec)}{/if}
            </div>
            <button on:click={startPush} class="pai-btn pai-btn-sm"> Retry push </button>
          {:else if pushError}
            <div class="text-sm p-3 rounded pai-banner-error">
              Push failed: {pushError}
            </div>
            <button on:click={startPush} class="pai-btn pai-btn-sm"> Retry push </button>
          {:else}
            <div class="text-sm pai-text-success">
              Image pushed successfully to registry
              {#if pushDurationSec !== undefined}
                <span class="text-xs pai-text-muted">(pushed in {formatDurationSeconds(pushDurationSec)})</span>
              {/if}
              {#if pushDigest}
                <div class="text-xs mt-1 pai-text-muted">
                  <span class="font-mono">{inputValue}</span>
                  <br />
                  Digest: <span class="font-mono">{pushDigest}</span>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
