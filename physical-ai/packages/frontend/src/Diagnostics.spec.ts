import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import Diagnostics from './Diagnostics.svelte';
import { navigationLayout } from './lib/navigationLayout';
import { lastOpenShiftSelection } from './lib/simSelection';

const mockListSimulationContainers = vi.fn();
const mockListRosTopics = vi.fn();
const mockListSpawnedRobotsInSimulation = vi.fn();
const mockListSpawnedRobotsInOpenShift = vi.fn();
const mockListOpenShiftDeployments = vi.fn();
const mockGetOpenShiftContext = vi.fn();
const mockGetDefaultOpenShiftNamespace = vi.fn();
const mockListKubeContexts = vi.fn();
const mockListOpenShiftProjects = vi.fn();
const mockGoto = vi.fn();

vi.mock('./api/client', () => ({
  physicalAiClient: {
    listSimulationContainers: (...args: unknown[]) => mockListSimulationContainers(...args),
    listRosTopics: (...args: unknown[]) => mockListRosTopics(...args),
    listSpawnedRobotsInSimulation: (...args: unknown[]) => mockListSpawnedRobotsInSimulation(...args),
    listSpawnedRobotsInOpenShift: (...args: unknown[]) => mockListSpawnedRobotsInOpenShift(...args),
    listOpenShiftDeployments: (...args: unknown[]) => mockListOpenShiftDeployments(...args),
    getOpenShiftContext: (...args: unknown[]) => mockGetOpenShiftContext(...args),
    getDefaultOpenShiftNamespace: (...args: unknown[]) => mockGetDefaultOpenShiftNamespace(...args),
    listKubeContexts: (...args: unknown[]) => mockListKubeContexts(...args),
    listOpenShiftProjects: (...args: unknown[]) => mockListOpenShiftProjects(...args),
  },
}));

vi.mock('tinro', () => ({
  router: { goto: (...args: unknown[]) => mockGoto(...args) },
}));

function workload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: 'ros2-jazzy-sim',
    namespace: 'ns1',
    replicas: 1,
    readyReplicas: 1,
    ready: true,
    ...overrides,
  };
}

