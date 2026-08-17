<script lang="ts" context="module">
import type { Nav2WarmStatus } from '/@shared/src/types/NavigationGoalResult';

export type RobotEntry = {
  name: string;
  x: string;
  y: string;
  navStatus: 'idle' | 'navigating' | 'reached' | 'failed';
  navTarget: { x: string; y: string };
  navReached: { x: string; y: string } | null;
  /** Nav2 pre-warm state, polled by the parent; drives the "warming…/ready" badge. */
  warmStatus?: Nav2WarmStatus;
};
</script>

<script lang="ts">
/**
 * Shared robot spawn + navigate + remove controls, used by both the Local and
 * OpenShift simulation tabs. The parent owns the `robots` list (so it can reset
 * it when the sim stops / a deployment is deleted) and supplies the async
 * callbacks that do the actual API work; this component owns the spawn form and
 * the transient per-row UI state.
 */
export let robots: RobotEntry[];
/** Do the spawn API call + append the new robot to `robots`. Throws on failure. */
export let onSpawn: (form: { name: string; x: string; y: string; yaw: string }) => Promise<void>;
/** Do the navigate API call for robots[index] and update its navStatus. */
export let onNavigate: (index: number) => Promise<void>;
/** Do the despawn API call for robots[index] and remove it from `robots`. Throws on failure. */
export let onRemove: (index: number) => Promise<void>;
export let disabled = false;
export let spawnLabel = 'Spawn';
export let idPrefix = 'rc';
export let initialName = 'robot_1';
export let initialX = '-2.0';
export let initialY = '-0.5';
export let initialYaw = '0.0';

let form = { name: initialName, x: initialX, y: initialY, yaw: initialYaw };
let counter = startCounter(initialName);
let spawning = false;
let spawnError = '';
let removing: Record<string, boolean> = {};

function startCounter(n: string): number {
  const m = /^robot_(\d+)$/.exec(n);
  return m ? Number(m[1]) : 1;
}

/** Suggest the next free `robot_N`, skipping names already taken. */
function nextFreeName(justSpawned: string): string {
  const taken = new Set([...robots.map(r => r.name), justSpawned]);
  let c = counter;
  do {
    c += 1;
  } while (taken.has(`robot_${c}`));
  counter = c;
  return `robot_${c}`;
}

async function spawn() {
  if (disabled || spawning || !form.name) return;
  if (robots.some(r => r.name === form.name)) {
    spawnError = `A robot named "${form.name}" already exists.`;
    return;
  }
  spawning = true;
  spawnError = '';
  const justSpawned = form.name;
  try {
    await onSpawn({ ...form });
    form = { ...form, name: nextFreeName(justSpawned) };
  } catch (e) {
    spawnError = e instanceof Error ? e.message : String(e);
  } finally {
    spawning = false;
  }
}

async function navigate(index: number) {
  const robot = robots[index];
  if (!robot || robot.navStatus === 'navigating') return;
  try {
    await onNavigate(index);
  } catch {
    // Parent is responsible for reflecting the failure in navStatus.
  }
}

async function remove(index: number) {
  const robot = robots[index];
  if (!robot || robot.navStatus === 'navigating') return;
  removing[robot.name] = true;
  removing = removing;
  spawnError = '';
  try {
    await onRemove(index);
  } catch (e) {
    spawnError = e instanceof Error ? e.message : String(e);
  } finally {
    removing[robot.name] = false;
    removing = removing;
  }
}
</script>

