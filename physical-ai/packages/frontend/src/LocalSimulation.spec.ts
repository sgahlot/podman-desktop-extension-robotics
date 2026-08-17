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

  it('shows Navigate on spawned robots when a simulation is running', async () => {
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

    render(SimulationPage);
    await screen.findByRole('button', { name: 'Add TurtleBot3' });
    await fireEvent.click(screen.getByRole('button', { name: 'Add TurtleBot3' }));
    expect(await screen.findByRole('button', { name: 'Navigate' })).toBeTruthy();
  });
});
