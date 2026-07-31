import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import TopicMonitor from './TopicMonitor.svelte';

const mockListSimulationContainers = vi.fn();
const mockListRosTopics = vi.fn();
const mockGoto = vi.fn();

vi.mock('./api/client', () => ({
  physicalAiClient: {
    listSimulationContainers: (...args: any[]) => mockListSimulationContainers(...args),
    listRosTopics: (...args: any[]) => mockListRosTopics(...args),
  },
}));

vi.mock('tinro', () => ({
  router: { goto: (...args: any[]) => mockGoto(...args) },
}));

describe('TopicMonitor', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockListSimulationContainers.mockResolvedValue([]);
    mockListRosTopics.mockResolvedValue([]);
  });

  it('renders heading', () => {
    render(TopicMonitor);
    expect(screen.getByText('Topic Monitor')).toBeTruthy();
  });

  it('shows no-simulation message when no containers running', async () => {
    render(TopicMonitor);
    const msg = await screen.findByText(/No simulation is running/);
    expect(msg).toBeTruthy();
  });

  it('shows topics table when simulation is running and topics exist', async () => {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);
    mockListRosTopics.mockResolvedValue([
      { name: '/rosout', type: 'rcl_interfaces/msg/Log', publishers: 1, subscribers: 0 },
      { name: '/robot_1/cmd_vel', type: 'geometry_msgs/msg/Twist', publishers: 0, subscribers: 1 },
    ]);

    render(TopicMonitor);
    const topicCell = await screen.findByText('/rosout');
    expect(topicCell).toBeTruthy();
    expect(screen.getByText('/robot_1/cmd_vel')).toBeTruthy();
    expect(screen.getByText('geometry_msgs/msg/Twist')).toBeTruthy();
    expect(screen.getByText('2 active topics')).toBeTruthy();
  });

  it('shows column headers', async () => {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);
    mockListRosTopics.mockResolvedValue([
      { name: '/rosout', type: 'rcl_interfaces/msg/Log', publishers: 1, subscribers: 0 },
    ]);

    render(TopicMonitor);
    await screen.findByText('/rosout');
    expect(screen.getByText('Topic')).toBeTruthy();
    expect(screen.getByText('Message Type')).toBeTruthy();
    expect(screen.getByText('Pubs')).toBeTruthy();
    expect(screen.getByText('Subs')).toBeTruthy();
  });
});
