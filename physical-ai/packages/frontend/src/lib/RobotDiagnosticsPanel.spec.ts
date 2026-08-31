import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import RobotDiagnosticsPanel from './RobotDiagnosticsPanel.svelte';
import type { TopicInfo } from '/@shared/src/types/TopicInfo';
import type { DiagnosticsTarget } from './RobotDiagnosticsPanel.types';

const mockGetTfTreeStatus = vi.fn();
const mockGetCostmapSummary = vi.fn();
const mockGetLaserScanSummary = vi.fn();
const mockListSpawnedRobotsInSimulation = vi.fn();
const mockGetTfTreeStatusInOpenShift = vi.fn();
const mockGetCostmapSummaryInOpenShift = vi.fn();
const mockGetLaserScanSummaryInOpenShift = vi.fn();
const mockListSpawnedRobotsInOpenShift = vi.fn();

vi.mock('../api/client', () => ({
  physicalAiClient: {
    getTfTreeStatus: (...args: unknown[]) => mockGetTfTreeStatus(...args),
    getCostmapSummary: (...args: unknown[]) => mockGetCostmapSummary(...args),
    getLaserScanSummary: (...args: unknown[]) => mockGetLaserScanSummary(...args),
    listSpawnedRobotsInSimulation: (...args: unknown[]) => mockListSpawnedRobotsInSimulation(...args),
    getTfTreeStatusInOpenShift: (...args: unknown[]) => mockGetTfTreeStatusInOpenShift(...args),
    getCostmapSummaryInOpenShift: (...args: unknown[]) => mockGetCostmapSummaryInOpenShift(...args),
    getLaserScanSummaryInOpenShift: (...args: unknown[]) => mockGetLaserScanSummaryInOpenShift(...args),
    listSpawnedRobotsInOpenShift: (...args: unknown[]) => mockListSpawnedRobotsInOpenShift(...args),
  },
}));

const SCAN_TOPICS: TopicInfo[] = [
  { name: '/robot_1/scan', type: 'sensor_msgs/msg/LaserScan', publishers: 1, subscribers: 0 },
  { name: '/robot_1/tf', type: 'tf2_msgs/msg/TFMessage', publishers: 1, subscribers: 1 },
  { name: '/robot_2/scan', type: 'sensor_msgs/msg/LaserScan', publishers: 1, subscribers: 0 },
];

function podmanTarget(topics: TopicInfo[] = []): DiagnosticsTarget {
  return { kind: 'podman', containerId: 'c1', topics };
}

function ocTarget(context?: string): DiagnosticsTarget {
  return { kind: 'oc', namespace: 'ns1', workload: 'ros2-jazzy-sim', context };
}

const TF_RESULT = {
  robotNamespace: 'robot_1',
  capturedAt: new Date().toISOString(),
  frames: [
    {
      parentFrame: 'map',
      childFrame: 'odom',
      available: true,
      translation: { x: 1, y: 2, z: 0 },
      rotationQuaternion: { x: 0, y: 0, z: 0, w: 1 },
    },
    { parentFrame: 'odom', childFrame: 'base_footprint', available: false, error: 'Invalid frame ID' },
    { parentFrame: 'base_footprint', childFrame: 'base_link', available: true },
    { parentFrame: 'base_link', childFrame: 'base_scan', available: true },
  ],
};

const COSTMAP_RESULT = {
  local: {
    topic: '/robot_1/local_costmap/costmap',
    widthCells: 60,
    heightCells: 60,
    resolutionMeters: 0.05,
    originX: 1,
    originY: 2,
    occupiedCells: 10,
    freeCells: 3590,
    unknownCells: 0,
    totalCells: 3600,
    capturedAt: new Date().toISOString(),
  },
  global: {
    topic: '/robot_1/global_costmap/costmap',
    widthCells: 0,
    heightCells: 0,
    resolutionMeters: 0,
    originX: 0,
    originY: 0,
    occupiedCells: 0,
    freeCells: 0,
    unknownCells: 0,
    totalCells: 0,
    capturedAt: new Date().toISOString(),
    timedOut: true,
    error: 'No message on /robot_1/global_costmap/costmap within 5s.',
  },
};

