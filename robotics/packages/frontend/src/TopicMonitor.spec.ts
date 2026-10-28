import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import TopicMonitor from './TopicMonitor.svelte';
import { navigationLayout } from './lib/navigationLayout';
import type { TopicMonitorTargetApi } from './lib/topicMonitorTarget';

const mockListSimulationContainers = vi.fn();
const mockListRosTopics = vi.fn();
const mockListRosTopicSummaries = vi.fn();
const mockGetRosTopicDetail = vi.fn();
const mockPeekRosTopic = vi.fn();
const mockGetRosMessageSchema = vi.fn();
const mockGetTopicPeekTimeoutSeconds = vi.fn();
const mockCopyToClipboard = vi.fn();
const mockGoto = vi.fn();
const mockGetTopicTopology = vi.fn();

const localTargetApi: TopicMonitorTargetApi = {
  kind: 'local',
  async listTargets() {
    return (await mockListSimulationContainers()).map(
      (container: { id: string; name: string; imageTag?: string; state: string }) => ({
        id: container.id,
        label: container.imageTag ? `${container.name} — ${container.imageTag}` : container.name,
        ready: container.state === 'running',
      }),
    );
  },
  getTopicTopology: (...args) => mockGetTopicTopology(...args),
  listRosTopicSummaries: (...args) => mockListRosTopicSummaries(...args),
  listRosTopics: (...args) => mockListRosTopics(...args),
  getRosTopicDetail: (...args) => mockGetRosTopicDetail(...args),
  getRosMessageSchema: (...args) => mockGetRosMessageSchema(...args),
  peekRosTopic: (...args) => mockPeekRosTopic(...args),
  getOccupancyGridTopicSnapshot: async () => ({
    topicName: '',
    width: 0,
    height: 0,
    resolutionMeters: 0,
    originX: 0,
    originY: 0,
    cells: [],
    capturedAt: '',
  }),
  getCompressedImageTopicSnapshot: async () => ({ topicName: '', format: '', dataBase64: '', capturedAt: '' }),
  startCompressedImageTopicPreview: async () => ({
    topicName: '',
    format: '',
    dataBase64: '',
    capturedAt: '',
    status: 'waiting',
  }),
  getCompressedImageTopicPreview: async () => ({
    topicName: '',
    format: '',
    dataBase64: '',
    capturedAt: '',
    status: 'waiting',
  }),
  stopCompressedImageTopicPreview: async () => undefined,
  getTopicTelemetry: async () => [],
  publishRosTopic: async () => ({ topicName: '', messageType: '', publishedAt: '' }),
  startRosbagRecording: async id => ({
    containerId: id,
    topics: [],
    outputPath: '',
    status: 'complete',
    startedAt: 0,
  }),
  getRosbagRecording: async () => undefined,
  stopRosbagRecording: async () => undefined,
  getTopicPeekTimeoutSeconds: (...args) => mockGetTopicPeekTimeoutSeconds(...args),
  copyToClipboard: (...args) => mockCopyToClipboard(...args),
};

function renderTopicMonitor(props: Record<string, unknown> = {}) {
  return render(TopicMonitor, { targetApi: localTargetApi, ...props });
}

vi.mock('./api/client', () => ({
  physicalAiClient: {
    listSimulationContainers: (...args: unknown[]) => mockListSimulationContainers(...args),
    listRosTopics: (...args: unknown[]) => mockListRosTopics(...args),
    listRosTopicSummaries: (...args: unknown[]) => mockListRosTopicSummaries(...args),
    getRosTopicDetail: (...args: unknown[]) => mockGetRosTopicDetail(...args),
    peekRosTopic: (...args: unknown[]) => mockPeekRosTopic(...args),
    getRosMessageSchema: (...args: unknown[]) => mockGetRosMessageSchema(...args),
    getTopicPeekTimeoutSeconds: (...args: unknown[]) => mockGetTopicPeekTimeoutSeconds(...args),
    copyToClipboard: (...args: unknown[]) => mockCopyToClipboard(...args),
    getTopicTopology: (...args: unknown[]) => mockGetTopicTopology(...args),
  },
}));

