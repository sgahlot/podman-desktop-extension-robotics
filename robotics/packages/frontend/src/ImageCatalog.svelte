<script lang="ts">
import { physicalAiClient } from './api/client';
import { onMount, onDestroy } from 'svelte';
import { router } from 'tinro';
import type { CatalogRegistry, CatalogRepository, CatalogTag, PullProgress } from '/@shared/src/types/ImageCatalog';
import { filterCuratedRepos, type CatalogViewMode, DEFAULT_CURATED_ALLOWLIST } from '/@shared/src/types/CatalogCurated';
import QuickLinks from './lib/QuickLinks.svelte';
import { navigationLayout } from './lib/navigationLayout';

/** False while another route is visible — Route.svelte keeps this page mounted. */
export let active = true;

let namespace = '';
let registries: CatalogRegistry[] = [];
let selectedRegistryId = '';
let selectedRegistry: CatalogRegistry | undefined;
let registryHost = 'quay.io';
let catalogWasActive = false;
let filter = '';
let repos: CatalogRepository[] = [];
let loading = false;
let error = '';
/** True after default namespace / prefs are applied — avoids a flash of "required" on first paint. */
let catalogReady = false;

let viewMode: CatalogViewMode = 'all';
let globalCuratedAllowlist = DEFAULT_CURATED_ALLOWLIST;
let curatedOverride = '';
let curatedOverrideError = '';
let curatedOverrideSaved = false;
let savingCuratedOverride = false;

let expandedRepo: string | null = null;
let tags: CatalogTag[] = [];
let tagFilter = '';
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
$: selectedRegistry = registries.find(registry => registry.id === selectedRegistryId);
$: registryHost = selectedRegistry?.host ?? 'quay.io';
$: curatedAllowlist = selectedRegistry?.curatedAllowlist?.trim() || globalCuratedAllowlist;
$: if (selectedRegistry) curatedOverride = selectedRegistry.curatedAllowlist ?? '';

$: scopedRepos = viewMode === 'curated' ? filterCuratedRepos(repos, curatedAllowlist) : repos;
$: filteredRepos = scopedRepos.filter(r => r.name.toLowerCase().includes(filter.toLowerCase()));
$: filteredTags = tags.filter(tag => tag.name.toLowerCase().includes(tagFilter.toLowerCase()));

$: localImagesForNamespace = hasNamespace
  ? Array.from(localImages).filter(img => img.startsWith(`${registryHost}/${namespace.trim()}/`))
  : [];

