<script lang="ts">
import { physicalAiClient } from './api/client';
import { onMount, onDestroy } from 'svelte';
import { router } from 'tinro';
import type { QuayRepository, QuayTag, PullProgress } from '/@shared/src/types/ImageCatalog';

let namespace = 'ecosystem-appeng';
let filter = '';
let repos: QuayRepository[] = [];
let loading = false;
let error = '';

let expandedRepo: string | null = null;
let tags: QuayTag[] = [];
let loadingTags = false;

let pullingImages: Set<string> = new Set();
let pullProgress: Map<string, PullProgress> = new Map();
let pullResults: Map<string, { success: boolean; message: string }> = new Map();
let pollTimers: Map<string, number> = new Map();

$: filteredRepos = repos.filter(r =>
  r.name.toLowerCase().includes(filter.toLowerCase()),
);

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
  loading = true;
  error = '';
  repos = [];
  expandedRepo = null;
  tags = [];

  try {
    repos = await physicalAiClient.listCatalogImages(namespace);
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
    return;
  }

  expandedRepo = repoKey;
  loadingTags = true;
  tags = [];

  try {
    tags = await physicalAiClient.getImageTags(repo.namespace, repo.name);
  } catch {
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

function getPullStatus(repoKey: string, tagName: string, _progressMap: Map<string, PullProgress>): string {
  const imageKey = `quay.io/${repoKey}:${tagName}`;
  const progress = _progressMap.get(imageKey);
  if (!progress) return 'Pulling...';
  if (progress.currentMB !== undefined && progress.totalMB !== undefined && progress.totalMB > 0) {
    const percent = Math.round(progress.currentMB / progress.totalMB * 100);
    return `${progress.currentMB}/${progress.totalMB} MB (${percent}%)`;
  }
  return progress.status || 'Pulling...';
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

onMount(() => {
  loadRepos();
});

onDestroy(() => {
  for (const timer of pollTimers.values()) {
    window.clearInterval(timer);
  }
});
</script>

<div class="flex flex-col p-4 gap-4 h-full overflow-auto">
  <button
    on:click={() => router.goto('/')}
    class="text-sm text-purple-500 hover:underline self-start cursor-pointer"
  >
    &larr; Back to Dashboard
  </button>
  <h1 class="text-3xl text-[var(--pd-content-header)]">Image Catalog</h1>
  <p class="text-sm text-[var(--pd-content-text)]">
    Browse and pull container images from a Quay.io organization.
  </p>

  <div class="flex flex-row gap-3 items-end">
    <div class="flex flex-col gap-1">
      <label for="namespace" class="text-xs text-[var(--pd-content-text)]">Quay.io namespace</label>
      <input
        id="namespace"
        type="text"
        bind:value={namespace}
        class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] w-64"
        placeholder="e.g. ecosystem-appeng"
      />
    </div>
    <button
      on:click={loadRepos}
      disabled={loading || !namespace}
      class="px-4 py-1.5 text-sm rounded disabled:opacity-50 disabled:cursor-not-allowed"
      style="background-color: #7c3aed; color: #ffffff;"
    >
      {loading ? 'Loading...' : 'Load'}
    </button>
  </div>

  {#if repos.length > 0}
    <div class="flex flex-col gap-1">
      <label for="filter" class="text-xs text-[var(--pd-content-text)]">Filter by name</label>
      <input
        id="filter"
        type="text"
        bind:value={filter}
        class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] w-64"
        placeholder="e.g. aiobs-"
      />
    </div>
  {/if}

  {#if error}
    <div class="p-3 rounded bg-red-100 text-red-800 text-sm">{error}</div>
  {/if}

  {#if loading}
    <div class="text-sm text-[var(--pd-content-text)]">Loading repositories...</div>
  {:else if repos.length > 0}
    <div class="text-xs text-[var(--pd-content-text)]">
      Showing {filteredRepos.length} of {repos.length} repositories
    </div>

    <div class="flex flex-col gap-2">
      {#each filteredRepos as repo}
        {@const repoKey = `${repo.namespace}/${repo.name}`}
        <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)]">
          <button
            on:click={() => toggleTags(repo)}
            class="w-full text-left p-3 flex flex-row items-center gap-3 hover:bg-[var(--pd-content-bg)] rounded-lg cursor-pointer"
          >
            <span class="text-xs text-[var(--pd-content-text)]">
              {expandedRepo === repoKey ? '▼' : '▶'}
            </span>
            <div class="flex flex-col flex-1 min-w-0">
              <div class="text-sm font-medium text-[var(--pd-content-header)]">
                {repo.namespace} / <span class="text-purple-500">{repo.name}</span>
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
                      <tr class="border-b border-[var(--pd-content-card-border)] last:border-b-0">
                        <td class="py-2 pr-4 font-medium text-[var(--pd-content-header)]">{tag.name}</td>
                        <td class="py-2 pr-4 text-[var(--pd-content-text)]">{formatSize(tag.size)}</td>
                        <td class="py-2 pr-4 text-[var(--pd-content-text)]">{formatDate(tag.last_modified)}</td>
                        <td class="py-2 pr-4 text-[var(--pd-content-text)] font-mono">{tag.manifest_digest.substring(7, 19)}</td>
                        <td class="py-2 min-w-[220px]">
                          {#if pullingImages.has(pullKey)}
                            <span style="color: #7c3aed;">{getPullStatus(repoKey, tag.name, pullProgress)}</span>
                          {:else if pullResults.has(pullKey)}
                            {@const result = pullResults.get(pullKey)}
                            <span style="color: {result?.success ? '#16a34a' : '#dc2626'};">
                              {result?.message}
                            </span>
                          {:else}
                            <button
                              on:click|stopPropagation={() => pullImage(repo, tag)}
                              class="px-2 py-0.5 rounded text-xs"
                              style="background-color: #7c3aed; color: #ffffff;"
                            >
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
  {:else if !error}
    <div class="text-sm text-[var(--pd-content-text)]">
      Enter a Quay.io namespace and click Load to browse images.
    </div>
  {/if}
</div>
