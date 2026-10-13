import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import GraphicalTopicMonitor from './GraphicalTopicMonitor.svelte';
import { navigationLayout } from './lib/navigationLayout';

const mockListSimulationContainers = vi.fn();
const mockGetTopicTopology = vi.fn();
const mockGetRosTopicDetail = vi.fn();
const mockGetRosMessageSchema = vi.fn();
const mockPeekRosTopic = vi.fn();
const mockListRosTopics = vi.fn();
const mockListRosTopicSummaries = vi.fn();

vi.mock('./api/client', () => ({
  physicalAiClient: {
    listSimulationContainers: (...args: unknown[]) => mockListSimulationContainers(...args),
    getTopicTopology: (...args: unknown[]) => mockGetTopicTopology(...args),
    getRosTopicDetail: (...args: unknown[]) => mockGetRosTopicDetail(...args),
    getRosMessageSchema: (...args: unknown[]) => mockGetRosMessageSchema(...args),
    peekRosTopic: (...args: unknown[]) => mockPeekRosTopic(...args),
    listRosTopics: (...args: unknown[]) => mockListRosTopics(...args),
    listRosTopicSummaries: (...args: unknown[]) => mockListRosTopicSummaries(...args),
    getTopicPeekTimeoutSeconds: async () => 5,
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
    mockGetTopicTopology.mockResolvedValue({ topics: [], nodes: [], capturedAt: new Date().toISOString() });
    mockGetRosTopicDetail.mockResolvedValue({ topicName: '', type: '', publishers: [], subscribers: [] });
    mockGetRosMessageSchema.mockResolvedValue({ type: '', schema: '' });
    mockListRosTopics.mockResolvedValue([]);
    mockListRosTopicSummaries.mockResolvedValue([]);
    mockPeekRosTopic.mockResolvedValue({
      topicName: '',
      message: '',
      timedOut: false,
      capturedAt: new Date().toISOString(),
    });
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
    mockGetTopicTopology.mockResolvedValue({
      topics: [
        { name: '/cmd_vel', type: 'geometry_msgs/msg/Twist', publishers: 1, subscribers: 1, countsPending: false },
      ],
      nodes: [
        { nodeName: 'teleop', nodeNamespace: '/', publishingTopics: ['/cmd_vel'], subscribingTopics: [] },
        { nodeName: 'base', nodeNamespace: '/', publishingTopics: [], subscribingTopics: ['/cmd_vel'] },
      ],
      capturedAt: new Date().toISOString(),
    });

    render(GraphicalTopicMonitor);
    expect(await screen.findByText(/No simulation is running/)).toBeTruthy();

    await vi.advanceTimersByTimeAsync(5000);

    expect(await screen.findByText(/1 topics · 0 connected nodes/)).toBeTruthy();
    expect(mockGetTopicTopology).toHaveBeenCalledWith('c1');
    expect(screen.getByRole('img', { name: 'ROS 2 topic topology graph' })).toBeTruthy();
    expect(
      screen.getByRole('img', { name: 'ROS 2 topic topology graph' }).querySelectorAll(':scope > path'),
    ).toHaveLength(0);
  });

  it('opens a topic inspector from the graph', async () => {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);
    mockGetTopicTopology.mockResolvedValue({
      topics: [{ name: '/cmd_vel', type: 'geometry_msgs/msg/Twist', publishers: 1, subscribers: 1 }],
      nodes: [],
      capturedAt: new Date().toISOString(),
    });
    mockGetRosTopicDetail.mockResolvedValue({
      topicName: '/cmd_vel',
      type: 'geometry_msgs/msg/Twist',
      publishers: [{ nodeName: 'teleop', nodeNamespace: '/' }],
      subscribers: [{ nodeName: 'base', nodeNamespace: '/' }],
    });

    render(GraphicalTopicMonitor);
    await screen.findByText(/1 topics · 0 connected nodes/);
    await fireEvent.click(await screen.findByRole('button', { name: 'Select topic /cmd_vel' }));

    expect(await screen.findByText('Topic inspector')).toBeTruthy();
    expect(mockGetRosTopicDetail).toHaveBeenCalledWith('c1', '/cmd_vel');

    const topicButton = screen.getByRole('button', { name: 'Select topic /cmd_vel' });
    expect(topicButton.getAttribute('aria-pressed')).toBe('true');
    expect(topicButton.querySelector('rect')?.getAttribute('style')).toContain(
      'fill: var(--pd-button-secondary-bg, #ede9fe)',
    );
    expect(topicButton.querySelector('text')?.getAttribute('style')).toContain(
      'fill: var(--pd-button-secondary-text, var(--pai-accent, #7c3aed))',
    );
    expect(
      screen
        .getByRole('img', { name: 'ROS 2 topic topology graph' })
        .querySelector('marker path')
        ?.getAttribute('style'),
    ).toContain('fill: var(--pai-accent, #7c3aed)');

    await fireEvent.click(topicButton);
    expect(await screen.findByText('Select a node or topic to inspect its relationships.')).toBeTruthy();
  });

  it('shows the backend peek timeout message in the Graph inspector', async () => {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);
    mockGetTopicTopology.mockResolvedValue({
      topics: [{ name: '/robot_1/tf', type: 'tf2_msgs/msg/TFMessage', publishers: 1, subscribers: 0 }],
      nodes: [],
    });
    mockGetRosTopicDetail.mockResolvedValue({
      topicName: '/robot_1/tf',
      type: 'tf2_msgs/msg/TFMessage',
      publishers: [],
      subscribers: [],
    });
    mockPeekRosTopic.mockResolvedValue({
      topicName: '/robot_1/tf',
      message: '',
      timedOut: true,
      error:
        'No message on /robot_1/tf within 5s. The topic may be idle or publishing infrequently — try one with active publishers',
      capturedAt: new Date().toISOString(),
    });
    render(GraphicalTopicMonitor);
    await fireEvent.click(await screen.findByRole('button', { name: 'Select topic /robot_1/tf' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Peek' }));
    expect(await screen.findByText(/No message on \/robot_1\/tf within 5s/)).toBeTruthy();
    expect(screen.queryByText('Peeking...')).toBeNull();
  });

  it('opens Cards topic and node inspection in Graph', async () => {
    mockConnectedGraph();
    render(GraphicalTopicMonitor);
    await screen.findByRole('button', { name: 'Select topic /shared' });
    await fireEvent.click(screen.getByRole('button', { name: 'Cards' }));
    await fireEvent.click(screen.getAllByRole('button', { name: 'Inspect in Graph' })[0]);
    expect(screen.getByRole('button', { name: 'Graph' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Select topic /shared' }).getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(screen.getByRole('button', { name: 'Cards' }));
    await fireEvent.click(screen.getAllByRole('button', { name: '/source' })[0]);
    expect(screen.getByRole('button', { name: 'Graph' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Selected publisher:')).toBeTruthy();
  });

  it('filters subscribers by node name and keeps only connected graph context', async () => {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);
    mockGetTopicTopology.mockResolvedValue({
      topics: [
        { name: '/server_status', type: 'std_msgs/msg/String', publishers: 1, subscribers: 1 },
        { name: '/camera', type: 'sensor_msgs/msg/Image', publishers: 1, subscribers: 1 },
      ],
      nodes: [
        {
          nodeName: 'status_publisher',
          nodeNamespace: '/',
          publishingTopics: ['/server_status'],
          subscribingTopics: [],
        },
        {
          nodeName: 'behavior_server',
          nodeNamespace: '/',
          publishingTopics: [],
          subscribingTopics: ['/server_status'],
        },
        { nodeName: 'camera_viewer', nodeNamespace: '/', publishingTopics: [], subscribingTopics: ['/camera'] },
      ],
      capturedAt: new Date().toISOString(),
    });

    render(GraphicalTopicMonitor);
    await screen.findByText(/2 topics · 0 connected nodes/);
    await fireEvent.input(screen.getByLabelText('Filter subscribers'), { target: { value: 'server' } });

    expect(await screen.findByRole('button', { name: 'Select node /behavior_server' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Select node /camera_viewer' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Select topic /server_status' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Select topic /camera' })).toBeNull();
    expect(
      screen.getByRole('img', { name: 'ROS 2 topic topology graph' }).querySelectorAll(':scope > path'),
    ).toHaveLength(0);

    await fireEvent.click(screen.getByRole('button', { name: 'Select node /behavior_server' }));
    expect(await screen.findByText('Node inspector')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Select topic /server_status' })).toBeTruthy();
    expect(
      screen.getByRole('img', { name: 'ROS 2 topic topology graph' }).querySelectorAll(':scope > path'),
    ).toHaveLength(2);
  });

  function mockConnectedGraph() {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);
    mockGetTopicTopology.mockResolvedValue({
      topics: ['/shared', '/other'].map(name => ({ name, type: 'std_msgs/msg/String', publishers: 2, subscribers: 2 })),
      nodes: [
        { nodeName: 'source', nodeNamespace: '/', publishingTopics: ['/shared'], subscribingTopics: ['/other'] },
        {
          nodeName: 'another_source',
          nodeNamespace: '/',
          publishingTopics: ['/shared', '/other'],
          subscribingTopics: [],
        },
        { nodeName: 'sink', nodeNamespace: '/', publishingTopics: ['/other'], subscribingTopics: ['/shared'] },
        {
          nodeName: 'another_sink',
          nodeNamespace: '/',
          publishingTopics: [],
          subscribingTopics: ['/shared', '/other'],
        },
      ],
    });
  }

  it('retains List filters and grouping without remounting, while preserving Cards and Graph state', async () => {
    mockConnectedGraph();
    const topics = ['/shared', '/other'].map(name => ({
      name,
      type: 'std_msgs/msg/String',
      publishers: 2,
      subscribers: 2,
    }));
    mockListRosTopicSummaries.mockReturnValue(new Promise(() => {}));
    mockListRosTopics.mockResolvedValue(topics);
    render(GraphicalTopicMonitor);
    await screen.findByRole('button', { name: 'Select topic /shared' });
    await fireEvent.click(screen.getByRole('button', { name: 'Cards' }));
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Group by namespace' }));
    await fireEvent.click(screen.getByRole('button', { name: 'List' }));
    const table = await screen.findByRole('table');
    expect(screen.queryByText('Loading topics...')).toBeNull();
    const input = screen.getByRole('searchbox', { name: 'Filter publishers' }) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'source' } });
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Group by namespace' }));
    expect(screen.getByRole('rowheader', { name: '/ (2 topics)' })).toBeTruthy();
    const initialRequests = mockListRosTopicSummaries.mock.calls.length;
    await fireEvent.click(screen.getByRole('button', { name: 'Cards' }));
    expect((screen.getByRole('checkbox', { name: 'Group by namespace' }) as HTMLInputElement).checked).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockListRosTopicSummaries).toHaveBeenCalledTimes(initialRequests);
    await fireEvent.click(screen.getByRole('button', { name: 'Graph' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Select node /source' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Select topic /shared' }));
    await fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByRole('table')).toBe(table);
    expect((screen.getByRole('searchbox', { name: 'Filter publishers' }) as HTMLInputElement).value).toBe('source');
    expect((screen.getByRole('checkbox', { name: 'Group by namespace' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText('Loading topics...')).toBeNull();
    expect(mockListRosTopicSummaries).toHaveBeenCalledTimes(initialRequests);
    await fireEvent.click(screen.getByRole('button', { name: 'Graph' }));
    expect(screen.getByRole('button', { name: 'Select topic /shared' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shares topic and role-specific filters across Graph, Cards, and List in both directions', async () => {
    mockConnectedGraph();
    mockListRosTopicSummaries.mockResolvedValue(
      ['/shared', '/other'].map(name => ({ name, type: 'std_msgs/msg/String', publishers: 2, subscribers: 2 })),
    );
    render(GraphicalTopicMonitor);
    await screen.findByRole('button', { name: 'Select topic /shared' });
    await fireEvent.input(screen.getByRole('searchbox', { name: 'Filter topics' }), { target: { value: 'shared' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Cards' }));
    expect(screen.getByText('/shared', { selector: 'summary' })).toBeTruthy();
    expect(screen.queryByText('/other', { selector: 'summary' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'List' }));
    await screen.findByRole('table');
    expect((screen.getByRole('searchbox', { name: 'Filter topics' }) as HTMLInputElement).value).toBe('shared');
    await fireEvent.input(screen.getByRole('searchbox', { name: 'Filter publishers' }), {
      target: { value: 'source' },
    });
    expect((screen.getByRole('searchbox', { name: 'Filter topics' }) as HTMLInputElement).value).toBe('');
    expect(Array.from(screen.getByRole('table').querySelectorAll('mark')).map(mark => mark.textContent)).toContain(
      '/source',
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Cards' }));
    expect((screen.getByRole('searchbox', { name: 'Filter publishers' }) as HTMLInputElement).value).toBe('source');
    await fireEvent.click(screen.getByRole('button', { name: 'Graph' }));
    expect(screen.getByRole('button', { name: 'Select node /source' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Select topic /shared' })).toBeNull();
    await fireEvent.input(screen.getByRole('searchbox', { name: 'Filter subscribers' }), { target: { value: 'sink' } });
    await fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect((screen.getByRole('searchbox', { name: 'Filter subscribers' }) as HTMLInputElement).value).toBe('sink');
    expect((screen.getByRole('searchbox', { name: 'Filter publishers' }) as HTMLInputElement).value).toBe('');
    expect(Array.from(screen.getByRole('table').querySelectorAll('mark')).map(mark => mark.textContent)).toContain(
      '/sink',
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cards' }));
    expect((screen.getByRole('searchbox', { name: 'Filter subscribers' }) as HTMLInputElement).value).toBe('');
    expect(screen.getByText('/other', { selector: 'summary' })).toBeTruthy();
  });

  it('keeps the Cards grouping control outside the scrolling topics and shows its active state', async () => {
    mockConnectedGraph();
    render(GraphicalTopicMonitor);
    await screen.findByRole('button', { name: 'Select topic /shared' });
    await fireEvent.click(screen.getByRole('button', { name: 'Cards' }));
    const grouping = screen.getByRole('checkbox', { name: 'Group by namespace' });
    const cards = screen.getByText('/shared', { selector: 'summary' }).closest('details')!.parentElement!;
    expect(cards.contains(grouping)).toBe(false);
    await fireEvent.click(grouping);
    expect(screen.getByText('Topics grouped by namespace')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '/ (2 topics)' })).toBeTruthy();
    await fireEvent.click(grouping);
    expect(screen.queryByRole('heading', { name: '/ (2 topics)' })).toBeNull();
    expect(screen.getByText('Group by namespace')).toBeTruthy();
  });

  it.each([
    ['publishers', 'publisher', 'status', false],
    ['publishers', 'publisher', 'status', true],
    ['subscribers', 'subscriber', 'subscribed', false],
    ['subscribers', 'subscriber', 'subscribed', true],
  ] as const)('filters Cards by %s before grouping (grouped=%s)', async (kind, role, suffix, grouped) => {
    mockListSimulationContainers.mockResolvedValue([{ id: 'c1', name: 'sim', state: 'running', ports: [] }]);
    const topicNames = [
      '/robot_1/status',
      '/robot_2/status',
      '/robot_1/subscribed',
      '/robot_2/subscribed',
      '/robot_1/unrelated',
      '/orphan/without_endpoints',
    ];
    mockGetTopicTopology.mockResolvedValue({
      topics: topicNames.map(name => ({ name, type: 'std_msgs/msg/String', publishers: 1, subscribers: 1 })),
      nodes: [
        {
          nodeName: 'behavior_server',
          nodeNamespace: '/',
          publishingTopics: ['/robot_1/status', '/robot_2/status'],
          subscribingTopics: ['/robot_1/subscribed', '/robot_2/subscribed'],
        },
        {
          nodeName: 'other_node',
          nodeNamespace: '/',
          publishingTopics: ['/robot_1/status', '/robot_1/subscribed', '/robot_1/unrelated'],
          subscribingTopics: ['/robot_1/subscribed', '/robot_1/status'],
        },
      ],
    });
    render(GraphicalTopicMonitor);
    await screen.findByRole('button', { name: 'Select topic /robot_1/status' });
    await fireEvent.click(screen.getByRole('button', { name: 'Cards' }));
    if (grouped) await fireEvent.click(screen.getByRole('checkbox', { name: 'Group by namespace' }));
    const topicFilter = screen.getByLabelText('Filter topics') as HTMLInputElement;
    await fireEvent.input(topicFilter, { target: { value: 'unrelated' } });
    await fireEvent.input(screen.getByLabelText(`Filter ${kind}`), { target: { value: 'SERVER' } });
    expect(topicFilter.value).toBe('');
    expect(Array.from(document.querySelectorAll('summary')).map(summary => summary.textContent)).toEqual([
      `/robot_1/${suffix}`,
      `/robot_2/${suffix}`,
    ]);
    expect(screen.getByText(new RegExp(`2 matching topics.*1 matching ${kind}.*2 namespaces`))).toBeTruthy();
    expect(screen.queryByText(/connected nodes/)).toBeNull();
    expect(screen.getAllByTitle(`Matching ${role}`)).toHaveLength(2);
    const firstCard = screen.getByText(`/robot_1/${suffix}`, { selector: 'summary' }).closest('details')!;
    expect(firstCard.textContent).toContain('/other_node');
    expect(firstCard.querySelector('mark')?.textContent).toBe('/behavior_server');
    if (grouped) {
      expect(screen.getByRole('heading', { name: '/robot_1 (1 topics)' })).toBeTruthy();
      expect(screen.getByRole('heading', { name: '/robot_2 (1 topics)' })).toBeTruthy();
      expect(screen.queryByRole('heading', { name: `/robot_1/${suffix}` })).toBeNull();
      expect(screen.queryByRole('heading', { name: '/orphan' })).toBeNull();
    }
    await fireEvent.input(screen.getByLabelText(`Filter ${kind}`), { target: { value: 'no_such_node' } });
    expect(screen.getByText('No topics match the current filter.')).toBeTruthy();
    expect(document.querySelectorAll('summary')).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: '/robot_1 (1 topics)' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(document.querySelectorAll('summary')).toHaveLength(topicNames.length);
  });

  it.each([
    ['publishers', 'source', '/source', '/another_source'],
    ['subscribers', 'sink', '/sink', '/another_sink'],
  ])('limits a filtered %s selection to its role and retains the query', async (kind, query, selected, excluded) => {
    mockConnectedGraph();
    render(GraphicalTopicMonitor);
    await screen.findByRole('button', { name: 'Select topic /shared' });
    const input = screen.getByLabelText(`Filter ${kind}`) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: query } });
    await fireEvent.click(screen.getByRole('button', { name: `Select node ${selected}` }));
    expect(input.value).toBe(query);
    expect(screen.queryByRole('button', { name: `Select node ${excluded}` })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Select topic /other' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Select topic /shared' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /Back to .* results/ }));
    expect(input.value).toBe(query);
    expect(screen.getByRole('button', { name: `Select node ${excluded}` })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Select topic /shared' })).toBeNull();
  });

  it('preserves topic context and geometry when clicking its publisher or subscriber', async () => {
    mockConnectedGraph();
    render(GraphicalTopicMonitor);
    await screen.findByRole('button', { name: 'Select topic /shared' });
    const input = screen.getByLabelText('Filter topics') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'shared' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Select topic /shared' }));
    const graph = screen.getByRole('img', { name: 'ROS 2 topic topology graph' });
    const before = Array.from(graph.querySelectorAll('rect')).map(rect => rect.getAttribute('y'));
    for (const node of ['/source', '/sink']) {
      await fireEvent.click(screen.getByRole('button', { name: `Select node ${node}` }));
      expect(screen.queryByRole('button', { name: 'Select topic /other' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Select topic /shared' }).getAttribute('aria-pressed')).toBe('true');
      expect(Array.from(graph.querySelectorAll('rect')).map(rect => rect.getAttribute('y'))).toEqual(before);
      expect(input.value).toBe('shared');
    }
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Select topic /shared' }).getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(screen.getByRole('button', { name: 'Back to topic results' }));
    expect(screen.queryByRole('button', { name: 'Select node /source' })).toBeNull();
  });

  it('wraps full names and reserves a separate row for expandable connections', async () => {
    const name = '/robot_1/local_costmap/clearly_distinct_topic_name';
    mockListSimulationContainers.mockResolvedValue([{ id: 'c1', name: 'sim', state: 'running', ports: [] }]);
    mockGetTopicTopology.mockResolvedValue({
      topics: [{ name, type: 'std_msgs/msg/String', publishers: 7, subscribers: 7 }],
      nodes: Array.from({ length: 7 }, (_, index) => ({
        nodeName: `node_${index}`,
        nodeNamespace: '/',
        publishingTopics: [name],
        subscribingTopics: [name],
      })),
    });
    render(GraphicalTopicMonitor);
    const topic = await screen.findByRole('button', { name: `Select topic ${name}` });
    expect(topic.querySelector('text')?.textContent).toBe(name);
    expect(topic.querySelector('title')?.textContent).toBe(name);
    expect(topic.querySelectorAll('tspan').length).toBeGreaterThan(1);
    await fireEvent.click(topic);
    const more = screen.getByRole('button', { name: 'Show 2 more publishers' });
    const last = screen.getAllByRole('button', { name: 'Select node /node_4' })[0];
    const bottom =
      Number(last.querySelector('rect')?.getAttribute('y')) +
      Number(last.querySelector('rect')?.getAttribute('height'));
    expect(Number(more.querySelector('rect')?.getAttribute('y'))).toBeGreaterThan(bottom);
    expect(screen.queryByRole('button', { name: 'Select node /node_6' })).toBeNull();
    const svg = screen.getByRole('img', { name: 'ROS 2 topic topology graph' });
    const viewport = svg.parentElement!;
    Object.defineProperty(viewport, 'clientHeight', { value: 200, configurable: true });
    await fireEvent.scroll(viewport);
    const topicRect = topic.querySelector('rect')!;
    const focusedCenter = () => Number(topicRect.getAttribute('y')) + Number(topicRect.getAttribute('height')) / 2;
    expect(focusedCenter()).toBe(100);
    await fireEvent.click(more);
    expect(screen.getByRole('button', { name: 'Select node /node_6' })).toBeTruthy();
    expect(focusedCenter()).toBe(100);
    viewport.scrollTop = 200;
    await fireEvent.scroll(viewport);
    const topicCenter = focusedCenter();
    expect(topicCenter).toBe(300);
    for (const edge of svg.querySelectorAll(':scope > path')) {
      expect(edge.getAttribute('d')).toMatch(new RegExp(`(?:V${topicCenter} H410|M590 ${topicCenter} H620)`));
    }
    await fireEvent.click(screen.getByRole('button', { name: 'Show fewer publishers' }));
    expect(screen.queryByRole('button', { name: 'Select node /node_6' })).toBeNull();
  });
});