/** Clearing the namespace must drop stale results from the last Load (do not re-query with empty ns). */
$: if (!hasNamespace && repos.length > 0) {
  repos = [];
  expandedRepo = null;
  tags = [];
  tagFilter = '';
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

async function saveCuratedOverride() {
  if (!selectedRegistryId) return;
  savingCuratedOverride = true;
  curatedOverrideError = '';
  curatedOverrideSaved = false;
  try {
    const raw = await physicalAiClient.getCatalogRegistriesJson();
    const configured = raw.trim() ? JSON.parse(raw) : registries;
    if (!Array.isArray(configured)) throw new Error('Registry configuration must be a JSON array.');
    const next = configured.map((entry: CatalogRegistry) => {
      if (entry.id !== selectedRegistryId) return entry;
      const updated = { ...entry };
      if (curatedOverride.trim()) updated.curatedAllowlist = curatedOverride.trim();
      else delete updated.curatedAllowlist;
      return updated;
    });
    if (!next.some((entry: CatalogRegistry) => entry.id === selectedRegistryId)) {
      throw new Error(`Unknown catalog registry "${selectedRegistryId}".`);
    }
    await physicalAiClient.setCatalogRegistriesJson(JSON.stringify(next));
    registries = await physicalAiClient.getCatalogRegistries();
    curatedOverrideSaved = true;
  } catch (e) {
    curatedOverrideError = e instanceof Error ? e.message : 'Could not save curated patterns';
  } finally {
    savingCuratedOverride = false;
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
  return _localSet.has(`${registryHost}/${repoKey}:${tagName}`);
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
  if (!ns || !selectedRegistryId) {
    repos = [];
    return;
  }

  loading = true;
  error = '';
  repos = [];
  expandedRepo = null;
  tags = [];
  tagFilter = '';
  tagError = '';

  try {
    repos = await physicalAiClient.listCatalogRepositories(selectedRegistryId, ns);
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to load repositories';
  } finally {
    loading = false;
  }
}

async function toggleTags(repo: CatalogRepository) {
  const repoKey = `${repo.namespace}/${repo.name}`;

  if (expandedRepo === repoKey) {
    expandedRepo = null;
    tags = [];
    tagFilter = '';
    tagError = '';
    return;
  }

  expandedRepo = repoKey;
  loadingTags = true;
  tags = [];
  tagFilter = '';
  tagError = '';

  try {
    tags = await physicalAiClient.getCatalogTags(selectedRegistryId, repo.namespace, repo.name);
  } catch (e) {
    tagError = e instanceof Error ? e.message : 'Failed to load tags';
    tags = [];
  } finally {
    loadingTags = false;
  }
}

async function pullImage(repo: CatalogRepository, tag: CatalogTag) {
  const pullKey = `${repo.namespace}/${repo.name}:${tag.name}`;
  const imageKey = `${registryHost}/${repo.namespace}/${repo.name}:${tag.name}`;
  pullingImages.add(pullKey);
  pullingImages = pullingImages;
  pullResults.delete(pullKey);
  pullResults = pullResults;

  try {
    await physicalAiClient.pullImageByRef(imageKey);
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
  const imageKey = `${registryHost}/${repoKey}:${tagName}`;
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
  if (Number.isNaN(date.getTime())) return 'Not reported';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

$: if (active) {
  if (!catalogWasActive) {
    catalogWasActive = true;
    void refreshLocalImages();
    void refreshRegistryConfig();
  }
} else {
  catalogWasActive = false;
}

onMount(async () => {
  window.addEventListener('physical-ai-registries-updated', handleRegistrySettingsUpdated);
  try {
    registries = await physicalAiClient.getCatalogRegistries();
    selectedRegistryId = registries[0]?.id ?? '';
    namespace =
      registries[0]?.kind === 'quay' ? await physicalAiClient.getDefaultNamespace() : (registries[0]?.namespace ?? '');
    try {
      viewMode = await physicalAiClient.getCatalogViewMode();
      globalCuratedAllowlist = await physicalAiClient.getCatalogCuratedAllowlist();
    } catch {
      // defaults are fine
    }
    if (active) {
      void refreshLocalImages();
    }
    if (namespace.trim() && selectedRegistryId) {
      await loadRepos();
    }
  } catch (e) {
    error = e instanceof Error ? e.message : 'Invalid catalog registry settings';
  } finally {
    catalogReady = true;
  }
});

async function selectRegistry(registryId: string) {
  selectedRegistryId = registryId;
  const registry = registries.find(item => item.id === registryId);
  namespace = registry?.namespace ?? '';
  await loadRepos();
}

async function refreshRegistryConfig(): Promise<void> {
  try {
    const next = await physicalAiClient.getCatalogRegistries();
    const nextId = next.some(registry => registry.id === selectedRegistryId) ? selectedRegistryId : (next[0]?.id ?? '');
    const nextRegistry = next.find(registry => registry.id === nextId);
    registries = next;
    selectedRegistryId = nextId;
    namespace =
      nextRegistry?.kind === 'quay' ? await physicalAiClient.getDefaultNamespace() : (nextRegistry?.namespace ?? '');
    await loadRepos();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Invalid catalog registry settings';
  }
}

function handleRegistrySettingsUpdated(): void {
  if (active) void refreshRegistryConfig();
}

onDestroy(() => {
  window.removeEventListener('physical-ai-registries-updated', handleRegistrySettingsUpdated);
  for (const timer of pollTimers.values()) {
    window.clearInterval(timer);
  }
});
</script>

<div class="flex flex-col p-4 gap-4 h-full overflow-auto">
  {#if $navigationLayout === 'cards'}
    <button on:click={() => router.goto('/')} class="pai-link self-start"> &larr; Back to Dashboard </button>
  {/if}
  <h1 class="text-3xl text-[var(--pd-content-header)]">Image Catalog</h1>
  {#if $navigationLayout === 'cards'}
    <QuickLinks
      links={[
        { label: 'Image Builder', to: '/build' },
        { label: 'Registry Settings', to: '/registries' },
      ]} />
  {/if}
  <p class="text-sm text-[var(--pd-content-text)]">
    Browse and pull public ROS2 container images from a configured registry. Curated pulls focus on Ubuntu + Jazzy
    sim/base tags; build Fedora bootc 43 + ROS 2 Lyrical sims via <strong>Image Builder &rarr; Customize</strong>.
  </p>
  <p class="text-sm text-[var(--pd-content-text)]">
    <a href="#/registries" class="pai-link">Manage registries in Registry Settings</a>
  </p>

  <div class="flex flex-row gap-3 items-end flex-wrap">
    {#if registries.length > 0}
      <div class="flex flex-col gap-1">
        <label for="registry" class="text-xs text-[var(--pd-content-text)]">Registry</label>
        <select
          id="registry"
          value={selectedRegistryId}
          on:change={event => selectRegistry((event.currentTarget as HTMLSelectElement).value)}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]">
          {#each registries as registry}
            <option value={registry.id}>{registry.displayName} ({registry.host})</option>
          {/each}
        </select>
      </div>
    {/if}
    <div class="flex flex-col gap-1">
      <label for="namespace" class="text-xs text-[var(--pd-content-text)]"
        >{selectedRegistry?.displayName ?? 'Registry'} namespace</label>
      <input
        id="namespace"
        type="text"
        bind:value={namespace}
        class="px-3 py-1.5 text-sm rounded border bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] w-64 {namespaceMissing
          ? 'pai-input-error'
          : 'border-[var(--pd-content-card-border)]'}"
        placeholder="e.g. ecosystem-appeng or library"
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
    <div class="flex flex-row gap-3 items-end flex-wrap">
      <div class="flex flex-col gap-1">
        <label for="curated-override" class="text-xs text-[var(--pd-content-text)]">
          Curated repository patterns for {selectedRegistry?.displayName ?? 'this registry'}
        </label>
        <input
          id="curated-override"
          aria-label="Curated repository patterns"
          bind:value={curatedOverride}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] w-96"
          placeholder={globalCuratedAllowlist} />
      </div>
      <button on:click={saveCuratedOverride} disabled={savingCuratedOverride} class="pai-btn pai-btn-primary">
        {savingCuratedOverride ? 'Saving...' : 'Save curated patterns'}
      </button>
      {#if curatedOverrideSaved}
        <span class="text-xs pai-text-success">Saved for this registry.</span>
      {/if}
      {#if curatedOverrideError}
        <div class="text-xs p-2 rounded pai-banner-error" role="alert">{curatedOverrideError}</div>
      {/if}
    </div>
    <p class="text-xs pai-text-muted">
      Active patterns: <span class="font-mono">{curatedAllowlist}</span>. Leave the override empty to use the default.
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
      <label for="filter" class="text-xs text-[var(--pd-content-text)]">Filter by repository name</label>
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
          All, or adjust the curated patterns above.
          {#if selectedRegistry?.kind === 'quay'}
            Private Quay repositories are not listed because this catalog uses Quay's public API.
          {/if}
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
                <div class="flex flex-col gap-1 mb-3">
                  <label for="tag-filter-{repoKey}" class="text-xs text-[var(--pd-content-text)]">Filter by tag</label>
                  <input
                    id="tag-filter-{repoKey}"
                    type="text"
                    bind:value={tagFilter}
                    class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] w-64"
                    placeholder="e.g. jazzy or latest" />
                </div>
                {#if filteredTags.length === 0}
                  <div class="text-xs text-[var(--pd-content-text)]">No tags match the filter.</div>
                {:else}
                  <table class="w-full text-xs">
                    <thead>
                      <tr
                        class="text-left text-[var(--pd-content-text)] border-b border-[var(--pd-content-card-border)]">
                        <th class="pb-2 pr-4">Tag</th>
                        <th class="pb-2 pr-4">Size</th>
                        <th class="pb-2 pr-4">Last Modified</th>
                        <th class="pb-2 pr-4">Digest</th>
                        <th class="pb-2">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each filteredTags as tag}
                        {@const pullKey = `${repoKey}:${tag.name}`}
                        {@const progress = getProgress(repoKey, tag.name, pullProgress)}
                        {@const tagIsLocal = isLocal(repoKey, tag.name, localImages)}
                        <tr class="border-b border-[var(--pd-content-card-border)] last:border-b-0">
                          <td class="py-2 pr-4 font-medium text-[var(--pd-content-header)]">{tag.name}</td>
                          <td class="py-2 pr-4 text-[var(--pd-content-text)]">{formatSize(tag.size)}</td>
                          <td class="py-2 pr-4 text-[var(--pd-content-text)]">{formatDate(tag.last_modified)}</td>
                          <td class="py-2 pr-4 text-[var(--pd-content-text)] font-mono"
                            >{tag.manifest_digest ? tag.manifest_digest.substring(7, 19) : 'Not reported'}</td>
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
