import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import TopicMonitor from './TopicMonitor.svelte';

const mockListSimulationContainers = vi.fn();
const mockListRosTopics = vi.fn();
const mockGetRosTopicDetail = vi.fn();
const mockPeekRosTopic = vi.fn();
const mockGoto = vi.fn();

vi.mock('./api/client', () => ({
  physicalAiClient: {
    listSimulationContainers: (...args: any[]) => mockListSimulationContainers(...args),
    listRosTopics: (...args: any[]) => mockListRosTopics(...args),
    getRosTopicDetail: (...args: any[]) => mockGetRosTopicDetail(...args),
    peekRosTopic: (...args: any[]) => mockPeekRosTopic(...args),
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
    mockGetRosTopicDetail.mockResolvedValue({ topicName: '', type: '', publishers: [], subscribers: [] });
    mockPeekRosTopic.mockResolvedValue({ topicName: '', message: '', timedOut: false });
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

  it('shows expand chevron on topic rows', async () => {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);
    mockListRosTopics.mockResolvedValue([
      { name: '/rosout', type: 'rcl_interfaces/msg/Log', publishers: 1, subscribers: 0 },
    ]);

    render(TopicMonitor);
    await screen.findByText('/rosout');
    expect(screen.getByText('▶')).toBeTruthy();
  });

  it('expands a topic row and shows node names on click', async () => {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);
    mockListRosTopics.mockResolvedValue([
      { name: '/cmd_vel', type: 'geometry_msgs/msg/Twist', publishers: 1, subscribers: 1 },
    ]);
    mockGetRosTopicDetail.mockResolvedValue({
      topicName: '/cmd_vel',
      type: 'geometry_msgs/msg/Twist',
      publishers: [{ nodeName: 'teleop_keyboard', nodeNamespace: '/' }],
      subscribers: [{ nodeName: 'diff_drive', nodeNamespace: '/robot_1' }],
    });

    render(TopicMonitor);
    const topicCell = await screen.findByText('/cmd_vel');
    const row = topicCell.closest('tr')!;
    await fireEvent.click(row);

    expect(mockGetRosTopicDetail).toHaveBeenCalledWith('c1', '/cmd_vel');
    expect(await screen.findByText(/teleop_keyboard/)).toBeTruthy();
    expect(screen.getByText(/diff_drive/)).toBeTruthy();
    expect(screen.getByText('Publishers (1)')).toBeTruthy();
    expect(screen.getByText('Subscribers (1)')).toBeTruthy();
  });

  it('collapses an expanded topic row on second click', async () => {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);
    mockListRosTopics.mockResolvedValue([
      { name: '/cmd_vel', type: 'geometry_msgs/msg/Twist', publishers: 1, subscribers: 1 },
    ]);
    mockGetRosTopicDetail.mockResolvedValue({
      topicName: '/cmd_vel',
      type: 'geometry_msgs/msg/Twist',
      publishers: [{ nodeName: 'teleop_keyboard', nodeNamespace: '/' }],
      subscribers: [],
    });

    render(TopicMonitor);
    const topicCell = await screen.findByText('/cmd_vel');
    const row = topicCell.closest('tr')!;
    await fireEvent.click(row);
    await screen.findByText(/teleop_keyboard/);

    await fireEvent.click(row);
    expect(screen.queryByText(/teleop_keyboard/)).toBeNull();
  });

  it('shows error when detail fetch fails', async () => {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);
    mockListRosTopics.mockResolvedValue([
      { name: '/cmd_vel', type: 'geometry_msgs/msg/Twist', publishers: 1, subscribers: 1 },
    ]);
    mockGetRosTopicDetail.mockRejectedValue(new Error('exec failed'));

    render(TopicMonitor);
    const topicCell = await screen.findByText('/cmd_vel');
    const row = topicCell.closest('tr')!;
    await fireEvent.click(row);

    expect(await screen.findByText('exec failed')).toBeTruthy();
  });

  it('peeks a live message from an expanded topic', async () => {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);
    mockListRosTopics.mockResolvedValue([
      { name: '/cmd_vel', type: 'geometry_msgs/msg/Twist', publishers: 1, subscribers: 1 },
    ]);
    mockGetRosTopicDetail.mockResolvedValue({
      topicName: '/cmd_vel',
      type: 'geometry_msgs/msg/Twist',
      publishers: [{ nodeName: 'teleop_keyboard', nodeNamespace: '/' }],
      subscribers: [],
    });
    mockPeekRosTopic.mockResolvedValue({
      topicName: '/cmd_vel',
      message: 'linear:\n  x: 0.2\n',
      timedOut: false,
    });

    render(TopicMonitor);
    const topicCell = await screen.findByText('/cmd_vel');
    await fireEvent.click(topicCell.closest('tr')!);
    await screen.findByText(/teleop_keyboard/);

    await fireEvent.click(screen.getByRole('button', { name: 'Peek' }));
    expect(mockPeekRosTopic).toHaveBeenCalledWith('c1', '/cmd_vel');
    expect(await screen.findByText(/linear:/)).toBeTruthy();
  });

  it('shows timeout message when peek finds no data', async () => {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);
    mockListRosTopics.mockResolvedValue([
      { name: '/idle', type: 'std_msgs/msg/String', publishers: 0, subscribers: 0 },
    ]);
    mockGetRosTopicDetail.mockResolvedValue({
      topicName: '/idle',
      type: 'std_msgs/msg/String',
      publishers: [],
      subscribers: [],
    });
    mockPeekRosTopic.mockResolvedValue({
      topicName: '/idle',
      message: '',
      timedOut: true,
      error: 'No message on /idle within 5s',
    });

    render(TopicMonitor);
    await fireEvent.click((await screen.findByText('/idle')).closest('tr')!);
    await screen.findByRole('button', { name: 'Peek' });
    await fireEvent.click(screen.getByRole('button', { name: 'Peek' }));

    expect(await screen.findByText(/No message on \/idle/)).toBeTruthy();
  });
});
