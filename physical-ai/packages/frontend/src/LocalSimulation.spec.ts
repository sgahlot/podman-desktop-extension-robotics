import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import SimulationPage from './LocalSimulation.svelte';

const mockGetSimulationImageAllowlist = vi.fn();
const mockListLocalImages = vi.fn();
const mockListSimulationContainers = vi.fn();
const mockLaunchSimulation = vi.fn();
const mockDeleteSimulation = vi.fn();
const mockStopSimulation = vi.fn();
const mockOpenSimulationInBrowser = vi.fn();
const mockExecInSimulation = vi.fn();
const mockSendNavigationGoal = vi.fn();
const mockGetRobotWarmStatus = vi.fn();
const mockGetSimulationConfig = vi.fn();
const mockListSpawnedRobotsInSimulation = vi.fn();
const mockGoto = vi.fn();

vi.mock('./api/client', () => ({
  physicalAiClient: {
    getSimulationImageAllowlist: (...args: unknown[]) => mockGetSimulationImageAllowlist(...args),
    listLocalImages: (...args: unknown[]) => mockListLocalImages(...args),
    listSimulationContainers: (...args: unknown[]) => mockListSimulationContainers(...args),
    launchSimulation: (...args: unknown[]) => mockLaunchSimulation(...args),
    deleteSimulation: (...args: unknown[]) => mockDeleteSimulation(...args),
    stopSimulation: (...args: unknown[]) => mockStopSimulation(...args),
    openSimulationInBrowser: (...args: unknown[]) => mockOpenSimulationInBrowser(...args),
    execInSimulation: (...args: unknown[]) => mockExecInSimulation(...args),
    sendNavigationGoal: (...args: unknown[]) => mockSendNavigationGoal(...args),
    getRobotWarmStatus: (...args: unknown[]) => mockGetRobotWarmStatus(...args),
    getSimulationConfig: (...args: unknown[]) => mockGetSimulationConfig(...args),
    listSpawnedRobotsInSimulation: (...args: unknown[]) => mockListSpawnedRobotsInSimulation(...args),
  },
}));

vi.mock('tinro', () => ({
  router: { goto: (...args: unknown[]) => mockGoto(...args) },
}));

const SIM_IMAGE = 'quay.io/ns/ros2-jazzy-sim:noble';

