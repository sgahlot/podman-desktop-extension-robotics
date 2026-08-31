<script lang="ts">
import { onMount } from 'svelte';
import { physicalAiClient } from '../api/client';
import type { TfTreeResult, CostmapSummaryResult, LaserScanSummary } from '/@shared/src/types/RobotDiagnostics';
import { deriveRobotNamespaces } from '/@shared/src/ros/robotDiagnostics';
import {
  tfTreeVerdict,
  costmapVerdict,
  laserScanVerdict,
  type VerdictLevel,
} from '/@shared/src/ros/robotDiagnosticsVerdict';
import type { DiagnosticsTarget } from './RobotDiagnosticsPanel.types';
import { getCachedDiagnostics, setCachedDiagnostics } from './robotDiagnosticsCache';

export let target: DiagnosticsTarget;
/** Pre-selects a robot on arrival (deep link from Simulation's Diagnose button), without
 * triggering any automatic fetch — a Refresh click is still required, matching this
 * feature's "always manual" invariant everywhere else. */
export let initialRobotName: string | undefined = undefined;

let robotName = '';
let refreshing = false;

let tfResult: TfTreeResult | null = null;
let tfError = '';
let costmapResult: CostmapSummaryResult | null = null;
let costmapError = '';
let laserResult: LaserScanSummary | null = null;
let laserError = '';

// `ros2 node list` (same signal APPENG-6250 uses to reconcile the Simulation page's robot
// state) registers a spawned robot's nodes almost immediately — well before Nav2 finishes
// bringing up the topics (scan/tf/costmaps) deriveRobotNamespaces looks for, which can take
// 40-90s under software rendering. Union both (plus initialRobotName) so the picker isn't
// empty for that whole window, and a deep-linked robot is selectable immediately regardless
// of whether either fetch has completed yet.
let spawnedRobotNames: string[] = [];

$: robotOptions = Array.from(
  new Set([
    ...spawnedRobotNames,
    ...(target.kind === 'podman' ? deriveRobotNamespaces(target.topics) : []),
    ...(initialRobotName ? [initialRobotName] : []),
  ]),
).sort();

$: if (robotOptions.length > 0 && !robotOptions.includes(robotName)) {
  robotName = initialRobotName && robotOptions.includes(initialRobotName) ? initialRobotName : robotOptions[0];
}
$: if (robotOptions.length === 0 && robotName) {
  robotName = '';
}

/** Stable identity for `target`, used to detect a real target change (vs. a same-target
 * re-render) without relying on object identity. */
function targetKey(t: DiagnosticsTarget): string {
  return t.kind === 'podman' ? `podman:${t.containerId}` : `oc:${t.namespace}/${t.workload}/${t.context ?? ''}`;
}

async function fetchSpawnedRobots(): Promise<void> {
  try {
    if (target.kind === 'podman') {
      if (!target.containerId) {
        spawnedRobotNames = [];
        return;
      }
      spawnedRobotNames = await physicalAiClient.listSpawnedRobotsInSimulation(target.containerId);
    } else {
      spawnedRobotNames = await physicalAiClient.listSpawnedRobotsInOpenShift(
        target.namespace,
        target.workload,
        target.context,
      );
    }
  } catch {
    // Fail-soft: keep the last-known list rather than blanking the picker on a transient RPC hiccup.
  }
}

onMount(() => {
  fetchSpawnedRobots();
});

let lastTargetKey = targetKey(target);
$: if (targetKey(target) !== lastTargetKey) {
  lastTargetKey = targetKey(target);
  fetchSpawnedRobots();
}

function clearResults(): void {
  tfResult = null;
  tfError = '';
  costmapResult = null;
  costmapError = '';
  laserResult = null;
  laserError = '';
}

/**
 * Rehydrates from the last "Refresh diagnostics" result for this target+robot (if any) whenever
 * the selected robot or target changes — e.g. navigating away from and back to this page, or
 * switching robots — instead of showing a blank "no snapshot yet" state again. Read-only: never
 * fetches, so it doesn't touch the always-manual-refresh invariant.
 */