vi.mock('tinro', () => ({
  router: { goto: (...args: unknown[]) => mockGoto(...args) },
}));

describe('TopicMonitor', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    navigationLayout.set('sidebar');
    mockListSimulationContainers.mockResolvedValue([]);
    mockListRosTopics.mockResolvedValue([]);
    mockListRosTopicSummaries.mockImplementation(async () => {
      const full = (await mockListRosTopics()) as Array<{
        name: string;
        type: string;
        publishers: number;
        subscribers: number;
      }>;
      return full.map(t => ({
        name: t.name,
        type: t.type,
        publishers: 0,
        subscribers: 0,
        countsPending: true,
      }));
    });
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
    mockGetTopicTopology.mockResolvedValue({ topics: [], nodes: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders heading', () => {
    renderTopicMonitor();
    expect(screen.getByText('Topic Monitor')).toBeTruthy();
  });

  it('shows the back-to-dashboard link and Quick Links when navigation layout is cards', () => {
    navigationLayout.set('cards');
    renderTopicMonitor();
    expect(screen.getByText(/Back to Dashboard/)).toBeTruthy();
    expect(screen.getByText('Quick Links:')).toBeTruthy();
  });

  it('hides the back-to-dashboard link and Quick Links when navigation layout is sidebar', () => {
    navigationLayout.set('sidebar');
    renderTopicMonitor();
    expect(screen.queryByText(/Back to Dashboard/)).toBeNull();
    expect(screen.queryByText('Quick Links:')).toBeNull();
  });

  it('shows no-simulation message when no containers running', async () => {
    renderTopicMonitor();
    const msg = await screen.findByText(/No local simulation is available/);
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

    renderTopicMonitor();
    const topicCell = await screen.findByText('/rosout');
    expect(topicCell).toBeTruthy();
    expect(screen.getByText('/robot_1/cmd_vel')).toBeTruthy();
    expect(screen.getByText('geometry_msgs/msg/Twist')).toBeTruthy();
    expect(screen.getByText('Twist')).toBeTruthy();
    expect(screen.getByText(/^2 topics$/)).toBeTruthy();
  });

  it('filters topics by name without changing the refreshed source list', async () => {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);
    mockListRosTopics.mockResolvedValue([
      { name: '/rosout', type: 'rcl_interfaces/msg/Log', publishers: 1, subscribers: 0 },
      { name: '/robot_1/cmd_vel', type: 'geometry_msgs/msg/Twist', publishers: 0, subscribers: 1 },
    ]);

    renderTopicMonitor();
    await screen.findByText('/rosout');
    await fireEvent.input(screen.getByRole('searchbox', { name: 'Filter topics' }), { target: { value: 'cmd_vel' } });

    expect(screen.queryByText('/rosout')).toBeNull();
    expect(screen.getByText('/robot_1/cmd_vel')).toBeTruthy();
    expect(screen.getByText(/1 of 2 topics/)).toBeTruthy();
  });

  it.each([false, true])('groups List topics after filtering (embedded=%s)', async embedded => {
    mockListSimulationContainers.mockResolvedValue([{ id: 'c1', name: 'sim', state: 'running', ports: [] }]);
    const topicList = [
      '/clock',
      '/robot_1/cmd_vel',
      '/robot_2/cmd_vel',
      '/robot_1/status',
      '/robot_1/sensors/scan',
    ].map(name => ({ name, type: 'std_msgs/msg/String', publishers: 1, subscribers: 1 }));
    mockListRosTopics.mockResolvedValue(topicList);
    renderTopicMonitor({
      embedded,
      ...(embedded
        ? {
            sharedContainers: [{ id: 'c1', label: 'sim', ready: true }],
            sharedContainerId: 'c1',
            sharedTopology: { topics: topicList, nodes: [] },
          }
        : {}),
    });
    await screen.findByText('/clock');
    const grouping = screen.getByRole('checkbox', { name: 'Group by namespace' });
    await fireEvent.click(grouping);
    expect(screen.getByText('Topics grouped by namespace')).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: '/ (1 topics)' })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: '/robot_1 (2 topics)' })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: '/robot_2 (1 topics)' })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: '/robot_1/sensors (1 topics)' })).toBeTruthy();
    expect(screen.getByText(/4 namespaces/)).toBeTruthy();
    expect(screen.getByRole('table').contains(grouping)).toBe(false);
    if (embedded) return;

    const filter = screen.getByRole('searchbox', { name: 'Filter topics' });
    await fireEvent.input(filter, { target: { value: 'cmd_vel' } });
    expect(screen.getAllByRole('rowheader')).toHaveLength(2);
    expect(screen.queryByText('/clock')).toBeNull();
    expect(screen.queryByText('/robot_1/status')).toBeNull();
    expect(screen.queryByRole('rowheader', { name: /sensors/ })).toBeNull();
    expect(screen.getByText(/2 of 5 topics/)).toBeTruthy();
    await fireEvent.input(filter, { target: { value: 'no_match' } });
    expect(screen.getByText('No topics match the current filter.')).toBeTruthy();
    expect(screen.queryByRole('rowheader')).toBeNull();
    await fireEvent.input(filter, { target: { value: '' } });
    await fireEvent.click(grouping);
    expect(screen.queryByRole('rowheader')).toBeNull();
    expect(screen.getByText('/clock')).toBeTruthy();
    expect(screen.getByText('/robot_1/status')).toBeTruthy();
  });

  it('preserves expanded details, schema, and peek when List grouping is toggled', async () => {
    mockListSimulationContainers.mockResolvedValue([{ id: 'c1', name: 'sim', state: 'running', ports: [] }]);
    mockListRosTopics.mockResolvedValue([
      { name: '/robot_1/status', type: 'std_msgs/msg/String', publishers: 1, subscribers: 0 },
    ]);
    mockGetRosTopicDetail.mockResolvedValue({
      topicName: '/robot_1/status',
      type: 'std_msgs/msg/String',
      publishers: [{ nodeName: 'source', nodeNamespace: '/robot_1' }],
      subscribers: [],
    });
    mockGetRosMessageSchema.mockResolvedValue({ type: 'std_msgs/msg/String', schema: 'string data' });
    mockPeekRosTopic.mockResolvedValue({
      topicName: '/robot_1/status',
      message: 'data: ready',
      timedOut: false,
      capturedAt: new Date().toISOString(),
    });
    renderTopicMonitor();
    await fireEvent.click((await screen.findByText('/robot_1/status')).closest('tr')!);
    await screen.findByText('/robot_1/source');
    await fireEvent.click(screen.getByRole('button', { name: 'Show message schema' }));
    await screen.findByText('string data');
    await fireEvent.click(screen.getByRole('button', { name: 'Peek' }));
    await screen.findByRole('region', { name: 'Peek message' });
    const grouping = screen.getByRole('checkbox', { name: 'Group by namespace' });
    for (let i = 0; i < 2; i++) {
      await fireEvent.click(grouping);
      expect(screen.getByText('/robot_1/source')).toBeTruthy();
      expect(screen.getByText('string data')).toBeTruthy();
      expect(screen.getByRole('region', { name: 'Peek message' })).toBeTruthy();
    }
    expect(mockGetRosTopicDetail).toHaveBeenCalledTimes(1);
    expect(mockPeekRosTopic).toHaveBeenCalledTimes(1);
  });

  it('shows column headers', async () => {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);
    mockListRosTopics.mockResolvedValue([
      { name: '/rosout', type: 'rcl_interfaces/msg/Log', publishers: 1, subscribers: 0 },
    ]);

    renderTopicMonitor();
    await screen.findByText('/rosout');
    expect(screen.getByText('Topic')).toBeTruthy();
    expect(screen.getByText('Message Type')).toBeTruthy();
    expect(screen.getByText('Pubs')).toBeTruthy();
    expect(screen.getByText('Subs')).toBeTruthy();
  });

  it.each([
    ['publishers', 'publisher', 'status', false],
    ['publishers', 'publisher', 'status', true],
    ['subscribers', 'subscriber', 'other', false],
    ['subscribers', 'subscriber', 'other', true],
  ] as const)('filters List by %s with highlighted %s names (%s, grouped=%s)', async (kind, role, suffix, grouped) => {
    mockListSimulationContainers.mockResolvedValue([{ id: 'c1', name: 'sim', state: 'running', ports: [] }]);
    const topics = ['/robot_1/status', '/robot_1/other', '/robot_2/unrelated'].map(name => ({
      name,
      type: 'std_msgs/msg/String',
      publishers: 2,
      subscribers: 2,
    }));
    mockListRosTopics.mockResolvedValue(topics);
    mockGetTopicTopology.mockResolvedValue({
      topics,
      nodes: [
        {
          nodeName: 'behavior_server',
          nodeNamespace: '/',
          publishingTopics: ['/robot_1/status'],
          subscribingTopics: ['/robot_1/other'],
        },
        {
          nodeName: 'other_node',
          nodeNamespace: '/',
          publishingTopics: topics.map(topic => topic.name),
          subscribingTopics: topics.map(topic => topic.name),
        },
      ],
    });
    mockGetRosTopicDetail.mockResolvedValue({
      topicName: `/robot_1/${suffix}`,
      type: 'std_msgs/msg/String',
      publishers: [
        { nodeName: 'behavior_server', nodeNamespace: '/' },
        { nodeName: 'other_node', nodeNamespace: '/' },
      ],
      subscribers: [
        { nodeName: 'behavior_server', nodeNamespace: '/' },
        { nodeName: 'other_node', nodeNamespace: '/' },
      ],
    });
    renderTopicMonitor();
    await screen.findByText('/robot_1/status');
    if (grouped) await fireEvent.click(screen.getByRole('checkbox', { name: 'Group by namespace' }));
    const topicInput = screen.getByRole('searchbox', { name: 'Filter topics' }) as HTMLInputElement;
    await fireEvent.input(topicInput, { target: { value: 'unrelated' } });
    await fireEvent.input(screen.getByRole('searchbox', { name: `Filter ${kind}` }), { target: { value: 'SERVER' } });
    const match = await screen.findByTitle(`Matching ${role}`);
    expect(match.textContent).toBe('/behavior_server');
    expect(topicInput.value).toBe('');
    expect(screen.queryByText('/robot_2/unrelated')).toBeNull();
    expect(screen.queryByText(`/robot_1/${suffix === 'status' ? 'other' : 'status'}`)).toBeNull();
    expect(screen.getByText(/1 of 3 topics/)).toBeTruthy();
    if (grouped) expect(screen.getByRole('rowheader', { name: '/robot_1 (1 topics)' })).toBeTruthy();
    await fireEvent.click(match.closest('tr')!);
    const heading = await screen.findByText(`${kind === 'publishers' ? 'Publishers' : 'Subscribers'} (1 matching)`);
    expect(heading.parentElement!.textContent).toContain('/behavior_server');
    expect(heading.parentElement!.textContent).not.toContain('/other_node');
    expect(heading.parentElement!.querySelector('mark')?.textContent).toBe('/behavior_server');
    await fireEvent.input(screen.getByRole('searchbox', { name: `Filter ${kind}` }), {
      target: { value: 'no_matching_node' },
    });
    await screen.findByText('No topics match the current filter.');
    expect(screen.queryByRole('rowheader')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(screen.getByText('/robot_2/unrelated')).toBeTruthy();
  });

  it('uses the shared topology for List resource filters without another topology request', async () => {
    mockListSimulationContainers.mockResolvedValue([{ id: 'c1', name: 'sim', state: 'running', ports: [] }]);
    const topics = [{ name: '/status', type: 'std_msgs/msg/String', publishers: 1, subscribers: 0 }];
    mockListRosTopics.mockResolvedValue(topics);
    renderTopicMonitor({
      sharedContainerId: 'c1',
      sharedTopology: {
        topics,
        nodes: [{ nodeName: 'server', nodeNamespace: '/', publishingTopics: ['/status'], subscribingTopics: [] }],
        capturedAt: new Date().toISOString(),
      },
    });
    await screen.findByText('/status');
    await fireEvent.input(screen.getByRole('searchbox', { name: 'Filter publishers' }), {
      target: { value: 'server' },
    });
    expect(screen.getByTitle('Matching publisher').textContent).toBe('/server');
    expect(mockGetTopicTopology).not.toHaveBeenCalled();
  });

  it('shows only one loading indicator during initial topic retrieval', async () => {
    mockListSimulationContainers.mockResolvedValue([{ id: 'c1', name: 'sim', state: 'running', ports: [] }]);
    let resolveTopics!: (topics: unknown[]) => void;
    mockListRosTopicSummaries.mockReturnValue(
      new Promise(resolve => {
        resolveTopics = resolve;
      }),
    );
    renderTopicMonitor();
    await screen.findByRole('searchbox', { name: 'Filter topics' });
    expect(screen.getAllByText('Loading topics...')).toHaveLength(1);
    resolveTopics([{ name: '/status', type: 'std_msgs/msg/String', publishers: 1, subscribers: 0 }]);
    await screen.findByText('/status');
    expect(screen.queryByText('Loading topics...')).toBeNull();
  });

  it('reports relationship retrieval failure instead of presenting it as an empty filter result', async () => {
    mockListSimulationContainers.mockResolvedValue([{ id: 'c1', name: 'sim', state: 'running', ports: [] }]);
    mockListRosTopics.mockResolvedValue([
      { name: '/status', type: 'std_msgs/msg/String', publishers: 1, subscribers: 0 },
    ]);
    mockGetTopicTopology.mockRejectedValue(new Error('Topology unavailable'));
    renderTopicMonitor();
    await screen.findByText('/status');
    await fireEvent.input(screen.getByRole('searchbox', { name: 'Filter publishers' }), {
      target: { value: 'server' },
    });
    await screen.findByText('Topology unavailable');
    expect(screen.queryByText('No topics match the current filter.')).toBeNull();
  });

  it('shows expand chevron on topic rows', async () => {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);
    mockListRosTopics.mockResolvedValue([
      { name: '/rosout', type: 'rcl_interfaces/msg/Log', publishers: 1, subscribers: 0 },
    ]);

    renderTopicMonitor();
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

    renderTopicMonitor();
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

    renderTopicMonitor();
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

    renderTopicMonitor();
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

    renderTopicMonitor();
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

    renderTopicMonitor();
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

    renderTopicMonitor();
    await fireEvent.click((await screen.findByText('/idle')).closest('tr')!);
    await screen.findByRole('button', { name: 'Peek' });
    await fireEvent.click(screen.getByRole('button', { name: 'Peek' }));

    expect(await screen.findByText(/No message on \/idle/)).toBeTruthy();
    expect(screen.getByText(/active publishers/)).toBeTruthy();
  });

  it('keeps an expanded row across a poll that returns the same topics', async () => {
    vi.useFakeTimers();
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

    renderTopicMonitor();
    await vi.advanceTimersByTimeAsync(100);
    const topicCell = screen.getByText('/cmd_vel');
    await fireEvent.click(topicCell.closest('tr')!);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText(/teleop_keyboard/)).toBeTruthy();
    expect(screen.getByText('▼')).toBeTruthy();

    mockListRosTopics.mockResolvedValue([
      { name: '/cmd_vel', type: 'geometry_msgs/msg/Twist', publishers: 1, subscribers: 1 },
    ]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.getByText(/teleop_keyboard/)).toBeTruthy();
    expect(screen.getByText('▼')).toBeTruthy();
  });

  it('paints topic names before pub/sub counts resolve', async () => {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);
    mockListRosTopicSummaries.mockResolvedValue([
      {
        name: '/rosout',
        type: 'rcl_interfaces/msg/Log',
        publishers: 0,
        subscribers: 0,
        countsPending: true,
      },
    ]);
    let resolveCounts: (value: unknown) => void = () => {};
    mockListRosTopics.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveCounts = resolve;
        }),
    );

    renderTopicMonitor();
    expect(await screen.findByText('/rosout')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);

    resolveCounts([{ name: '/rosout', type: 'rcl_interfaces/msg/Log', publishers: 3, subscribers: 1 }]);
    expect(await screen.findByText('3')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
  });
});