describe('LocalSimulation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetSimulationImageAllowlist.mockResolvedValue('');
    mockListLocalImages.mockResolvedValue([]);
    mockListSimulationContainers.mockResolvedValue([]);
    mockLaunchSimulation.mockResolvedValue('cid');
    mockDeleteSimulation.mockResolvedValue(undefined);
    mockStopSimulation.mockResolvedValue(undefined);
    mockOpenSimulationInBrowser.mockResolvedValue(undefined);
    mockGetRobotWarmStatus.mockResolvedValue('idle');
    mockListSpawnedRobotsInSimulation.mockResolvedValue([]);
    mockGetSimulationConfig.mockResolvedValue({
      robot: 'turtlebot3',
      distro: 'jazzy',
      middleware: 'dds',
      engine: 'gazebo',
      baseImage: 'jazzy-noble',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the launch section', () => {
    render(SimulationPage);
    expect(screen.getByText('Launch Simulation')).toBeTruthy();
  });

  it('shows empty-state guidance when no local sim images', async () => {
    render(SimulationPage);
    expect(await screen.findByText(/No simulation images found locally/)).toBeTruthy();
    expect(screen.getByText('Image Builder')).toBeTruthy();
  });

  it('lists local sim images and launches', async () => {
    mockListLocalImages.mockResolvedValue([SIM_IMAGE, 'quay.io/ns/ros2-jazzy-base:noble']);
    mockListSimulationContainers.mockResolvedValue([]);

    render(SimulationPage);
    const launchBtn = await screen.findByRole('button', { name: 'Launch' });
    expect(screen.getByDisplayValue(SIM_IMAGE)).toBeTruthy();

    await fireEvent.click(launchBtn);
    await waitFor(() => {
      expect(mockLaunchSimulation).toHaveBeenCalledWith(SIM_IMAGE, '', undefined);
    });
  });

  it('passes RMW_IMPLEMENTATION=rmw_zenoh_cpp when the sim config selects zenoh middleware', async () => {
    mockListLocalImages.mockResolvedValue([SIM_IMAGE]);
    mockListSimulationContainers.mockResolvedValue([]);
    mockGetSimulationConfig.mockResolvedValue({
      robot: 'turtlebot3',
      distro: 'jazzy',
      middleware: 'zenoh',
      engine: 'gazebo',
      baseImage: 'jazzy-noble',
    });

    render(SimulationPage);
    const launchBtn = await screen.findByRole('button', { name: 'Launch' });

    await fireEvent.click(launchBtn);
    await waitFor(() => {
      expect(mockLaunchSimulation).toHaveBeenCalledWith(SIM_IMAGE, '', {
        env: { RMW_IMPLEMENTATION: 'rmw_zenoh_cpp' },
      });
    });
  });

  it('surfaces launch errors', async () => {
    mockListLocalImages.mockResolvedValue([SIM_IMAGE]);
    mockLaunchSimulation.mockRejectedValue(new Error('engine unavailable'));

    render(SimulationPage);
    await screen.findByRole('button', { name: 'Launch' });
    await fireEvent.click(screen.getByRole('button', { name: 'Launch' }));

    expect(await screen.findByText('engine unavailable')).toBeTruthy();
  });

  it('keeps exited containers visible with Stop & remove and does not auto-delete them', async () => {
    mockListLocalImages.mockResolvedValue([SIM_IMAGE]);
    mockListSimulationContainers.mockResolvedValue([
      {
        id: 'abc123def456',
        name: 'pai-sim-exited',
        imageTag: SIM_IMAGE,
        state: 'exited',
        ports: [],
        labels: {},
      },
    ]);

    render(SimulationPage);
    expect(await screen.findByText('pai-sim-exited')).toBeTruthy();
    expect(screen.getByText('exited')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop & remove' })).toBeTruthy();
    expect(mockDeleteSimulation).not.toHaveBeenCalled();
  });

  it('surfaces stop & remove errors for exited containers', async () => {
    mockListLocalImages.mockResolvedValue([SIM_IMAGE]);
    mockListSimulationContainers.mockResolvedValue([
      {
        id: 'abc123def456',
        name: 'pai-sim-dead',
        imageTag: SIM_IMAGE,
        state: 'exited',
        ports: [],
        labels: {},
      },
    ]);
    mockDeleteSimulation.mockRejectedValue(new Error('remove failed'));

    render(SimulationPage);
    await screen.findByText('pai-sim-dead');
    await fireEvent.click(screen.getByRole('button', { name: 'Stop & remove' }));

    expect(await screen.findByText('remove failed')).toBeTruthy();
  });

  it('opens browser using mapped host port for noVNC', async () => {
    mockListLocalImages.mockResolvedValue([SIM_IMAGE]);
    mockListSimulationContainers.mockResolvedValue([
      {
        id: 'abc123def456',
        name: 'pai-sim-run',
        imageTag: SIM_IMAGE,
        state: 'running',
        ports: ['16080:6080/tcp'],
        labels: {},
      },
    ]);

    render(SimulationPage);
    await screen.findByText('pai-sim-run');
    await fireEvent.click(screen.getByRole('button', { name: 'Open in Browser' }));

    await waitFor(() => {
      expect(mockOpenSimulationInBrowser).toHaveBeenCalledWith(16080, 6080);
    });
  });

  it('stops and removes a running simulation and shows a noVNC tab hint', async () => {
    mockListLocalImages.mockResolvedValue([SIM_IMAGE]);
    mockListSimulationContainers.mockResolvedValue([
      {
        id: 'abc123def456',
        name: 'pai-sim-run',
        imageTag: SIM_IMAGE,
        state: 'running',
        ports: ['6080:6080/tcp'],
        labels: {},
      },
    ]);

    render(SimulationPage);
    await screen.findByText('pai-sim-run');
    await fireEvent.click(screen.getByRole('button', { name: 'Stop & remove' }));

    await waitFor(() => {
      expect(mockDeleteSimulation).toHaveBeenCalledWith('abc123def456');
      expect(mockStopSimulation).not.toHaveBeenCalled();
    });
    expect(await screen.findByText(/Close the Gazebo \(noVNC\) browser tab/)).toBeTruthy();
    expect(screen.queryByText('pai-sim-run')).toBeNull();
  });

  it('hides Add TurtleBot3 until a simulation is running', async () => {
    mockListLocalImages.mockResolvedValue([SIM_IMAGE]);
    mockListSimulationContainers.mockResolvedValue([]);

    render(SimulationPage);
    await screen.findByRole('button', { name: 'Launch' });
    expect(screen.queryByRole('button', { name: 'Add TurtleBot3' })).toBeNull();
    expect(screen.queryByText('Launch a simulation first to add robots.')).toBeNull();
  });

  it('shows Navigate on spawned robots once Nav2 has warmed up', async () => {
    vi.useFakeTimers();
    mockListLocalImages.mockResolvedValue([SIM_IMAGE]);
    mockListSimulationContainers.mockResolvedValue([
      {
        id: 'abc123def456',
        name: 'pai-sim-run',
        imageTag: SIM_IMAGE,
        state: 'running',
        ports: ['6080:6080/tcp'],
        labels: {},
      },
    ]);
    mockExecInSimulation.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    // Pre-warm reports ready so the nav controls are revealed after a poll tick.
    mockGetRobotWarmStatus.mockResolvedValue('ready');

    render(SimulationPage);
    await vi.advanceTimersByTimeAsync(100); // onMount + container list

    await fireEvent.click(screen.getByRole('button', { name: 'Add TurtleBot3' }));
    await vi.advanceTimersByTimeAsync(0); // let the spawn promise settle

    // Jazzy spawn is optimistically 'warming' → Navigate hidden until warm.
    expect(screen.queryByRole('button', { name: 'Navigate' })).toBeNull();

    // Warm-status poll flips it to 'ready' → controls appear.
    await vi.advanceTimersByTimeAsync(3000);
    expect(screen.getByRole('button', { name: 'Navigate' })).toBeTruthy();
  });

  const RUNNING_CONTAINER = {
    id: 'abc123def456',
    name: 'pai-sim-run',
    imageTag: SIM_IMAGE,
    state: 'running' as const,
    ports: ['6080:6080/tcp'],
    labels: {},
  };

  it('reflects a robot already running in the container without a manual spawn (APPENG-6250)', async () => {
    mockListLocalImages.mockResolvedValue([SIM_IMAGE]);
    mockListSimulationContainers.mockResolvedValue([RUNNING_CONTAINER]);
    mockListSpawnedRobotsInSimulation.mockResolvedValue(['robot_1']);

    render(SimulationPage);

    await waitFor(() => {
      expect(mockListSpawnedRobotsInSimulation).toHaveBeenCalledWith('abc123def456');
    });
    expect(await screen.findByText('robot_1')).toBeTruthy();
  });

  it('does not duplicate or reset a reconciled robot on later poll ticks', async () => {
    vi.useFakeTimers();
    try {
      mockListLocalImages.mockResolvedValue([SIM_IMAGE]);
      mockListSimulationContainers.mockResolvedValue([RUNNING_CONTAINER]);
      mockListSpawnedRobotsInSimulation.mockResolvedValue(['robot_1']);

      render(SimulationPage);
      await vi.advanceTimersByTimeAsync(100); // onMount + reconcile
      expect(screen.getByText('robot_1')).toBeTruthy();
      const callsAfterReconcile = mockListSpawnedRobotsInSimulation.mock.calls.length;

      await vi.advanceTimersByTimeAsync(3000); // one more poll tick (prune only)
      expect(screen.getAllByText('robot_1')).toHaveLength(1);
      // Reconcile-add ran at most once; the extra call(s) on this tick are prune checks.
      expect(mockListSpawnedRobotsInSimulation.mock.calls.length).toBeGreaterThan(callsAfterReconcile);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not prune a robot after only a single missed poll (debounce)', async () => {
    vi.useFakeTimers();
    try {
      mockListLocalImages.mockResolvedValue([SIM_IMAGE]);
      mockListSimulationContainers.mockResolvedValue([RUNNING_CONTAINER]);
      mockListSpawnedRobotsInSimulation.mockResolvedValue(['robot_1']);

      render(SimulationPage);
      await vi.advanceTimersByTimeAsync(100); // onMount + reconcile adds robot_1

      mockListSpawnedRobotsInSimulation.mockResolvedValueOnce([]); // single miss only
      await vi.advanceTimersByTimeAsync(3000);

      expect(screen.getByText('robot_1')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('prunes a robot confirmed missing across 2 consecutive polls (APPENG-6149/6250)', async () => {
    vi.useFakeTimers();
    try {
      mockListLocalImages.mockResolvedValue([SIM_IMAGE]);
      mockListSimulationContainers.mockResolvedValue([RUNNING_CONTAINER]);
      mockListSpawnedRobotsInSimulation.mockResolvedValue(['robot_1']);

      render(SimulationPage);
      await vi.advanceTimersByTimeAsync(100); // onMount + reconcile adds robot_1
      expect(screen.getByText('robot_1')).toBeTruthy();

      mockListSpawnedRobotsInSimulation.mockResolvedValue([]);
      await vi.advanceTimersByTimeAsync(3000); // miss #1 — below threshold, kept
      expect(screen.getByText('robot_1')).toBeTruthy();

      await vi.advanceTimersByTimeAsync(3000); // miss #2 -> pruned
      expect(screen.queryByText('robot_1')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not prune a freshly-spawned robot still within its startup grace period', async () => {
    vi.useFakeTimers();
    try {
      // Humble (no `warming` phase) — exercises the wall-clock grace fallback.
      mockListLocalImages.mockResolvedValue(['quay.io/ns/ros2-humble-sim:sloretz-amd64']);
      mockListSimulationContainers.mockResolvedValue([
        { ...RUNNING_CONTAINER, imageTag: 'quay.io/ns/ros2-humble-sim:sloretz-amd64' },
      ]);
      mockGetSimulationConfig.mockResolvedValue({
        robot: 'turtlebot3',
        distro: 'humble',
        middleware: 'dds',
        engine: 'gazebo',
        baseImage: 'humble-jammy',
      });
      mockExecInSimulation.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
      mockListSpawnedRobotsInSimulation.mockResolvedValue([]); // absent from ros2 node list the whole time

      render(SimulationPage);
      await vi.advanceTimersByTimeAsync(100); // onMount + reconcile finds nothing yet

      await fireEvent.click(screen.getByRole('button', { name: 'Add TurtleBot3' }));
      await vi.advanceTimersByTimeAsync(0); // spawn promise settles
      expect(screen.getByText('robot_1')).toBeTruthy();

      // Well past the 2-miss debounce (6s), but still under the 30s grace period.
      await vi.advanceTimersByTimeAsync(25_000);
      expect(screen.getByText('robot_1')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
