import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import RobotDiagnosticsPanel from './RobotDiagnosticsPanel.svelte';
import type { TopicInfo } from '/@shared/src/types/TopicInfo';
import type { DiagnosticsTarget } from './RobotDiagnosticsPanel.types';
import { __resetRobotDiagnosticsCacheForTests } from './robotDiagnosticsCache';
import { spawnedRobotsByTarget } from './spawnedRobotsStore';
import { localTargetKey } from './diagnosticsTargetKey';

const mockGetTfTreeStatus = vi.fn();
const mockGetCostmapSummary = vi.fn();
const mockGetRobotSensorDiagnostics = vi.fn();
const mockListSpawnedRobotsInSimulation = vi.fn();
const mockGetTfTreeStatusInOpenShift = vi.fn();
const mockGetCostmapSummaryInOpenShift = vi.fn();
const mockGetRobotSensorDiagnosticsInOpenShift = vi.fn();
const mockListSpawnedRobotsInOpenShift = vi.fn();

vi.mock('../api/client', () => ({
  physicalAiClient: {
    getTfTreeStatus: (...args: unknown[]) => mockGetTfTreeStatus(...args),
    getCostmapSummary: (...args: unknown[]) => mockGetCostmapSummary(...args),
    getRobotSensorDiagnostics: (...args: unknown[]) => mockGetRobotSensorDiagnostics(...args),
    listSpawnedRobotsInSimulation: (...args: unknown[]) => mockListSpawnedRobotsInSimulation(...args),
    getTfTreeStatusInOpenShift: (...args: unknown[]) => mockGetTfTreeStatusInOpenShift(...args),
    getCostmapSummaryInOpenShift: (...args: unknown[]) => mockGetCostmapSummaryInOpenShift(...args),
    getRobotSensorDiagnosticsInOpenShift: (...args: unknown[]) => mockGetRobotSensorDiagnosticsInOpenShift(...args),
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

const SENSOR_RESULT = {
  robotNamespace: 'robot_1',
  capturedAt: new Date().toISOString(),
  sensors: [
    {
      topic: '/robot_1/scan',
      type: 'sensor_msgs/msg/LaserScan',
      publishers: 1,
      peekSupported: true,
      laserScan: LASER_RESULT,
    },
  ],
};

describe('RobotDiagnosticsPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    __resetRobotDiagnosticsCacheForTests();
    spawnedRobotsByTarget.set({});
    mockGetTfTreeStatus.mockResolvedValue(TF_RESULT);
    mockGetCostmapSummary.mockResolvedValue(COSTMAP_RESULT);
    mockGetRobotSensorDiagnostics.mockResolvedValue(SENSOR_RESULT);
    mockListSpawnedRobotsInSimulation.mockResolvedValue([]);
    mockGetTfTreeStatusInOpenShift.mockResolvedValue(TF_RESULT);
    mockGetCostmapSummaryInOpenShift.mockResolvedValue(COSTMAP_RESULT);
    mockGetRobotSensorDiagnosticsInOpenShift.mockResolvedValue(SENSOR_RESULT);
    mockListSpawnedRobotsInOpenShift.mockResolvedValue([]);
  });

  it('shows an empty state and no robot picker when no robot is detected', async () => {
    render(RobotDiagnosticsPanel, { props: { target: podmanTarget([]) } });
    await waitFor(() => expect(mockListSpawnedRobotsInSimulation).toHaveBeenCalledWith('c1'));
    expect(screen.getByText(/No robot detected yet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refresh diagnostics' })).toBeNull();
  });

  it('shows a "Checking for robots" state while the initial fetch is in flight, not a false negative', async () => {
    let resolveFetch: (names: string[]) => void = () => {};
    mockListSpawnedRobotsInSimulation.mockReturnValue(
      new Promise(resolve => {
        resolveFetch = resolve;
      }),
    );

    render(RobotDiagnosticsPanel, { props: { target: podmanTarget([]) } });

    expect(screen.getByText(/Checking for robots/)).toBeTruthy();
    expect(screen.queryByText(/No robot detected yet/)).toBeNull();

    resolveFetch(['robot_1']);
    expect(await screen.findByLabelText('Robot')).toBeTruthy();
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

  it('fetches TF, costmap, and sensor diagnostics on Refresh and renders the cards', async () => {
    render(RobotDiagnosticsPanel, { props: { target: podmanTarget(SCAN_TOPICS) } });

    // No auto-fetch on mount/robot-selection — diagnostics are manual-refresh only, never polled.
    expect(mockGetTfTreeStatus).not.toHaveBeenCalled();
    expect(mockGetCostmapSummary).not.toHaveBeenCalled();
    expect(mockGetRobotSensorDiagnostics).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Refresh diagnostics' }));

    expect(mockGetTfTreeStatus).toHaveBeenCalledWith('c1', 'robot_1');
    expect(mockGetCostmapSummary).toHaveBeenCalledWith('c1', 'robot_1');
    expect(mockGetRobotSensorDiagnostics).toHaveBeenCalledWith('c1', 'robot_1');

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

  it('remembers the last snapshot across remounts (e.g. navigating away and back) without refetching', async () => {
    const { unmount } = render(RobotDiagnosticsPanel, { props: { target: podmanTarget(SCAN_TOPICS) } });
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh diagnostics' }));
    expect(await screen.findByText(/Laser scan looks normal/)).toBeTruthy();
    unmount();

    vi.mocked(mockGetTfTreeStatus).mockClear();
    vi.mocked(mockGetCostmapSummary).mockClear();
    vi.mocked(mockGetRobotSensorDiagnostics).mockClear();

    render(RobotDiagnosticsPanel, { props: { target: podmanTarget(SCAN_TOPICS) } });
    expect(screen.getByText(/Laser scan looks normal/)).toBeTruthy();
    expect(mockGetTfTreeStatus).not.toHaveBeenCalled();
    expect(mockGetCostmapSummary).not.toHaveBeenCalled();
    expect(mockGetRobotSensorDiagnostics).not.toHaveBeenCalled();
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

  it('shows a robot from the shared spawnedRobotsByTarget store even when the one-shot fetch returns empty', async () => {
    mockListSpawnedRobotsInSimulation.mockResolvedValue([]);
    spawnedRobotsByTarget.set({ [localTargetKey('c1')]: ['robot_1'] });

    render(RobotDiagnosticsPanel, { props: { target: podmanTarget([]) } });

    const select = await screen.findByLabelText('Robot');
    expect((select as HTMLSelectElement).value).toBe('robot_1');
  });

  it('re-invokes the spawned-robots fetch when "Check again" is clicked', async () => {
    render(RobotDiagnosticsPanel, { props: { target: podmanTarget([]) } });
    await waitFor(() => expect(mockListSpawnedRobotsInSimulation).toHaveBeenCalledTimes(1));

    await fireEvent.click(screen.getByRole('button', { name: 'Check again' }));

    await waitFor(() => expect(mockListSpawnedRobotsInSimulation).toHaveBeenCalledTimes(2));
    // "Check again" only re-checks for a spawned robot — it must never fire the TF/costmap/sensor
    // RPCs, which stay explicit-Refresh-only everywhere in this feature.
    expect(mockGetTfTreeStatus).not.toHaveBeenCalled();
    expect(mockGetCostmapSummary).not.toHaveBeenCalled();
    expect(mockGetRobotSensorDiagnostics).not.toHaveBeenCalled();
  });

  it('shows the remembered-snapshot banner after a remount that hydrates from cache, and hides it after a fresh Refresh', async () => {
    const { unmount } = render(RobotDiagnosticsPanel, { props: { target: podmanTarget(SCAN_TOPICS) } });
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh diagnostics' }));
    expect(await screen.findByText(/Laser scan looks normal/)).toBeTruthy();
    expect(screen.queryByText(/Last known snapshot/)).toBeNull();
    unmount();

    render(RobotDiagnosticsPanel, { props: { target: podmanTarget(SCAN_TOPICS) } });
    expect(await screen.findByText(/Last known snapshot/)).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Refresh diagnostics' }));
    await waitFor(() => expect(screen.queryByText(/Last known snapshot/)).toBeNull());
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
      expect(mockGetRobotSensorDiagnosticsInOpenShift).toHaveBeenCalledWith(
        'ns1',
        'ros2-jazzy-sim',
        'robot_1',
        'my-context',
      );
      expect(mockGetTfTreeStatus).not.toHaveBeenCalled();

      expect(await screen.findByText(/odom.*base_footprint is missing/)).toBeTruthy();
    });
  });
});
