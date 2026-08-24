<script lang="ts">
import {
  BASE_OS_OPTIONS,
  HARDENED_OPTIONS,
  HUMMINGBIRD_APP_OPTIONS,
  ROS_OPTIONS,
  SIM_OPTIONS,
  evaluateStack,
  generateLayerContainerfile,
  type LayerSelection,
} from '/@shared/src/types/layerCompatibility';

let selection: LayerSelection = {
  baseOs: 'ubuntu-noble',
  hardened: 'none',
  ros: 'ros2-jazzy',
  sim: 'gazebo-nav2-tb3',
  hummingbirdApps: [],
};

let attemptAnyway = false;
let buildNotice = '';

$: result = evaluateStack(selection);
$: containerfile = generateLayerContainerfile(selection);
$: baseOsNote = BASE_OS_OPTIONS.find(o => o.id === selection.baseOs)?.note ?? '';
$: hardenedNote = HARDENED_OPTIONS.find(o => o.id === selection.hardened)?.note ?? '';
$: rosNote = ROS_OPTIONS.find(o => o.id === selection.ros)?.note ?? '';
$: simNote = SIM_OPTIONS.find(o => o.id === selection.sim)?.note ?? '';
$: bannerClass =
  result.level === 'ok' ? 'pai-banner-success' : result.level === 'warn' ? 'pai-banner-warning' : 'pai-banner-error';
$: bannerHeadline =
  result.level === 'ok'
    ? '✅ Ready — builds and runs today'
    : result.level === 'warn'
      ? '⚠️ Builds, but not a working robotics image'
      : "❌ Won't build";
$: buildDisabled = result.level === 'blocked' && !attemptAnyway;

// Reset the escape hatch and any stale notice whenever the selection changes so a
// previously-blocked "attempt anyway" choice doesn't silently carry over.
$: (selection, ((attemptAnyway = false), (buildNotice = '')));

// Clear stale Hummingbird app picks when Hummingbird is turned off, without wiping them
// on unrelated selection changes (e.g. toggling ROS while Hummingbird stays selected).
$: if (selection.hardened !== 'hummingbird-app' && (selection.hummingbirdApps?.length ?? 0) > 0) {
  selection.hummingbirdApps = [];
}

function onBuild() {
  buildNotice =
    "Prototype: layer builds aren't wired to a real image build yet. The Containerfile above shows what would be produced once secure bootc/Hummingbird layers are available.";
}
</script>

<div class="flex flex-col gap-4 max-w-2xl">
  <p class="text-xs pai-text-muted">
    Experimental — compose an image from a base OS, hardened, ROS, and simulation layers. Pick any combination; the
    compatibility check tells you whether it will build.
  </p>

  <div class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-4">
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <label for="layer-base-os" class="text-xs text-[var(--pd-content-text)]">Base OS</label>
        <select
          id="layer-base-os"
          bind:value={selection.baseOs}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]">
          {#each BASE_OS_OPTIONS as o}
            <option value={o.id}>{o.label}</option>
          {/each}
        </select>
        <span class="text-xs pai-text-muted">{baseOsNote}</span>
      </div>

      <div class="flex flex-col gap-1">
        <label for="layer-hardened" class="text-xs text-[var(--pd-content-text)]">Hardened app</label>
        <select
          id="layer-hardened"
          bind:value={selection.hardened}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]">
          {#each HARDENED_OPTIONS as o}
            <option value={o.id}>{o.label}</option>
          {/each}
        </select>
        <span class="text-xs pai-text-muted">{hardenedNote}</span>

        {#if selection.hardened === 'hummingbird-app'}
          <div class="flex flex-col gap-1 mt-1 pl-3 border-l border-[var(--pd-content-card-border)]">
            <span class="text-xs text-[var(--pd-content-text)]">Hardened app images</span>
            {#each HUMMINGBIRD_APP_OPTIONS as o}
              <label class="flex flex-row items-center gap-2 text-xs text-[var(--pd-content-text)]">
                <input type="checkbox" bind:group={selection.hummingbirdApps} value={o.id} />
                {o.label}
                <span class="pai-text-muted">— {o.note}</span>
              </label>
            {/each}
          </div>
        {/if}
      </div>

      <div class="flex flex-col gap-1">
        <label for="layer-ros" class="text-xs text-[var(--pd-content-text)]">ROS</label>
        <select
          id="layer-ros"
          bind:value={selection.ros}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]">
          {#each ROS_OPTIONS as o}
            <option value={o.id}>{o.label}</option>
          {/each}
        </select>
        <span class="text-xs pai-text-muted">{rosNote}</span>
      </div>

      <div class="flex flex-col gap-1">
        <label for="layer-sim" class="text-xs text-[var(--pd-content-text)]">Simulation</label>
        <select
          id="layer-sim"
          bind:value={selection.sim}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)]">
          {#each SIM_OPTIONS as o}
            <option value={o.id}>{o.label}</option>
          {/each}
        </select>
        <span class="text-xs pai-text-muted">{simNote}</span>
      </div>
    </div>
  </div>

  <div class="text-sm p-3 rounded {bannerClass}" role="status">
    <p class="font-medium">{bannerHeadline}</p>
    {#if result.messages.length > 0}
      <ul class="list-disc list-inside mt-1">
        {#each result.messages as message}
          <li>{message.text}</li>
        {/each}
      </ul>
    {/if}
    {#if result.level === 'blocked' && result.failsAtStep}
      <p class="text-xs mt-1">Fails at build step: {result.failsAtStep}</p>
    {/if}
  </div>

  <div class="flex flex-col gap-1">
    <h3 class="text-sm font-medium text-[var(--pd-content-header)]">Generated Containerfile (preview)</h3>
    <pre
      class="text-xs font-mono p-3 rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] overflow-auto max-h-64">{containerfile}</pre>
  </div>

  <div class="flex flex-col gap-2">
    {#if result.level === 'blocked'}
      <label class="flex flex-row items-center gap-2 text-xs text-[var(--pd-content-text)]">
        <input type="checkbox" bind:checked={attemptAnyway} />
        Attempt anyway — I understand this won't build
      </label>
    {/if}
    <button type="button" class="pai-btn pai-btn-primary self-start" disabled={buildDisabled} on:click={onBuild}>
      Build image
    </button>
    {#if buildNotice}
      <div class="text-sm p-3 rounded pai-banner-info">{buildNotice}</div>
    {/if}
  </div>
</div>
