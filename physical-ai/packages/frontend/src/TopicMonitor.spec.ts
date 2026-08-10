import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import TopicMonitor from './TopicMonitor.svelte';

const mockListSimulationContainers = vi.fn();
const mockListRosTopics = vi.fn();
const mockGetRosTopicDetail = vi.fn();
const mockPeekRosTopic = vi.fn();
const mockGetRosMessageSchema = vi.fn();
const mockGetTopicPeekTimeoutSeconds = vi.fn();
const mockCopyToClipboard = vi.fn();
const mockGoto = vi.fn();

vi.mock('./api/client', () => ({
  physicalAiClient: {
    listSimulationContainers: (...args: any[]) => mockListSimulationContainers(...args),
    listRosTopics: (...args: any[]) => mockListRosTopics(...args),
    getRosTopicDetail: (...args: any[]) => mockGetRosTopicDetail(...args),
    peekRosTopic: (...args: any[]) => mockPeekRosTopic(...args),
    getRosMessageSchema: (...args: any[]) => mockGetRosMessageSchema(...args),
    getTopicPeekTimeoutSeconds: (...args: any[]) => mockGetTopicPeekTimeoutSeconds(...args),
    copyToClipboard: (...args: any[]) => mockCopyToClipboard(...args),
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
    mockPeekRosTopic.mockResolvedValue({
      topicName: '',
      message: '',
      timedOut: false,
      capturedAt: new Date().toISOString(),
    });
    mockGetRosMessageSchema.mockResolvedValue({ type: '', schema: '' });
    mockGetTopicPeekTimeoutSeconds.mockResolvedValue(5);
    mockCopyToClipboard.mockResolvedValue(undefined);
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
    expect(screen.getByText('Twist')).toBeTruthy();
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

  it('expands a topic row and shows soft topology on click', async () => {
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
    mockGetRosMessageSchema.mockResolvedValue({
      type: 'geometry_msgs/msg/Twist',
      schema: 'Vector3 linear\nVector3 angular\n',
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
    expect(screen.getByText(/Flow: publishers → \/cmd_vel → subscribers/)).toBeTruthy();
    expect(mockGetRosMessageSchema).toHaveBeenCalledWith('c1', 'geometry_msgs/msg/Twist');
  });

  it('shows schema when toggled', async () => {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);
    mockListRosTopics.mockResolvedValue([
      { name: '/cmd_vel', type: 'geometry_msgs/msg/Twist', publishers: 1, subscribers: 0 },
    ]);
    mockGetRosTopicDetail.mockResolvedValue({
      topicName: '/cmd_vel',
      type: 'geometry_msgs/msg/Twist',
      publishers: [{ nodeName: 'teleop_keyboard', nodeNamespace: '/' }],
      subscribers: [],
    });
    mockGetRosMessageSchema.mockResolvedValue({
      type: 'geometry_msgs/msg/Twist',
      schema: 'Vector3 linear\nVector3 angular\n',
    });

    render(TopicMonitor);
    await fireEvent.click((await screen.findByText('/cmd_vel')).closest('tr')!);
    await screen.findByText(/teleop_keyboard/);
    await fireEvent.click(screen.getByRole('button', { name: /Show message schema/ }));
    expect(await screen.findByText(/Vector3 linear/)).toBeTruthy();
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

  it('peeks a live message with metadata and tree view', async () => {
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
      capturedAt: '2026-08-06T14:30:00.000Z',
    });

    render(TopicMonitor);
    const topicCell = await screen.findByText('/cmd_vel');
    await fireEvent.click(topicCell.closest('tr')!);
    await screen.findByText(/teleop_keyboard/);

    await fireEvent.click(screen.getByRole('button', { name: 'Peek' }));
    expect(mockPeekRosTopic).toHaveBeenCalledWith('c1', '/cmd_vel');
    expect(await screen.findByText(/Captured:/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tree' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Raw' })).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(mockCopyToClipboard).toHaveBeenCalledWith('linear:\n  x: 0.2\n');
    expect(await screen.findByText('Copied')).toBeTruthy();
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
      capturedAt: new Date().toISOString(),
      error:
        'No message on /idle within 5s. The topic may be idle or publishing infrequently — try one with active publishers.',
    });

    render(TopicMonitor);
    await fireEvent.click((await screen.findByText('/idle')).closest('tr')!);
    await screen.findByRole('button', { name: 'Peek' });
    await fireEvent.click(screen.getByRole('button', { name: 'Peek' }));

    expect(await screen.findByText(/No message on \/idle/)).toBeTruthy();
    expect(screen.getByText(/active publishers/)).toBeTruthy();
  });
});
