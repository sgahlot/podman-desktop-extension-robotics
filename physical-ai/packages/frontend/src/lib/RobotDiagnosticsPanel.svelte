<script lang="ts">
import { physicalAiClient } from '../api/client';
import type { TopicInfo } from '/@shared/src/types/TopicInfo';
import type { TfTreeResult, CostmapSummaryResult, LaserScanSummary } from '/@shared/src/types/RobotDiagnostics';
import { deriveRobotNamespaces } from '/@shared/src/ros/robotDiagnostics';

export let containerId: string;
export let topics: TopicInfo[] = [];

let robotName = '';
let refreshing = false;

let tfResult: TfTreeResult | null = null;
let tfError = '';
let costmapResult: CostmapSummaryResult | null = null;
let costmapError = '';
let laserResult: LaserScanSummary | null = null;
let laserError = '';

$: robotOptions = deriveRobotNamespaces(topics);

$: if (robotOptions.length > 0 && !robotOptions.includes(robotName)) {
  robotName = robotOptions[0];
}
$: if (robotOptions.length === 0 && robotName) {
  robotName = '';
}

let lastContainerId = containerId;
$: if (containerId !== lastContainerId) {
  lastContainerId = containerId;
  clearResults();
}

function clearResults(): void {
  tfResult = null;
  tfError = '';
  costmapResult = null;
  costmapError = '';
  laserResult = null;
  laserError = '';
}

function formatCapturedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function occupancyPercent(count: number, total: number): string {
  return total > 0 ? `${((count / total) * 100).toFixed(1)}%` : 'n/a';
}

/**
 * Fans out to three independent blocking execs (Promise.allSettled, not Promise.all) so one
 * idle/failing topic (e.g. the costmap before Navigate has run) never blanks the other two
 * cards. Manual only — no auto-poll: a refresh is up to 6 concurrent blocking execs (4 TF
 * pairs + 2 costmaps) plus the scan peek, too heavy for a 5s poll cadence.
 */
async function refreshDiagnostics(): Promise<void> {
  if (!containerId || !robotName || refreshing) return;
  const targetContainerId = containerId;
  const targetRobot = robotName;
  refreshing = true;

  const [tfSettled, costmapSettled, laserSettled] = await Promise.allSettled([
    physicalAiClient.getTfTreeStatus(targetContainerId, targetRobot),
    physicalAiClient.getCostmapSummary(targetContainerId, targetRobot),
    physicalAiClient.getLaserScanSummary(targetContainerId, targetRobot),
  ]);

  if (containerId !== targetContainerId || robotName !== targetRobot) {
    refreshing = false;
    return;
  }

  if (tfSettled.status === 'fulfilled') {
    tfResult = tfSettled.value;
    tfError = '';
  } else {
    tfResult = null;
    tfError = errorMessage(tfSettled.reason);
  }

  if (costmapSettled.status === 'fulfilled') {
    costmapResult = costmapSettled.value;
    costmapError = '';
  } else {
    costmapResult = null;
    costmapError = errorMessage(costmapSettled.reason);
  }

  if (laserSettled.status === 'fulfilled') {
    laserResult = laserSettled.value;
    laserError = '';
  } else {
    laserResult = null;
    laserError = errorMessage(laserSettled.reason);
  }

  refreshing = false;
}
</script>

