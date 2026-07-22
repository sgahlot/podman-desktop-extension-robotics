<script lang="ts">
import { physicalAiClient } from '../api/client';
import { onMount, onDestroy } from 'svelte';

/** Called to start a build for the current tag (fire-and-forget; progress via polling). */
export let buildImage: (tag: string) => Promise<void>;
/** Image tag — bind from parent. Parent updates are adopted when not mid-edit. */
export let tag = '';
export let tagPlaceholder = 'e.g. quay.io/org/image:latest';
export let tagInputId = 'image-tag';

let inputValue = tag;
let lastSyncedTag = tag;

let imageExistsLocally = false;

let building = false;
let buildDone = false;
let buildError = '';
let buildCancelled = false;
let cancelling = false;
let currentStep = 0;
let totalSteps = 0;
let logs: string[] = [];

let pushing = false;
let pushDone = false;
let pushError = '';
let pushStatus = 'Pushing...';
let pushDigest = '';

let buildLogsExpanded = true;

let pollTimer: number | null = null;
let logContainer: HTMLDivElement;

async function checkLocalImage(imageTag: string = inputValue) {
  if (!imageTag) {
    imageExistsLocally = false;
    return;
  }
  try {
    const localImages = await physicalAiClient.listLocalImages();
    imageExistsLocally = localImages.includes(imageTag);
  } catch {
    imageExistsLocally = false;
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
  pushDone = false;
  pushError = '';

  try {
    await buildImage(inputValue);
    startPolling('build');
  } catch (e) {
    building = false;
    buildError = e instanceof Error ? e.message : typeof e === 'string' ? e : 'Build failed to start';
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
  pushDigest = '';
  pushStatus = 'Pushing...';

  try {
    await physicalAiClient.pushImage(inputValue);
    startPolling('push');
  } catch (e) {
    pushing = false;
    pushError = e instanceof Error ? e.message : typeof e === 'string' ? e : 'Push failed to start';
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
            }
          }
        }
      } else {
        const progress = await physicalAiClient.getPushProgress(inputValue);
        if (progress) {
          pushStatus = progress.status;

          if (progress.done) {
            stopPolling();
            pushing = false;
            pushDone = true;
            if (progress.error) {
              pushError = progress.error;
            } else {
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
  pushDone = false;
  pushError = '';
  pushDigest = '';
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

// Adopt parent-driven tag changes (e.g. wizard save) without reacting to every keystroke
$: if (tag !== lastSyncedTag) {
  inputValue = tag;
  lastSyncedTag = tag;
  checkLocalImage(tag);
}

$: progressPercent = totalSteps > 0 ? Math.round((currentStep / totalSteps) * 100) : 0;
$: canPush = (imageExistsLocally || (buildDone && !buildError)) && !pushing && !pushDone;
</script>

<style>
  @keyframes indeterminate {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(400%); }
  }
  .push-progress-bar {
    animation: indeterminate 1.5s ease-in-out infinite;
  }
</style>

<div class="flex flex-col gap-4">
  <div class="flex flex-row gap-3 items-end">
    <div class="flex flex-col gap-1">
      <label for={tagInputId} class="text-xs text-[var(--pd-content-text)]">Image tag</label>
      <input
        id={tagInputId}
        type="text"
        bind:value={inputValue}
        disabled={building || pushing}
        on:change={commitTag}
        class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] w-96"
        placeholder={tagPlaceholder}
      />
    </div>
    {#if !building && !pushing}
      <button
        on:click={startBuild}
        disabled={!inputValue}
        class="px-4 py-1.5 text-sm rounded disabled:opacity-50 disabled:cursor-not-allowed"
        style="background-color: #7c3aed; color: #ffffff;"
      >
        {imageExistsLocally ? 'Rebuild' : 'Build'}
      </button>
    {:else if building}
      <button
        on:click={cancelBuild}
        disabled={cancelling}
        class="px-4 py-1.5 text-sm rounded disabled:opacity-50 disabled:cursor-not-allowed"
        style="background-color: #dc2626; color: #ffffff;"
      >
        {cancelling ? 'Cancelling...' : 'Cancel'}
      </button>
    {/if}
  </div>

  {#if imageExistsLocally && !building && !buildDone}
    <div class="text-xs" style="color: #16a34a;">
      &#10003; Image exists locally: <span class="font-mono">{inputValue}</span>
    </div>
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
          <div style="background-color: #e5e7eb; border-radius: 4px; height: 8px; width: 100%; max-width: 400px; overflow: hidden;">
            <div style="background-color: {buildError ? '#dc2626' : '#7c3aed'}; height: 100%; width: {buildDone && !buildError ? 100 : progressPercent}%; transition: width 0.3s;"></div>
          </div>
        </div>
      {:else if building}
        <div class="text-xs" style="color: #7c3aed;">Starting build...</div>
      {/if}

      <div class="flex flex-col gap-1">
        <button
          on:click={() => buildLogsExpanded = !buildLogsExpanded}
          class="text-xs text-[var(--pd-content-text)] self-start cursor-pointer hover:underline"
        >
          {buildLogsExpanded ? '▼' : '▶'} Build logs ({logs.length} lines)
        </button>
        {#if buildLogsExpanded}
          <div
            bind:this={logContainer}
            class="rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] font-mono text-xs text-[var(--pd-content-text)]"
            style="max-height: 400px; overflow-y: auto; padding: 8px; white-space: pre-wrap; word-break: break-all;"
          >
            {#each logs as line}
              <div>{line}</div>
            {/each}
            {#if building && logs.length === 0}
              <div style="color: #7c3aed;">Waiting for build output...</div>
            {/if}
          </div>
        {/if}
      </div>

      {#if buildDone}
        <div class="flex flex-row items-center gap-3">
          {#if buildCancelled}
            <div class="text-sm p-3 rounded" style="background-color: #fff7ed; color: #9a3412;">
              Build cancelled
            </div>
          {:else if buildError}
            <div class="text-sm p-3 rounded" style="background-color: #fef2f2; color: #991b1b;">
              Build failed: {buildError}
            </div>
          {:else}
            <div class="text-sm" style="color: #16a34a;">
              Image built successfully: <span class="font-mono">{inputValue}</span>
            </div>
          {/if}
          <button
            on:click={reset}
            class="text-xs cursor-pointer hover:underline"
            style="color: #7c3aed;"
          >
            Build again
          </button>
        </div>
      {/if}
    </div>
  {/if}

  {#if canPush}
    <div class="flex flex-row items-center gap-3 mt-2">
      <button
        on:click={startPush}
        class="px-4 py-1.5 text-sm rounded"
        style="background-color: #7c3aed; color: #ffffff;"
      >
        Push to Registry
      </button>
      <span class="text-xs text-[var(--pd-content-text)]">Push <span class="font-mono">{inputValue}</span> to the registry</span>
    </div>
  {/if}

  {#if pushing || pushDone}
    <div class="flex flex-col gap-3 mt-2">
      {#if pushing}
        <div class="text-xs" style="color: #7c3aed;">{pushStatus}</div>
        <div style="background-color: #e5e7eb; border-radius: 4px; height: 8px; width: 100%; max-width: 400px; overflow: hidden;">
          <div class="push-progress-bar" style="background-color: #7c3aed; height: 100%; width: 30%;"></div>
        </div>
      {/if}

      {#if pushDone}
        <div class="flex flex-row items-center gap-3">
          {#if pushError}
            <div class="text-sm p-3 rounded" style="background-color: #fef2f2; color: #991b1b;">
              Push failed: {pushError}
            </div>
            <button
              on:click={startPush}
              class="text-xs cursor-pointer hover:underline"
              style="color: #7c3aed;"
            >
              Retry push
            </button>
          {:else}
            <div class="text-sm" style="color: #16a34a;">
              Image pushed successfully to registry
              {#if pushDigest}
                <div class="text-xs mt-1" style="color: #4b5563;">
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
