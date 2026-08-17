<script lang="ts">
import { physicalAiClient } from './api/client';
import { onMount, onDestroy } from 'svelte';
import { router } from 'tinro';
import type { QuayRepository, QuayTag, PullProgress } from '/@shared/src/types/ImageCatalog';
import { filterCuratedRepos, type CatalogViewMode, DEFAULT_CURATED_ALLOWLIST } from '/@shared/src/types/CatalogCurated';
import RelatedLinks from './lib/RelatedLinks.svelte';

let namespace = '';
let filter = '';
let repos: QuayRepository[] = [];
let loading = false;
let error = '';
/** True after default namespace / prefs are applied — avoids a flash of "required" on first paint. */
let catalogReady = false;

let viewMode: CatalogViewMode = 'all';
let curatedAllowlist = DEFAULT_CURATED_ALLOWLIST;

let expandedRepo: string | null = null;
let tags: QuayTag[] = [];
let loadingTags = false;
let tagError = '';

let localImages: Set<string> = new Set();
let localSectionExpanded = true;

let pullingImages: Set<string> = new Set();
let pullProgress: Map<string, PullProgress> = new Map();
let pullResults: Map<string, { success: boolean; message: string }> = new Map();
let pollTimers: Map<string, number> = new Map();

$: hasNamespace = namespace.trim().length > 0;
$: namespaceMissing = catalogReady && !hasNamespace;

$: scopedRepos = viewMode === 'curated' ? filterCuratedRepos(repos, curatedAllowlist) : repos;
$: filteredRepos = scopedRepos.filter(r => r.name.toLowerCase().includes(filter.toLowerCase()));

$: localImagesForNamespace = hasNamespace
  ? Array.from(localImages).filter(img => img.startsWith(`quay.io/${namespace.trim()}/`))
  : [];

/** Clearing the namespace must drop stale results from the last Load (do not re-query with empty ns). */
$: if (!hasNamespace && repos.length > 0) {
  repos = [];
  expandedRepo = null;
  tags = [];
  tagError = '';
  error = '';
}

async function setViewMode(mode: CatalogViewMode) {
  viewMode = mode;
  try {
    await physicalAiClient.setCatalogViewMode(mode);
  } catch {
    // preference persist is best-effort
  }
}

async function refreshLocalImages() {
  try {
    const tags = await physicalAiClient.listLocalImages();
    localImages = new Set(tags);
  } catch {
    // ignore — local image check is best-effort
  }
}

function isLocal(repoKey: string, tagName: string, _localSet: Set<string>): boolean {
  return _localSet.has(`quay.io/${repoKey}:${tagName}`);
}

function startPolling(pullKey: string, imageKey: string) {
  const timer = window.setInterval(async () => {
    try {
      const progress = await physicalAiClient.getPullProgress(imageKey);
      if (progress) {
        pullProgress.set(imageKey, progress);
        pullProgress = pullProgress;

        if (progress.done) {
          stopPolling(imageKey);
          pullingImages.delete(pullKey);
          pullingImages = pullingImages;
          pullProgress.delete(imageKey);
          pullProgress = pullProgress;

          if (progress.error) {
            pullResults.set(pullKey, { success: false, message: progress.error });
          } else {
            pullResults.set(pullKey, { success: true, message: 'Pulled' });
            refreshLocalImages();
          }
          pullResults = pullResults;
        }
      }
    } catch {
      // ignore polling errors
    }
  }, 500);
  pollTimers.set(imageKey, timer);
}

function stopPolling(imageKey: string) {
  const timer = pollTimers.get(imageKey);
  if (timer) {
    window.clearInterval(timer);
    pollTimers.delete(imageKey);
  }
}

async function loadRepos() {
  const ns = namespace.trim();
  if (!ns) {
    repos = [];
    return;
  }

  loading = true;
  error = '';
  repos = [];
  expandedRepo = null;
  tags = [];
  tagError = '';

  try {
    repos = await physicalAiClient.listCatalogImages(ns);
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to load repositories';
  } finally {
    loading = false;
  }
}

async function toggleTags(repo: QuayRepository) {
  const repoKey = `${repo.namespace}/${repo.name}`;

  if (expandedRepo === repoKey) {
    expandedRepo = null;
    tags = [];
    tagError = '';
    return;
  }

  expandedRepo = repoKey;
  loadingTags = true;
  tags = [];
  tagError = '';

  try {
    tags = await physicalAiClient.getImageTags(repo.namespace, repo.name);
  } catch (e) {
    tagError = e instanceof Error ? e.message : 'Failed to load tags';
    tags = [];
  } finally {
    loadingTags = false;
  }
}