<div class="flex flex-col gap-4 min-w-0">
  {#if robotOptions.length === 0}
    <div class="text-sm text-[var(--pd-content-text)]">
      No robot namespace detected yet. Spawn a robot in Simulation, then come back once its topics (<code>scan</code>,
      <code>tf</code>, <code>local_costmap/costmap</code>) appear.
    </div>
  {:else}
    <div class="flex flex-row items-end gap-3 flex-wrap">
      <div class="flex flex-col gap-1">
        <label for="robotSelect" class="text-xs text-[var(--pd-content-text)]">Robot</label>
        <select
          id="robotSelect"
          bind:value={robotName}
          class="px-3 py-1.5 text-sm rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-[var(--pd-content-text)]">
          {#each robotOptions as name}
            <option value={name}>{name}</option>
          {/each}
        </select>
      </div>
      <button on:click={refreshDiagnostics} disabled={refreshing} class="pai-btn pai-btn-primary">
        {refreshing ? 'Refreshing...' : 'Refresh diagnostics'}
      </button>
      <span class="text-xs pai-text-muted">One-shot snapshot, not live — click Refresh to re-capture.</span>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 min-w-0">
      <!-- TF Tree -->
      <div
        class="min-w-0 rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-3 flex flex-col gap-2">
        <div class="text-sm font-medium text-[var(--pd-content-header)]">TF Tree</div>
        {#if tfError}
          <div class="text-xs pai-text-error">{tfError}</div>
        {:else if !tfResult}
          <div class="text-xs pai-text-muted">No snapshot yet.</div>
        {:else}
          <div class="text-xs pai-text-muted">Captured {formatCapturedAt(tfResult.capturedAt)}</div>
          <div class="flex flex-col gap-1.5">
            {#each tfResult.frames as frame}
              <div class="rounded border border-[var(--pd-content-card-border)] p-2 text-xs min-w-0">
                <div class="flex flex-row items-center justify-between gap-2">
                  <span class="font-mono text-[var(--pd-content-text)] break-all"
                    >{frame.parentFrame} &rarr; {frame.childFrame}</span>
                  <span
                    class="shrink-0 px-1.5 py-0.5 rounded text-[10px] {frame.available
                      ? 'pai-text-muted border border-[var(--pd-content-card-border)]'
                      : 'pai-text-error border border-[var(--pd-content-card-border)]'}">
                    {frame.available ? 'available' : 'missing'}
                  </span>
                </div>
                {#if frame.available && frame.translation && frame.rotationQuaternion}
                  <div class="mt-1 font-mono text-[10px] pai-text-muted break-all">
                    t: [{frame.translation.x.toFixed(3)}, {frame.translation.y.toFixed(3)}, {frame.translation.z.toFixed(
                      3,
                    )}]
                  </div>
                  <div class="font-mono text-[10px] pai-text-muted break-all">
                    q: [{frame.rotationQuaternion.x.toFixed(3)}, {frame.rotationQuaternion.y.toFixed(3)}, {frame.rotationQuaternion.z.toFixed(
                      3,
                    )}, {frame.rotationQuaternion.w.toFixed(3)}]
                  </div>
                {:else if frame.error}
                  <div class="mt-1 text-[10px] pai-text-muted break-all">{frame.error}</div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Costmap -->
      <div
        class="min-w-0 rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-3 flex flex-col gap-2">
        <div class="text-sm font-medium text-[var(--pd-content-header)]">Costmap</div>
        {#if costmapError}
          <div class="text-xs pai-text-error">{costmapError}</div>
        {:else if !costmapResult}
          <div class="text-xs pai-text-muted">No snapshot yet.</div>
        {:else}
          {#each [{ label: 'Local', summary: costmapResult.local }, { label: 'Global', summary: costmapResult.global }] as block}
            <div class="rounded border border-[var(--pd-content-card-border)] p-2 text-xs min-w-0">
              <div class="font-medium text-[var(--pd-content-text)]">{block.label}</div>
              {#if !block.summary}
                <div class="pai-text-muted">No data.</div>
              {:else if block.summary.error}
                <div class="{block.summary.timedOut ? 'pai-text-muted' : 'pai-text-error'} break-all">
                  {block.summary.error}
                </div>
              {:else}
                <div class="text-[10px] pai-text-muted">Captured {formatCapturedAt(block.summary.capturedAt)}</div>
                <div class="pai-text-muted">
                  {block.summary.widthCells}&times;{block.summary.heightCells} cells @ {block.summary.resolutionMeters.toFixed(
                    3,
                  )} m/cell
                </div>
                <div class="pai-text-muted">
                  Origin: ({block.summary.originX.toFixed(2)}, {block.summary.originY.toFixed(2)})
                </div>
                <div class="text-[var(--pd-content-text)]">
                  Occupied: {block.summary.occupiedCells} ({occupancyPercent(
                    block.summary.occupiedCells,
                    block.summary.totalCells,
                  )})
                </div>
                <div class="text-[var(--pd-content-text)]">
                  Free: {block.summary.freeCells} ({occupancyPercent(
                    block.summary.freeCells,
                    block.summary.totalCells,
                  )})
                </div>
                <div class="text-[var(--pd-content-text)]">
                  Unknown: {block.summary.unknownCells} ({occupancyPercent(
                    block.summary.unknownCells,
                    block.summary.totalCells,
                  )})
                </div>
              {/if}
            </div>
          {/each}
        {/if}
      </div>

      <!-- Sensor (LaserScan) -->
      <div
        class="min-w-0 rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-3 flex flex-col gap-2">
        <div class="text-sm font-medium text-[var(--pd-content-header)]">Sensor (LaserScan)</div>
        {#if laserError}
          <div class="text-xs pai-text-error">{laserError}</div>
        {:else if !laserResult}
          <div class="text-xs pai-text-muted">No snapshot yet.</div>
        {:else if laserResult.error}
          <div class="text-xs {laserResult.timedOut ? 'pai-text-muted' : 'pai-text-error'} break-all">
            {laserResult.error}
          </div>
        {:else}
          <div class="text-xs pai-text-muted">Captured {formatCapturedAt(laserResult.capturedAt)}</div>
          <div class="text-xs font-mono text-[var(--pd-content-text)] break-all">{laserResult.topic}</div>
          <div class="text-xs pai-text-muted">
            Angle: [{laserResult.angleMinRad.toFixed(3)}, {laserResult.angleMaxRad.toFixed(3)}] rad, step {laserResult.angleIncrementRad.toFixed(
              4,
            )}
          </div>
          <div class="text-xs pai-text-muted">
            Range bounds: [{laserResult.rangeMinMeters.toFixed(2)}, {laserResult.rangeMaxMeters.toFixed(2)}] m
          </div>
          <div class="text-xs text-[var(--pd-content-text)]">
            min {laserResult.minRange?.toFixed(3) ?? 'n/a'} / max {laserResult.maxRange?.toFixed(3) ?? 'n/a'} / mean {laserResult.meanRange?.toFixed(
              3,
            ) ?? 'n/a'} m
          </div>
          <div class="text-xs pai-text-muted">
            {laserResult.finiteCount} finite, {laserResult.infCount} inf, {laserResult.nanCount} nan (of {laserResult.totalCount})
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