describe('Diagnostics', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    navigationLayout.set('sidebar');
    lastOpenShiftSelection.set(undefined);
    mockListSimulationContainers.mockResolvedValue([]);
    mockListRosTopics.mockResolvedValue([]);
    mockListSpawnedRobotsInSimulation.mockResolvedValue([]);
    mockListSpawnedRobotsInOpenShift.mockResolvedValue([]);
    mockListOpenShiftDeployments.mockResolvedValue([]);
    mockGetOpenShiftContext.mockResolvedValue(undefined);
    mockGetDefaultOpenShiftNamespace.mockResolvedValue('');
    mockListKubeContexts.mockResolvedValue([]);
    mockListOpenShiftProjects.mockResolvedValue([]);
  });

  afterEach(() => {
    lastOpenShiftSelection.set(undefined);
  });

  it('shows a no-simulation message when there is no query and nothing running', async () => {
    render(Diagnostics, { props: { query: {} } });
    expect(await screen.findByText(/No simulation is running/)).toBeTruthy();
  });

  it('shows the "Show OpenShift simulations…" toggle when nothing has auto-resolved', async () => {
    render(Diagnostics, { props: { query: {} } });
    await screen.findByText(/No simulation is running/);
    expect(screen.getByRole('button', { name: /show openshift simulations/i })).toBeTruthy();
  });

  it('falls back to the first running container when no query is given', async () => {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);
    mockListSpawnedRobotsInSimulation.mockResolvedValue(['robot_1']);

    render(Diagnostics, { props: { query: {} } });
    await waitFor(() => expect(mockListSpawnedRobotsInSimulation).toHaveBeenCalledWith('c1'));
    expect(await screen.findByRole('button', { name: 'Refresh diagnostics' })).toBeTruthy();

    const select = (await screen.findByLabelText('Simulation')) as HTMLSelectElement;
    expect(select.value).toBe('podman:c1');
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

  it('uses an oc deep link directly, adding it to the list even when discovery finds nothing', async () => {
    render(Diagnostics, {
      props: {
        query: { target: 'oc', namespace: 'ns1', workload: 'ros2-jazzy-sim', robot: 'robot_1', context: 'ctx1' },
      },
    });

    await waitFor(() => expect(mockListSpawnedRobotsInOpenShift).toHaveBeenCalledWith('ns1', 'ros2-jazzy-sim', 'ctx1'));

    const select = (await screen.findByLabelText('Simulation')) as HTMLSelectElement;
    expect(select.value).toBe('oc:ns1/ros2-jazzy-sim/ctx1');
    expect(screen.getByText('OpenShift — ns1/ros2-jazzy-sim')).toBeTruthy();

    const robotSelect = (await screen.findByLabelText('Robot')) as HTMLSelectElement;
    expect(robotSelect.value).toBe('robot_1');
  });

  it('resolves the OpenShift namespace/context from lastOpenShiftSelection when no query is given', async () => {
    lastOpenShiftSelection.set({ context: 'ctx1', namespace: 'ns1' });
    mockListOpenShiftDeployments.mockResolvedValue([workload({ name: 'sim1' })]);

    render(Diagnostics, { props: { query: {} } });

    await waitFor(() => expect(mockListOpenShiftDeployments).toHaveBeenCalledWith('ns1', 'ctx1'));
    expect(mockGetOpenShiftContext).not.toHaveBeenCalled();
    expect(await screen.findByText('OpenShift — ns1/sim1')).toBeTruthy();
  });

  it('falls back to getOpenShiftContext when no store value is set', async () => {
    mockGetOpenShiftContext.mockResolvedValue({ context: 'ctx2', kubeconfigPath: '/x', namespace: 'teamns' });
    mockListOpenShiftDeployments.mockResolvedValue([workload({ name: 'sim2', namespace: 'teamns' })]);

    render(Diagnostics, { props: { query: {} } });

    await waitFor(() => expect(mockListOpenShiftDeployments).toHaveBeenCalledWith('teamns', 'ctx2'));
    expect(await screen.findByText('OpenShift — teamns/sim2')).toBeTruthy();
  });

  it('falls back to getDefaultOpenShiftNamespace when the context has no real namespace', async () => {
    mockGetOpenShiftContext.mockResolvedValue({ context: 'ctx3', kubeconfigPath: '/x', namespace: 'default' });
    mockGetDefaultOpenShiftNamespace.mockResolvedValue('fallback-ns');
    mockListOpenShiftDeployments.mockResolvedValue([workload({ name: 'sim3', namespace: 'fallback-ns' })]);

    render(Diagnostics, { props: { query: {} } });

    await waitFor(() => expect(mockListOpenShiftDeployments).toHaveBeenCalledWith('fallback-ns', 'ctx3'));
    expect(await screen.findByText('OpenShift — fallback-ns/sim3')).toBeTruthy();
  });

  it('lists local and OpenShift options together with prefixed labels', async () => {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);
    lastOpenShiftSelection.set({ context: 'ctx1', namespace: 'ns1' });
    mockListOpenShiftDeployments.mockResolvedValue([workload({ name: 'sim1' })]);

    render(Diagnostics, { props: { query: {} } });

    await screen.findByText('Local — pai-sim-123 — ros2-jazzy-sim:noble');
    expect(screen.getByText('OpenShift — ns1/sim1')).toBeTruthy();

    const select = (await screen.findByLabelText('Simulation')) as HTMLSelectElement;
    // Local containers are preferred over OpenShift ones for the default selection.
    expect(select.value).toBe('podman:c1');
  });

  it('lets the user switch to a manually chosen namespace/cluster, merging in new workloads and updating the store', async () => {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);
    mockListKubeContexts.mockResolvedValue([{ name: 'ctx-a', clusterUrl: 'https://ctx-a' }]);
    mockListOpenShiftProjects.mockResolvedValue(['proj-a']);
    mockListOpenShiftDeployments.mockResolvedValue([workload({ name: 'wl1', namespace: 'proj-a' })]);

    render(Diagnostics, { props: { query: {} } });
    await screen.findByLabelText('Simulation');

    await fireEvent.click(screen.getByRole('button', { name: /show openshift simulations/i }));
    await screen.findByLabelText('Cluster');

    const contextSelect = screen.getByLabelText('Cluster') as HTMLSelectElement;
    await fireEvent.change(contextSelect, { target: { value: 'ctx-a' } });

    const namespaceInput = screen.getByLabelText('Project / namespace') as HTMLInputElement;
    await fireEvent.input(namespaceInput, { target: { value: 'proj-a' } });

    await fireEvent.click(screen.getByRole('button', { name: /use this namespace/i }));

    await waitFor(() => expect(mockListOpenShiftDeployments).toHaveBeenCalledWith('proj-a', 'ctx-a'));
    expect(await screen.findByText('OpenShift — proj-a/wl1')).toBeTruthy();

    let stored: { context: string; namespace: string } | undefined = undefined;
    lastOpenShiftSelection.subscribe(v => (stored = v))();
    expect(stored).toEqual({ context: 'ctx-a', namespace: 'proj-a' });
  });

  it('reconciles the selection instead of stranding it when switching to a namespace with no deployments', async () => {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);
    lastOpenShiftSelection.set({ context: 'ctx-a', namespace: 'proj-a' });
    mockListOpenShiftDeployments.mockResolvedValue([workload({ name: 'wl1', namespace: 'proj-a' })]);
    mockListKubeContexts.mockResolvedValue([{ name: 'ctx-a', clusterUrl: 'https://ctx-a' }]);
    mockListOpenShiftProjects.mockResolvedValue(['proj-a', 'empty-ns']);

    render(Diagnostics, { props: { query: {} } });
    const select = (await screen.findByLabelText('Simulation')) as HTMLSelectElement;
    // Local wins the no-query default-priority chain even though OpenShift also resolved — the
    // user manually switches to the OpenShift option via the dropdown itself.
    await waitFor(() => expect(select.value).toBe('podman:c1'));
    await fireEvent.change(select, { target: { value: 'oc:proj-a/wl1/ctx-a' } });
    expect(select.value).toBe('oc:proj-a/wl1/ctx-a');

    mockListOpenShiftDeployments.mockResolvedValue([]);
    await fireEvent.click(screen.getByRole('button', { name: /switch cluster\/namespace/i }));
    const namespaceInput = screen.getByLabelText('Project / namespace') as HTMLInputElement;
    await fireEvent.input(namespaceInput, { target: { value: 'empty-ns' } });
    await fireEvent.click(screen.getByRole('button', { name: /use this namespace/i }));

    await waitFor(() => expect(mockListOpenShiftDeployments).toHaveBeenCalledWith('empty-ns', 'ctx-a'));
    // Falls back to the local container instead of leaving `select` pointed at the now-gone oc
    // key (which would otherwise silently resolve to no target while the dropdown still shows it).
    await waitFor(() => expect(select.value).toBe('podman:c1'));
    expect(screen.getByText(/No simulations found in "empty-ns"/)).toBeTruthy();
    expect(screen.queryByText(/No simulation is running/)).toBeNull();
  });

  it('re-runs discovery and picks up a newly started simulation on Refresh', async () => {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);

    render(Diagnostics, { props: { query: {} } });
    await screen.findByLabelText('Simulation');
    expect(screen.queryByText('Local — pai-sim-456 — ros2-jazzy-sim:noble')).toBeNull();

    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
      { id: 'c2', name: 'pai-sim-456', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);

    await fireEvent.click(screen.getByRole('button', { name: /^refresh$/i }));

    expect(await screen.findByText('Local — pai-sim-456 — ros2-jazzy-sim:noble')).toBeTruthy();
  });
});
