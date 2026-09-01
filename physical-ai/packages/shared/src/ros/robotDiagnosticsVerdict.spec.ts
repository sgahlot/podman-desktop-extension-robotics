import { describe, it, expect } from 'vitest';
import {
  tfTreeVerdict,
  costmapVerdict,
  laserScanVerdict,
  MOSTLY_UNEXPLORED_PCT,
  HIGH_OCCUPIED_PCT,
  NAN_DEGRADED_RATIO,
  BAD_WARNING_RATIO,
} from './robotDiagnosticsVerdict';
import type {
  CostmapSummaryResult,
  LaserScanSummary,
  OccupancyGridSummary,
  TfTreeResult,
} from '../types/RobotDiagnostics';

function tfResult(
  overrides: Partial<Record<'map->odom' | 'odom->bf' | 'bf->bl' | 'bl->bs', boolean>> = {},
): TfTreeResult {
  const available = {
    'map->odom': true,
    'odom->bf': true,
    'bf->bl': true,
    'bl->bs': true,
    ...overrides,
  };
  return {
    robotNamespace: 'robot_1',
    capturedAt: '2026-01-01T00:00:00.000Z',
    frames: [
      { parentFrame: 'map', childFrame: 'odom', available: available['map->odom'], error: 'map->odom error' },
      { parentFrame: 'odom', childFrame: 'base_footprint', available: available['odom->bf'], error: 'odom->bf error' },
      { parentFrame: 'base_footprint', childFrame: 'base_link', available: available['bf->bl'] },
      { parentFrame: 'base_link', childFrame: 'base_scan', available: available['bl->bs'] },
    ],
  };
}

describe('tfTreeVerdict', () => {
  it('is an error when map->odom is missing, carrying the raw error as detail', () => {
    const verdict = tfTreeVerdict(tfResult({ 'map->odom': false }));
    expect(verdict.level).toBe('error');
    expect(verdict.headline).toMatch(/localization lost/i);
    expect(verdict.detail).toBe('map->odom error');
  });

  it('is a warning naming the specific missing pair when map->odom is fine', () => {
    const verdict = tfTreeVerdict(tfResult({ 'odom->bf': false }));
    expect(verdict.level).toBe('warning');
    expect(verdict.headline).toContain('odom');
    expect(verdict.headline).toContain('base_footprint');
    expect(verdict.detail).toBe('odom->bf error');
  });

  it('is ok when all four pairs are available', () => {
    const verdict = tfTreeVerdict(tfResult());
    expect(verdict.level).toBe('ok');
    expect(verdict.headline).toMatch(/localization ok/i);
  });
});

function occupancyGrid(overrides: Partial<OccupancyGridSummary> = {}): OccupancyGridSummary {
  return {
    topic: '/robot_1/global_costmap/costmap',
    widthCells: 10,
    heightCells: 10,
    resolutionMeters: 0.05,
    originX: 0,
    originY: 0,
    occupiedCells: 10,
    freeCells: 80,
    unknownCells: 10,
    totalCells: 100,
    capturedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('costmapVerdict', () => {
  it('is an error when the global costmap is missing', () => {
    const result: CostmapSummaryResult = {};
    const verdict = costmapVerdict(result);
    expect(verdict.level).toBe('error');
  });

  it('is a warning when the global costmap timed out', () => {
    const result: CostmapSummaryResult = {
      global: occupancyGrid({ timedOut: true, error: 'No message on topic within 5s.' }),
    };
    const verdict = costmapVerdict(result);
    expect(verdict.level).toBe('warning');
    expect(verdict.headline).toMatch(/not available yet/i);
    expect(verdict.detail).toBe('No message on topic within 5s.');
  });

  it('is an error when the global costmap failed for a reason other than a timeout', () => {
    const result: CostmapSummaryResult = { global: occupancyGrid({ error: 'boom' }) };
    const verdict = costmapVerdict(result);
    expect(verdict.level).toBe('error');
    expect(verdict.detail).toBe('boom');
  });

  it('is ok with softened wording when the map is mostly unexplored, without claiming a recent spawn', () => {
    const totalCells = 100;
    const unknownCells = MOSTLY_UNEXPLORED_PCT + 1;
    const result: CostmapSummaryResult = {
      global: occupancyGrid({ totalCells, unknownCells, occupiedCells: 0, freeCells: totalCells - unknownCells }),
    };
    const verdict = costmapVerdict(result);
    expect(verdict.level).toBe('ok');
    expect(verdict.headline).toMatch(/unexplored/i);
    expect(verdict.headline).not.toMatch(/just spawned/i);
  });

  it('is a warning when obstacle coverage is unusually high', () => {
    const totalCells = 100;
    const occupiedCells = HIGH_OCCUPIED_PCT + 1;
    const result: CostmapSummaryResult = {
      global: occupancyGrid({ totalCells, occupiedCells, unknownCells: 0, freeCells: totalCells - occupiedCells }),
    };
    const verdict = costmapVerdict(result);
    expect(verdict.level).toBe('warning');
    expect(verdict.headline).toMatch(/obstacle coverage/i);
  });

  it('is ok for a normal mix of occupied/free/unknown cells', () => {
    const result: CostmapSummaryResult = {
      global: occupancyGrid({ totalCells: 100, occupiedCells: 10, freeCells: 80, unknownCells: 10 }),
    };
    const verdict = costmapVerdict(result);
    expect(verdict.level).toBe('ok');
    expect(verdict.headline).toMatch(/normal/i);
  });
});

function laserScan(overrides: Partial<LaserScanSummary> = {}): LaserScanSummary {
  return {
    topic: '/robot_1/scan',
    angleMinRad: 0,
    angleMaxRad: 6.28,
    angleIncrementRad: 0.017,
    rangeMinMeters: 0.1,
    rangeMaxMeters: 20,
    finiteCount: 100,
    infCount: 0,
    nanCount: 0,
    totalCount: 100,
    capturedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('laserScanVerdict', () => {
  it('is a warning when the scan timed out', () => {
    const verdict = laserScanVerdict(laserScan({ timedOut: true, error: 'No message on topic within 5s.' }));
    expect(verdict.level).toBe('warning');
    expect(verdict.detail).toBe('No message on topic within 5s.');
  });

  it('is an error when the scan failed for a reason other than a timeout', () => {
    const verdict = laserScanVerdict(laserScan({ error: 'boom' }));
    expect(verdict.level).toBe('error');
    expect(verdict.detail).toBe('boom');
  });

  it('is an error when the NaN ratio is above the degraded threshold', () => {
    const totalCount = 100;
    const nanCount = Math.ceil(NAN_DEGRADED_RATIO * totalCount) + 1;
    const verdict = laserScanVerdict(
      laserScan({ totalCount, nanCount, infCount: 0, finiteCount: totalCount - nanCount }),
    );
    expect(verdict.level).toBe('error');
    expect(verdict.headline).toMatch(/nan/i);
  });

  it('is a warning (not error) when readings are mostly inf rather than nan, above the bad-ratio threshold', () => {
    const totalCount = 100;
    const infCount = Math.ceil(BAD_WARNING_RATIO * totalCount) + 1;
    const verdict = laserScanVerdict(
      laserScan({ totalCount, infCount, nanCount: 0, finiteCount: totalCount - infCount }),
    );
    expect(verdict.level).toBe('warning');
    expect(verdict.headline).toMatch(/out-of-range|invalid/i);
  });

  it('is ok for a normal scan', () => {
    const verdict = laserScanVerdict(laserScan());
    expect(verdict.level).toBe('ok');
    expect(verdict.headline).toMatch(/normal/i);
  });
});