const LASER_RESULT = {
  topic: '/robot_1/scan',
  angleMinRad: 0,
  angleMaxRad: 6.28,
  angleIncrementRad: 0.017,
  rangeMinMeters: 0.1,
  rangeMaxMeters: 20,
  minRange: 0.3,
  maxRange: 0.5,
  meanRange: 0.4,
  finiteCount: 358,
  infCount: 2,
  nanCount: 0,
  totalCount: 360,
  capturedAt: new Date().toISOString(),
};

describe('RobotDiagnosticsPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetTfTreeStatus.mockResolvedValue(TF_RESULT);
    mockGetCostmapSummary.mockResolvedValue(COSTMAP_RESULT);
    mockGetLaserScanSummary.mockResolvedValue(LASER_RESULT);
    mockListSpawnedRobotsInSimulation.mockResolvedValue([]);
    mockGetTfTreeStatusInOpenShift.mockResolvedValue(TF_RESULT);
    mockGetCostmapSummaryInOpenShift.mockResolvedValue(COSTMAP_RESULT);
    mockGetLaserScanSummaryInOpenShift.mockResolvedValue(LASER_RESULT);
    mockListSpawnedRobotsInOpenShift.mockResolvedValue([]);
  });

  it('shows an empty state and no robot picker when no robot is detected', async () => {
    render(RobotDiagnosticsPanel, { props: { target: podmanTarget([]) } });
    await waitFor(() => expect(mockListSpawnedRobotsInSimulation).toHaveBeenCalledWith('c1'));
    expect(screen.getByText(/No robot detected yet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refresh diagnostics' })).toBeNull();
  });

  it('derives robot options from topics and auto-selects the first', () => {
    render(RobotDiagnosticsPanel, { props: { target: podmanTarget(SCAN_TOPICS) } });
    const select = screen.getByLabelText('Robot') as HTMLSelectElement;
    expect([...select.options].map(o => o.value)).toEqual(['robot_1', 'robot_2']);
    expect(select.value).toBe('robot_1');
  });

  it('detects a robot via the node-list probe even before its topics (scan/tf/costmaps) appear', async () => {
    // Reproduces the bug: right after spawn, Nav2 hasn't brought up scan/tf/costmap topics
    // yet (topics is empty/incomplete), but `ros2 node list` already sees the robot's nodes.
    mockListSpawnedRobotsInSimulation.mockResolvedValue(['robot_1']);
    render(RobotDiagnosticsPanel, { props: { target: podmanTarget([]) } });

    const select = await screen.findByLabelText('Robot');
    expect((select as HTMLSelectElement).value).toBe('robot_1');
  });

  it('pre-selects initialRobotName immediately, independent of any fetch completing', () => {
    mockListSpawnedRobotsInSimulation.mockReturnValue(new Promise(() => {})); // never resolves
    render(RobotDiagnosticsPanel, { props: { target: podmanTarget([]), initialRobotName: 'robot_9' } });

    const select = screen.getByLabelText('Robot') as HTMLSelectElement;
    expect([...select.options].map(o => o.value)).toEqual(['robot_9']);
    expect(select.value).toBe('robot_9');
  });

  it('fetches all three diagnostics for the selected robot on Refresh and renders all three cards', async () => {
    render(RobotDiagnosticsPanel, { props: { target: podmanTarget(SCAN_TOPICS) } });

    // No auto-fetch on mount/robot-selection — diagnostics are manual-refresh only, never polled.
    expect(mockGetTfTreeStatus).not.toHaveBeenCalled();
    expect(mockGetCostmapSummary).not.toHaveBeenCalled();
    expect(mockGetLaserScanSummary).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Refresh diagnostics' }));

    expect(mockGetTfTreeStatus).toHaveBeenCalledWith('c1', 'robot_1');
    expect(mockGetCostmapSummary).toHaveBeenCalledWith('c1', 'robot_1');
    expect(mockGetLaserScanSummary).toHaveBeenCalledWith('c1', 'robot_1');

    // Verdict headlines render above the (collapsed) raw details.
    expect(await screen.findByText(/odom.*base_footprint is missing/)).toBeTruthy();
    expect(screen.getByText(/Global map not available yet/)).toBeTruthy();
    expect(screen.getByText(/Laser scan looks normal/)).toBeTruthy();

    await fireEvent.click(screen.getAllByText('Details')[0]);
    expect(screen.getByText('map → odom')).toBeTruthy();
    expect(screen.getByText('odom → base_footprint')).toBeTruthy();
    expect(screen.getAllByText('available').length).toBe(3);
    expect(screen.getByText('missing')).toBeTruthy();
  });

  it('does not blank the other cards when one RPC rejects (allSettled behavior)', async () => {
    mockGetCostmapSummary.mockRejectedValue(new Error('costmap exec failed'));

    render(RobotDiagnosticsPanel, { props: { target: podmanTarget(SCAN_TOPICS) } });
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh diagnostics' }));

    expect(await screen.findByText(/odom.*base_footprint is missing/)).toBeTruthy();
    expect(screen.getByText(/Laser scan looks normal/)).toBeTruthy();
    expect(screen.getByText('costmap exec failed')).toBeTruthy();
  });

  it('disables the refresh button while a refresh is in flight', async () => {
    let resolveTf: (value: typeof TF_RESULT) => void = () => {};
    mockGetTfTreeStatus.mockReturnValue(
      new Promise(resolve => {
        resolveTf = resolve;
      }),
    );

    render(RobotDiagnosticsPanel, { props: { target: podmanTarget(SCAN_TOPICS) } });
    const button = screen.getByRole('button', { name: 'Refresh diagnostics' }) as HTMLButtonElement;
    await fireEvent.click(button);

    expect((screen.getByRole('button', { name: 'Refreshing...' }) as HTMLButtonElement).disabled).toBe(true);

    resolveTf(TF_RESULT);
    await screen.findByRole('button', { name: 'Refresh diagnostics' });
    expect((screen.getByRole('button', { name: 'Refresh diagnostics' }) as HTMLButtonElement).disabled).toBe(false);
  });

  describe('OpenShift target', () => {
    it('fetches the robot list and diagnostics via the *InOpenShift RPCs', async () => {
      mockListSpawnedRobotsInOpenShift.mockResolvedValue(['robot_1']);
      render(RobotDiagnosticsPanel, { props: { target: ocTarget('my-context') } });

      await waitFor(() =>
        expect(mockListSpawnedRobotsInOpenShift).toHaveBeenCalledWith('ns1', 'ros2-jazzy-sim', 'my-context'),
      );
      const select = await screen.findByLabelText('Robot');
      expect((select as HTMLSelectElement).value).toBe('robot_1');

      await fireEvent.click(screen.getByRole('button', { name: 'Refresh diagnostics' }));

      expect(mockGetTfTreeStatusInOpenShift).toHaveBeenCalledWith('ns1', 'ros2-jazzy-sim', 'robot_1', 'my-context');
      expect(mockGetCostmapSummaryInOpenShift).toHaveBeenCalledWith('ns1', 'ros2-jazzy-sim', 'robot_1', 'my-context');
      expect(mockGetLaserScanSummaryInOpenShift).toHaveBeenCalledWith('ns1', 'ros2-jazzy-sim', 'robot_1', 'my-context');
      expect(mockGetTfTreeStatus).not.toHaveBeenCalled();

      expect(await screen.findByText(/odom.*base_footprint is missing/)).toBeTruthy();
    });
  });
});
