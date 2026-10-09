import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import GraphicalTopicMonitor from './GraphicalTopicMonitor.svelte';
import { navigationLayout } from './lib/navigationLayout';

const mockListSimulationContainers = vi.fn();
const mockListRosTopicSummaries = vi.fn();

vi.mock('./api/client', () => ({
  physicalAiClient: {
    listSimulationContainers: (...args: unknown[]) => mockListSimulationContainers(...args),
    listRosTopicSummaries: (...args: unknown[]) => mockListRosTopicSummaries(...args),
  },
}));

vi.mock('tinro', () => ({
  router: { goto: vi.fn() },
}));

describe('GraphicalTopicMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    navigationLayout.set('sidebar');
    mockListSimulationContainers.mockResolvedValue([]);
    mockListRosTopicSummaries.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('discovers a simulation that appears after the page mounts', async () => {
    mockListSimulationContainers
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
      ]);
    mockListRosTopicSummaries.mockResolvedValue([
      { name: '/cmd_vel', type: 'geometry_msgs/msg/Twist', publishers: 1, subscribers: 1, countsPending: false },
    ]);

    render(GraphicalTopicMonitor);
    expect(await screen.findByText(/No simulation is running/)).toBeTruthy();

    await vi.advanceTimersByTimeAsync(5000);

    expect(await screen.findByText(/1 topics available/)).toBeTruthy();
    expect(mockListRosTopicSummaries).toHaveBeenCalledWith('c1');
  });
});