let lastHydratedKey = '';
$: {
  const key = robotName ? `${targetKey(target)}::${robotName}` : '';
  if (key !== lastHydratedKey) {
    lastHydratedKey = key;
    const cached = robotName ? getCachedDiagnostics(targetKey(target), robotName) : undefined;
    if (cached) {
      tfResult = cached.tfResult;
      tfError = cached.tfError;
      costmapResult = cached.costmapResult;
      costmapError = cached.costmapError;
      laserResult = cached.laserResult;
      laserError = cached.laserError;
    } else {
      clearResults();
    }
  }
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

function verdictClass(level: VerdictLevel): string {
  if (level === 'error') return 'pai-text-error';
  if (level === 'warning') return 'pai-text-warning';
  return 'pai-text-success';
}

$: tfVerdict = tfResult ? tfTreeVerdict(tfResult) : null;
$: costmapVerdictResult = costmapResult ? costmapVerdict(costmapResult) : null;
$: laserVerdict = laserResult ? laserScanVerdict(laserResult) : null;

/**
 * Fans out to three independent blocking execs (Promise.allSettled, not Promise.all) so one
 * idle/failing topic (e.g. the costmap before Navigate has run) never blanks the other two
 * cards. Manual only — no auto-poll: a refresh is up to 6 blocking execs (4 TF pairs run
 * sequentially + 2 costmaps) plus the scan peek, too heavy to fire automatically.
 */
async function refreshDiagnostics(): Promise<void> {
  if (!robotName || refreshing) return;
  const snapshotKey = targetKey(target);
  const targetSnapshot = target;
  const targetRobot = robotName;
  refreshing = true;

  const calls: [Promise<TfTreeResult>, Promise<CostmapSummaryResult>, Promise<LaserScanSummary>] =
    targetSnapshot.kind === 'podman'
      ? [
          physicalAiClient.getTfTreeStatus(targetSnapshot.containerId, targetRobot),
          physicalAiClient.getCostmapSummary(targetSnapshot.containerId, targetRobot),
          physicalAiClient.getLaserScanSummary(targetSnapshot.containerId, targetRobot),
        ]
      : [
          physicalAiClient.getTfTreeStatusInOpenShift(
            targetSnapshot.namespace,
            targetSnapshot.workload,
            targetRobot,
            targetSnapshot.context,
          ),
          physicalAiClient.getCostmapSummaryInOpenShift(
            targetSnapshot.namespace,
            targetSnapshot.workload,
            targetRobot,
            targetSnapshot.context,
          ),
          physicalAiClient.getLaserScanSummaryInOpenShift(
            targetSnapshot.namespace,
            targetSnapshot.workload,
            targetRobot,
            targetSnapshot.context,
          ),
        ];

  const [tfSettled, costmapSettled, laserSettled] = await Promise.allSettled(calls);

  if (targetKey(target) !== snapshotKey || robotName !== targetRobot) {
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

  setCachedDiagnostics(snapshotKey, targetRobot, {
    tfResult,
    tfError,
    costmapResult,
    costmapError,
    laserResult,
    laserError,
  });
  refreshing = false;
}
</script>

<div class="flex flex-col gap-4 min-w-0">
  {#if robotOptions.length === 0}
    <div class="text-sm text-[var(--pd-content-text)]">
      No robot detected yet. Spawn a robot in Simulation — it should appear here within a few seconds.
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
    <div class="text-xs pai-text-muted">
      A newly-spawned robot can show "missing"/timed-out cards for up to ~90s while Nav2 finishes starting — that's
      expected, not an error. Click Refresh again once it's warmed up.
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 min-w-0">
      <!-- TF Tree -->
      <div
        class="min-w-0 rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-3 flex flex-col gap-2">
        <div class="text-sm font-medium text-[var(--pd-content-header)]">TF Tree</div>
        {#if tfError}
          <div class="text-xs pai-text-error">{tfError}</div>
        {:else if !tfResult || !tfVerdict}
          <div class="text-xs pai-text-muted">No snapshot yet.</div>
        {:else}
          <div class="text-sm font-medium {verdictClass(tfVerdict.level)}">{tfVerdict.headline}</div>
          {#if tfVerdict.detail}
            <div class="text-xs pai-text-muted break-all">{tfVerdict.detail}</div>
          {/if}
          <details>
            <summary class="text-xs pai-link cursor-pointer w-fit">Details</summary>
            <div class="text-xs pai-text-muted mt-1">Captured {formatCapturedAt(tfResult.capturedAt)}</div>
            <div class="flex flex-col gap-1.5 mt-1">
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
          </details>
        {/if}
      </div>

      <!-- Costmap -->
      <div
        class="min-w-0 rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-3 flex flex-col gap-2">
        <div class="text-sm font-medium text-[var(--pd-content-header)]">Costmap</div>
        {#if costmapError}
          <div class="text-xs pai-text-error">{costmapError}</div>
        {:else if !costmapResult || !costmapVerdictResult}
          <div class="text-xs pai-text-muted">No snapshot yet.</div>
        {:else}
          <div class="text-sm font-medium {verdictClass(costmapVerdictResult.level)}">
            {costmapVerdictResult.headline}
          </div>
          {#if costmapVerdictResult.detail}
            <div class="text-xs pai-text-muted break-all">{costmapVerdictResult.detail}</div>
          {/if}
          <details>
            <summary class="text-xs pai-link cursor-pointer w-fit">Details</summary>
            <div class="flex flex-col gap-2 mt-1">
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
            </div>
          </details>
        {/if}
      </div>

      <!-- Sensor (LaserScan) -->
      <div
        class="min-w-0 rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] p-3 flex flex-col gap-2">
        <div class="text-sm font-medium text-[var(--pd-content-header)]">Sensor (LaserScan)</div>
        {#if laserError}
          <div class="text-xs pai-text-error">{laserError}</div>
        {:else if !laserResult || !laserVerdict}
          <div class="text-xs pai-text-muted">No snapshot yet.</div>
        {:else}
          <div class="text-sm font-medium {verdictClass(laserVerdict.level)}">{laserVerdict.headline}</div>
          {#if laserVerdict.detail}
            <div class="text-xs pai-text-muted break-all">{laserVerdict.detail}</div>
          {/if}
          {#if !laserResult.error}
            <details>
              <summary class="text-xs pai-link cursor-pointer w-fit">Details</summary>
              <div class="flex flex-col gap-1 mt-1">
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
                  min {laserResult.minRange?.toFixed(3) ?? 'n/a'} / max {laserResult.maxRange?.toFixed(3) ?? 'n/a'} / mean
                  {laserResult.meanRange?.toFixed(3) ?? 'n/a'} m
                </div>
                <div class="text-xs pai-text-muted">
                  {laserResult.finiteCount} finite, {laserResult.infCount} inf, {laserResult.nanCount} nan (of {laserResult.totalCount})
                </div>
              </div>
            </details>
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</div>