async function pullImage(repo: QuayRepository, tag: QuayTag) {
  const pullKey = `${repo.namespace}/${repo.name}:${tag.name}`;
  const imageKey = `quay.io/${repo.namespace}/${repo.name}:${tag.name}`;
  pullingImages.add(pullKey);
  pullingImages = pullingImages;
  pullResults.delete(pullKey);
  pullResults = pullResults;

  try {
    await physicalAiClient.pullImage(`${repo.namespace}/${repo.name}`, tag.name);
    startPolling(pullKey, imageKey);
  } catch (e) {
    pullingImages.delete(pullKey);
    pullingImages = pullingImages;
    pullResults.set(pullKey, {
      success: false,
      message: e instanceof Error ? e.message : typeof e === 'string' ? e : 'Pull failed',
    });
    pullResults = pullResults;
  }
}

function resetPullResult(pullKey: string) {
  pullResults.delete(pullKey);
  pullResults = pullResults;
}

function getProgress(
  repoKey: string,
  tagName: string,
  _progressMap: Map<string, PullProgress>,
): { percent: number; text: string } | null {
  const imageKey = `quay.io/${repoKey}:${tagName}`;
  const progress = _progressMap.get(imageKey);
  if (!progress) return null;
  if (progress.currentMB !== undefined && progress.totalMB !== undefined && progress.totalMB > 0) {
    const percent = Math.min(Math.round((progress.currentMB / progress.totalMB) * 100), 100);
    return { percent, text: `Downloading... ${progress.currentMB} MB (${percent}%)` };
  }
  return { percent: 0, text: progress.status || 'Pulling...' };
}

