import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import Diagnostics from './Diagnostics.svelte';
import { navigationLayout } from './lib/navigationLayout';

const mockListSimulationContainers = vi.fn();
const mockListRosTopics = vi.fn();
const mockListSpawnedRobotsInSimulation = vi.fn();
const mockListSpawnedRobotsInOpenShift = vi.fn();
const mockGoto = vi.fn();

vi.mock('./api/client', () => ({
  physicalAiClient: {
    listSimulationContainers: (...args: unknown[]) => mockListSimulationContainers(...args),
    listRosTopics: (...args: unknown[]) => mockListRosTopics(...args),
    listSpawnedRobotsInSimulation: (...args: unknown[]) => mockListSpawnedRobotsInSimulation(...args),
    listSpawnedRobotsInOpenShift: (...args: unknown[]) => mockListSpawnedRobotsInOpenShift(...args),
  },
}));

vi.mock('tinro', () => ({
  router: { goto: (...args: unknown[]) => mockGoto(...args) },
}));

describe('Diagnostics', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    navigationLayout.set('sidebar');
    mockListSimulationContainers.mockResolvedValue([]);
    mockListRosTopics.mockResolvedValue([]);
    mockListSpawnedRobotsInSimulation.mockResolvedValue([]);
    mockListSpawnedRobotsInOpenShift.mockResolvedValue([]);
  });

  it('shows a no-simulation message when there is no query and nothing running', async () => {
    render(Diagnostics, { props: { query: {} } });
    expect(await screen.findByText(/No simulation is running/)).toBeTruthy();
  });

  it('falls back to the first running container when no query is given', async () => {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);
    mockListSpawnedRobotsInSimulation.mockResolvedValue(['robot_1']);

    render(Diagnostics, { props: { query: {} } });
    await waitFor(() => expect(mockListSpawnedRobotsInSimulation).toHaveBeenCalledWith('c1'));
    expect(await screen.findByRole('button', { name: 'Refresh diagnostics' })).toBeTruthy();
  });

  it('uses the deep-linked local container and pre-selects the robot', async () => {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);

    render(Diagnostics, { props: { query: { target: 'local', containerId: 'c1', robot: 'robot_9' } } });
    await waitFor(() => expect(mockListSpawnedRobotsInSimulation).toHaveBeenCalledWith('c1'));

    const select = (await screen.findByLabelText('Robot')) as HTMLSelectElement;
    expect(select.value).toBe('robot_9');
    expect(screen.queryByText(/no longer running/)).toBeNull();
  });

  it('falls back and notes when the deep-linked container is no longer running', async () => {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c2', name: 'pai-sim-456', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);

    render(Diagnostics, { props: { query: { target: 'local', containerId: 'c1', robot: 'robot_9' } } });
    await waitFor(() => expect(mockListSpawnedRobotsInSimulation).toHaveBeenCalledWith('c2'));
    expect(await screen.findByText(/no longer running/)).toBeTruthy();
  });

  it('builds an oc target directly from the query, without listing local containers', async () => {
    render(Diagnostics, {
      props: {
        query: { target: 'oc', namespace: 'ns1', workload: 'ros2-jazzy-sim', robot: 'robot_1', context: 'ctx1' },
      },
    });

    await waitFor(() => expect(mockListSpawnedRobotsInOpenShift).toHaveBeenCalledWith('ns1', 'ros2-jazzy-sim', 'ctx1'));
    expect(mockListSimulationContainers).not.toHaveBeenCalled();

    const select = (await screen.findByLabelText('Robot')) as HTMLSelectElement;
    expect(select.value).toBe('robot_1');
  });
});