<div class="flex flex-col gap-2">
  <!-- Spawn form -->
  <div class="flex flex-row flex-wrap items-end gap-2">
    <div class="flex flex-col gap-1">
      <label for="{idPrefix}-name" class="text-xs pai-text-muted">Name</label>
      <input
        id="{idPrefix}-name"
        bind:value={form.name}
        disabled={disabled || spawning}
        class="w-28 px-2 py-1 text-xs rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] font-mono" />
    </div>
    <div class="flex flex-col gap-1">
      <label for="{idPrefix}-x" class="text-xs pai-text-muted">X</label>
      <input
        id="{idPrefix}-x"
        bind:value={form.x}
        disabled={disabled || spawning}
        class="w-16 px-2 py-1 text-xs rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] font-mono" />
    </div>
    <div class="flex flex-col gap-1">
      <label for="{idPrefix}-y" class="text-xs pai-text-muted">Y</label>
      <input
        id="{idPrefix}-y"
        bind:value={form.y}
        disabled={disabled || spawning}
        class="w-16 px-2 py-1 text-xs rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] font-mono" />
    </div>
    <div class="flex flex-col gap-1">
      <label for="{idPrefix}-yaw" class="text-xs pai-text-muted">Yaw</label>
      <input
        id="{idPrefix}-yaw"
        bind:value={form.yaw}
        disabled={disabled || spawning}
        class="w-16 px-2 py-1 text-xs rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] font-mono" />
    </div>
    <button on:click={spawn} disabled={disabled || spawning || !form.name} class="pai-btn pai-btn-primary text-xs">
      {spawning ? 'Spawning…' : spawnLabel}
    </button>
  </div>

  {#if spawnError}
    <span class="text-xs pai-text-error">{spawnError}</span>
  {/if}

  {#if robots.length > 0}
    <div class="flex flex-col gap-1">
      {#each robots as robot, i (robot.name)}
        <div
          class="flex flex-row flex-wrap items-center gap-2 text-xs rounded border border-[var(--pd-content-card-border)] p-2">
          <span class="font-mono font-medium text-[var(--pd-content-header)]">{robot.name}</span>
          <span class="pai-text-muted">spawned at ({robot.x}, {robot.y})</span>
          {#if robot.warmStatus === 'warming'}
            <span
              class="inline-flex items-center gap-1 pai-text-accent"
              title="Nav2 is starting in the background; Navigate will fire as soon as it's ready.">
              <span class="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse"></span>
              Nav2 warming…
            </span>
          {:else if robot.warmStatus === 'ready'}
            <span
              class="inline-flex items-center gap-1 pai-text-success"
              title="Nav2 is up; the first Navigate is instant.">
              <span class="inline-block w-1.5 h-1.5 rounded-full bg-current"></span>
              Nav2 ready
            </span>
          {/if}
          <span class="pai-text-muted">→</span>
          <input
            aria-label="target X for {robot.name}"
            bind:value={robot.navTarget.x}
            disabled={robot.navStatus === 'navigating'}
            class="w-14 px-2 py-1 rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] font-mono" />
          <input
            aria-label="target Y for {robot.name}"
            bind:value={robot.navTarget.y}
            disabled={robot.navStatus === 'navigating'}
            class="w-14 px-2 py-1 rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] text-[var(--pd-content-text)] font-mono" />
          <button
            on:click={() => navigate(i)}
            disabled={robot.navStatus === 'navigating'}
            class="pai-btn pai-btn-primary text-xs">
            Navigate
          </button>
          <button
            on:click={() => remove(i)}
            disabled={removing[robot.name] || robot.navStatus === 'navigating'}
            class="pai-btn pai-btn-danger text-xs">
            {removing[robot.name] ? 'Removing…' : 'Remove'}
          </button>
          <span
            class={robot.navStatus === 'reached'
              ? 'pai-text-success'
              : robot.navStatus === 'failed'
                ? 'pai-text-error'
                : robot.navStatus === 'navigating'
                  ? 'pai-text-accent'
                  : 'pai-text-muted'}>
            {robot.navStatus === 'navigating'
              ? robot.warmStatus === 'warming'
                ? 'Waiting for Nav2…'
                : 'Navigating…'
              : robot.navStatus === 'reached'
                ? robot.navReached
                  ? `Reached (${robot.navReached.x}, ${robot.navReached.y})`
                  : 'Reached'
                : robot.navStatus === 'failed'
                  ? 'Failed'
                  : 'Idle'}
          </span>
        </div>
      {/each}
    </div>
  {/if}
</div>