function truncateError(msg: string, max: number = 80): string {
  return msg.length > max ? msg.substring(0, max) + '...' : msg;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

onMount(async () => {
  try {
    namespace = await physicalAiClient.getDefaultNamespace();
    try {
      viewMode = await physicalAiClient.getCatalogViewMode();
      curatedAllowlist = await physicalAiClient.getCatalogCuratedAllowlist();
    } catch {
      // defaults are fine
    }
    refreshLocalImages();
    if (namespace.trim()) {
      await loadRepos();
    }
  } finally {
    catalogReady = true;
  }
});

onDestroy(() => {
  for (const timer of pollTimers.values()) {
    window.clearInterval(timer);
  }
});
</script>

<div class="flex flex-col p-4 gap-4 h-full overflow-auto">
  <button on:click={() => router.goto('/')} class="pai-link self-start"> &larr; Back to Dashboard </button>
  <h1 class="text-3xl text-[var(--pd-content-header)]">Image Catalog</h1>
  <RelatedLinks links={[{ label: 'Image Builder', to: '/build' }]} />
  <p class="text-sm text-[var(--pd-content-text)]">
    Browse and pull ROS2 container images from a Quay.io organization. Bases are Ubuntu interim today (Fedora/RHEL
    migration is tracked separately).
  </p>

  <div class="flex flex-row gap-3 items-end flex-wrap">
    <div class="flex flex-col gap-1">
      <label for="namespace" class="text-xs text-[var(--pd-content-text)]">Quay.io namespace</label>
      <input
        id="namespace"
        type="text"
        bind:value={namespace}
        class="px-3 py-1.5 text-sm rounded border bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] w-64 {namespaceMissing
          ? 'pai-input-error'
          : 'border-[var(--pd-content-card-border)]'}"
        placeholder="e.g. ecosystem-appeng"
        aria-invalid={namespaceMissing}
        aria-describedby={namespaceMissing ? 'namespace-error' : undefined}
        required />
      {#if namespaceMissing}
        <p id="namespace-error" class="text-xs pai-text-error" role="alert">Namespace is required.</p>
      {/if}
    </div>
    <button on:click={loadRepos} disabled={loading || !hasNamespace} class="pai-btn pai-btn-primary">
      {loading ? 'Loading...' : 'Load'}
    </button>
    <div class="flex flex-col gap-1">
      <span class="text-xs text-[var(--pd-content-text)]">View</span>
      <div class="flex flex-row rounded border border-[var(--pd-content-card-border)] overflow-hidden">
        <button
          type="button"
          class="px-3 py-1.5 text-sm cursor-pointer"
          style={viewMode === 'all'
            ? 'background-color: var(--pai-accent); color: var(--pai-accent-text);'
            : 'background-color: var(--pd-content-card-bg); color: var(--pd-content-text);'}
          on:click={() => setViewMode('all')}>
          All
        </button>
        <button
          type="button"
          class="px-3 py-1.5 text-sm cursor-pointer border-l border-[var(--pd-content-card-border)]"
          style={viewMode === 'curated'
            ? 'background-color: var(--pai-accent); color: var(--pai-accent-text);'
            : 'background-color: var(--pd-content-card-bg); color: var(--pd-content-text);'}
          on:click={() => setViewMode('curated')}
          title="Patterns: {curatedAllowlist}">
          Curated
        </button>
      </div>
    </div>
  </div>
  {#if viewMode === 'curated'}
    <p class="text-xs pai-text-muted">
      Curated patterns (Settings → Preferences → Physical AI): <span class="font-mono">{curatedAllowlist}</span>
    </p>
  {/if}

  <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)]">
    <div class="flex flex-row items-center">
      <button
        on:click={() => (localSectionExpanded = !localSectionExpanded)}
        class="flex-1 text-left p-3 flex flex-row items-center gap-3 hover:bg-[var(--pd-content-bg)] rounded-l-lg cursor-pointer">
        <span class="text-xs text-[var(--pd-content-text)]">
          {localSectionExpanded ? '▼' : '▶'}
        </span>
        <div class="flex flex-row items-center gap-2">
          <span class="text-sm font-medium pai-text-success">Locally Available ({localImagesForNamespace.length})</span>
        </div>
      </button>
      <button
        on:click|stopPropagation={() => refreshLocalImages()}
        class="pai-link pai-link-sm hover:bg-[var(--pd-content-bg)] rounded-r-lg"
        style="padding: 12px 20px 12px 12px;"
        title="Refresh local images"
        aria-label="Refresh local images">
        ↻
      </button>
    </div>
    {#if localSectionExpanded && localImagesForNamespace.length > 0}
      <div
        class="border-t border-[var(--pd-content-card-border)] px-3 py-2"
        style="max-height: 180px; overflow-y: auto;">
        <div class="flex flex-col gap-1">
          {#each localImagesForNamespace as img}
            <div class="flex flex-row items-center gap-2 text-xs text-[var(--pd-content-text)]">
              <span class="pai-text-success">&#10003;</span>
              <span class="font-mono">{img}</span>
            </div>
          {/each}
        </div>
      </div>
    {:else if localSectionExpanded}
      <div class="border-t border-[var(--pd-content-card-border)] px-3 py-2">
        {#if !hasNamespace}
          <span class="text-xs text-[var(--pd-content-text)]">Enter a namespace to list local images.</span>
        {:else}
          <span class="text-xs text-[var(--pd-content-text)]">No local images for this namespace</span>
        {/if}
      </div>
    {/if}
  </div>

  {#if repos.length > 0}
    <div class="flex flex-col gap-1">
      <label for="filter" class="text-xs text-[var(--pd-content-text)]">Filter by name</label>
      <input
        id="filter"
        type="text"
        bind:value={filter}
        class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] w-64"
        placeholder="e.g. ros2-" />
    </div>
  {/if}

  {#if error}
    <div class="p-3 rounded text-sm pai-banner-error">{error}</div>
  {/if}

  {#if loading}
    <div class="text-sm text-[var(--pd-content-text)]">Loading repositories...</div>
  {:else if repos.length > 0}
    <div class="text-xs text-[var(--pd-content-text)]">
      {#if viewMode === 'curated'}
        Showing {filteredRepos.length} curated of {repos.length} repositories
      {:else}
        Showing {filteredRepos.length} of {repos.length} repositories
      {/if}
    </div>

    {#if filteredRepos.length === 0}
      <div class="text-sm p-3 rounded pai-banner-warning">
        {#if viewMode === 'curated'}
          No curated repositories matched <span class="font-mono">{curatedAllowlist}</span> in this namespace. Switch to
          All, or push <strong>public</strong> golden images (see Help), or edit the allowlist in Preferences. Private Quay
          repos are not listed (Catalog uses the public Quay API).
        {:else}
          No repositories match the name filter.
        {/if}
      </div>
    {/if}

    <div class="flex flex-col gap-2">
      {#each filteredRepos as repo}
        {@const repoKey = `${repo.namespace}/${repo.name}`}
        <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)]">
          <button
            on:click={() => toggleTags(repo)}
            class="w-full text-left p-3 flex flex-row items-center gap-3 hover:bg-[var(--pd-content-bg)] rounded-lg cursor-pointer">
            <span class="text-xs text-[var(--pd-content-text)]">
              {expandedRepo === repoKey ? '▼' : '▶'}
            </span>
            <div class="flex flex-col flex-1 min-w-0">
              <div class="text-sm font-medium text-[var(--pd-content-header)]">
                {repo.namespace} / <span class="pai-accent-name">{repo.name}</span>
              </div>
              {#if repo.description}
                <div class="text-xs text-[var(--pd-content-text)] truncate">{repo.description}</div>
              {/if}
            </div>
          </button>

          {#if expandedRepo === repoKey}
            <div class="border-t border-[var(--pd-content-card-border)] p-3">
              {#if loadingTags}
                <div class="text-xs text-[var(--pd-content-text)]">Loading tags...</div>
              {:else if tagError}
                <div class="text-xs p-2 rounded pai-banner-error">
                  Failed to load tags: {tagError}
                </div>
              {:else if tags.length === 0}
                <div class="text-xs text-[var(--pd-content-text)]">No tags found</div>
              {:else}
                <table class="w-full text-xs">
                  <thead>
                    <tr class="text-left text-[var(--pd-content-text)] border-b border-[var(--pd-content-card-border)]">
                      <th class="pb-2 pr-4">Tag</th>
                      <th class="pb-2 pr-4">Size</th>
                      <th class="pb-2 pr-4">Last Modified</th>
                      <th class="pb-2 pr-4">Digest</th>
                      <th class="pb-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each tags as tag}
                      {@const pullKey = `${repoKey}:${tag.name}`}
                      {@const progress = getProgress(repoKey, tag.name, pullProgress)}
                      {@const tagIsLocal = isLocal(repoKey, tag.name, localImages)}
                      <tr class="border-b border-[var(--pd-content-card-border)] last:border-b-0">
                        <td class="py-2 pr-4 font-medium text-[var(--pd-content-header)]">{tag.name}</td>
                        <td class="py-2 pr-4 text-[var(--pd-content-text)]">{formatSize(tag.size)}</td>
                        <td class="py-2 pr-4 text-[var(--pd-content-text)]">{formatDate(tag.last_modified)}</td>
                        <td class="py-2 pr-4 text-[var(--pd-content-text)] font-mono"
                          >{tag.manifest_digest.substring(7, 19)}</td>
                        <td class="py-2 min-w-[260px]">
                          {#if pullingImages.has(pullKey)}
                            <div class="flex flex-col gap-1">
                              <div class="pai-progress-track" style="max-width: 180px; height: 6px;">
                                <div class="pai-progress-fill" style="width: {progress?.percent ?? 0}%;"></div>
                              </div>
                              <span class="text-xs pai-text-accent">
                                {progress?.text ?? 'Pulling...'}
                              </span>
                            </div>
                          {:else if pullResults.has(pullKey)}
                            {@const result = pullResults.get(pullKey)}
                            <div class="flex flex-row items-center gap-2">
                              {#if result?.success}
                                <span class="text-xs pai-text-success">Pulled</span>
                                <button
                                  on:click|stopPropagation={() => resetPullResult(pullKey)}
                                  class="pai-link pai-link-sm">
                                  Pull again
                                </button>
                              {:else}
                                <span class="text-xs pai-text-error" title={result?.message}>
                                  {truncateError(result?.message ?? 'Pull failed')}
                                </span>
                                <button
                                  on:click|stopPropagation={() => resetPullResult(pullKey)}
                                  class="pai-link pai-link-sm">
                                  Retry
                                </button>
                              {/if}
                            </div>
                          {:else if tagIsLocal}
                            <div class="flex flex-row items-center gap-2">
                              <span class="text-xs pai-text-success">&#10003; Local</span>
                              <button
                                on:click|stopPropagation={() => pullImage(repo, tag)}
                                class="pai-link pai-link-sm">
                                Pull again
                              </button>
                            </div>
                          {:else}
                            <button
                              on:click|stopPropagation={() => pullImage(repo, tag)}
                              class="pai-btn pai-btn-sm pai-btn-primary">
                              Pull
                            </button>
                          {/if}
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {:else if !error && hasNamespace}
    <div class="text-sm text-[var(--pd-content-text)]">Click Load to browse images for this namespace.</div>
  {/if}
</div>
