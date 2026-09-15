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

  it('defaults to the Local tab with no query, showing a no-simulation message', async () => {
    render(Diagnostics, { props: { query: {} } });
    expect(await screen.findByText(/No simulation is running/)).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Local' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'OpenShift' }).getAttribute('aria-selected')).toBe('false');
    expect(mockListKubeContexts).not.toHaveBeenCalled();
    expect(mockGetOpenShiftContext).not.toHaveBeenCalled();
  });

  it('defaults to the OpenShift tab via ?target=oc', async () => {
    render(Diagnostics, { props: { query: { target: 'oc' } } });
    await waitFor(() => expect(mockListKubeContexts).toHaveBeenCalled());
    expect(screen.getByRole('tab', { name: 'OpenShift' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Local' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByLabelText('Cluster')).toBeTruthy();
    expect(screen.getByLabelText('Project / namespace')).toBeTruthy();
  });

  it('falls back to the first running container when no query is given (Local tab)', async () => {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);
    mockListSpawnedRobotsInSimulation.mockResolvedValue(['robot_1']);

    render(Diagnostics, { props: { query: {} } });
    await waitFor(() => expect(mockListSpawnedRobotsInSimulation).toHaveBeenCalledWith('c1'));
    expect(await screen.findByRole('button', { name: 'Refresh diagnostics' })).toBeTruthy();

    const select = (await screen.findByLabelText('Simulation')) as HTMLSelectElement;
    expect(select.value).toBe('c1');
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

  it('re-runs discovery and picks up a newly started simulation on Refresh (Local tab)', async () => {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);

    render(Diagnostics, { props: { query: {} } });
    await screen.findByLabelText('Simulation');
    expect(screen.queryByText('pai-sim-456 — ros2-jazzy-sim:noble')).toBeNull();

    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
      { id: 'c2', name: 'pai-sim-456', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);

    await fireEvent.click(screen.getByRole('button', { name: /^refresh$/i }));

    expect(await screen.findByText('pai-sim-456 — ros2-jazzy-sim:noble')).toBeTruthy();
  });

  it('resolves the OpenShift namespace/context from lastOpenShiftSelection when the tab is activated', async () => {
    lastOpenShiftSelection.set({ context: 'ctx1', namespace: 'ns1' });
    mockListOpenShiftDeployments.mockResolvedValue([workload({ name: 'sim1' })]);
    mockListSpawnedRobotsInOpenShift.mockResolvedValue(['robot_1']);

    render(Diagnostics, { props: { query: {} } });
    await fireEvent.click(screen.getByRole('tab', { name: 'OpenShift' }));

    await waitFor(() => expect(mockListOpenShiftDeployments).toHaveBeenCalledWith('ns1', 'ctx1'));
    expect(mockGetOpenShiftContext).not.toHaveBeenCalled();
    expect(await screen.findByLabelText('Robot')).toBeTruthy();
    expect(mockListSpawnedRobotsInOpenShift).toHaveBeenCalledWith('ns1', 'sim1', 'ctx1');
  });

  it('falls back to getOpenShiftContext when no store value is set', async () => {
    mockGetOpenShiftContext.mockResolvedValue({ context: 'ctx2', kubeconfigPath: '/x', namespace: 'teamns' });
    mockListOpenShiftDeployments.mockResolvedValue([workload({ name: 'sim2', namespace: 'teamns' })]);
    mockListSpawnedRobotsInOpenShift.mockResolvedValue(['robot_1']);

    render(Diagnostics, { props: { query: { target: 'oc' } } });

    await waitFor(() => expect(mockListOpenShiftDeployments).toHaveBeenCalledWith('teamns', 'ctx2'));
    expect(await screen.findByLabelText('Robot')).toBeTruthy();
    expect(mockListSpawnedRobotsInOpenShift).toHaveBeenCalledWith('teamns', 'sim2', 'ctx2');
  });

  it('falls back to getDefaultOpenShiftNamespace when the context has no real namespace', async () => {
    mockGetOpenShiftContext.mockResolvedValue({ context: 'ctx3', kubeconfigPath: '/x', namespace: 'default' });
    mockGetDefaultOpenShiftNamespace.mockResolvedValue('fallback-ns');
    mockListOpenShiftDeployments.mockResolvedValue([workload({ name: 'sim3', namespace: 'fallback-ns' })]);
    mockListSpawnedRobotsInOpenShift.mockResolvedValue(['robot_1']);

    render(Diagnostics, { props: { query: { target: 'oc' } } });

    await waitFor(() => expect(mockListOpenShiftDeployments).toHaveBeenCalledWith('fallback-ns', 'ctx3'));
    expect(await screen.findByLabelText('Robot')).toBeTruthy();
    expect(mockListSpawnedRobotsInOpenShift).toHaveBeenCalledWith('fallback-ns', 'sim3', 'ctx3');
  });

  it('shows a workload picker when a namespace has more than one deployment', async () => {
    lastOpenShiftSelection.set({ context: 'ctx1', namespace: 'ns1' });
    mockListOpenShiftDeployments.mockResolvedValue([
      workload({ name: 'sim1' }),
      workload({ name: 'sim2', ready: false }),
    ]);

    render(Diagnostics, { props: { query: { target: 'oc' } } });

    const select = (await screen.findByLabelText('Simulation')) as HTMLSelectElement;
    expect(select.value).toBe('sim1');
    expect(screen.getByText('sim2 (starting…)')).toBeTruthy();
  });

  it('clears the selected workload when the Cluster dropdown changes, instead of probing a stale combination', async () => {
    lastOpenShiftSelection.set({ context: 'ctx1', namespace: 'ns1' });
    mockListOpenShiftDeployments.mockResolvedValue([workload({ name: 'sim1' })]);
    mockListKubeContexts.mockResolvedValue([
      { name: 'ctx1', clusterUrl: 'https://ctx1' },
      { name: 'ctx2', clusterUrl: 'https://ctx2' },
    ]);
    mockListSpawnedRobotsInOpenShift.mockResolvedValue(['robot_1']);

    render(Diagnostics, { props: { query: { target: 'oc' } } });
    await screen.findByLabelText('Robot');
    mockListSpawnedRobotsInOpenShift.mockClear();

    const contextSelect = screen.getByLabelText('Cluster') as HTMLSelectElement;
    await fireEvent.change(contextSelect, { target: { value: 'ctx2' } });

    expect(screen.queryByLabelText('Robot')).toBeNull();
    expect(mockListSpawnedRobotsInOpenShift).not.toHaveBeenCalled();
  });

  it('lets the user manually list simulations for a chosen namespace/cluster, updating the store', async () => {
    mockListKubeContexts.mockResolvedValue([{ name: 'ctx-a', clusterUrl: 'https://ctx-a' }]);
    mockListOpenShiftProjects.mockResolvedValue(['proj-a']);
    mockListOpenShiftDeployments.mockResolvedValue([workload({ name: 'wl1', namespace: 'proj-a' })]);
    mockListSpawnedRobotsInOpenShift.mockResolvedValue(['robot_1']);

    render(Diagnostics, { props: { query: {} } });
    await fireEvent.click(screen.getByRole('tab', { name: 'OpenShift' }));
    await waitFor(() => expect(mockListKubeContexts).toHaveBeenCalled());

    const contextSelect = screen.getByLabelText('Cluster') as HTMLSelectElement;
    await fireEvent.change(contextSelect, { target: { value: 'ctx-a' } });

    const namespaceInput = screen.getByLabelText('Project / namespace') as HTMLInputElement;
    await fireEvent.input(namespaceInput, { target: { value: 'proj-a' } });

    await fireEvent.click(screen.getByRole('button', { name: /list simulations/i }));

    await waitFor(() => expect(mockListOpenShiftDeployments).toHaveBeenCalledWith('proj-a', 'ctx-a'));
    expect(await screen.findByLabelText('Robot')).toBeTruthy();
    expect(mockListSpawnedRobotsInOpenShift).toHaveBeenCalledWith('proj-a', 'wl1', 'ctx-a');

    let stored: { context: string; namespace: string } | undefined = undefined;
    lastOpenShiftSelection.subscribe(v => (stored = v))();
    expect(stored).toEqual({ context: 'ctx-a', namespace: 'proj-a' });
  });

  it('shows a clear inline message when a namespace has no deployments', async () => {
    lastOpenShiftSelection.set({ context: 'ctx-a', namespace: 'empty-ns' });
    mockListOpenShiftDeployments.mockResolvedValue([]);

    render(Diagnostics, { props: { query: { target: 'oc' } } });

    expect(await screen.findByText(/No simulations found in "empty-ns"/)).toBeTruthy();
  });

  it('uses an oc deep link directly without auto-resolution, even when discovery finds nothing', async () => {
    render(Diagnostics, {
      props: {
        query: { target: 'oc', namespace: 'ns1', workload: 'ros2-jazzy-sim', robot: 'robot_1', context: 'ctx1' },
      },
    });

    await waitFor(() => expect(mockListSpawnedRobotsInOpenShift).toHaveBeenCalledWith('ns1', 'ros2-jazzy-sim', 'ctx1'));
    expect(mockGetOpenShiftContext).not.toHaveBeenCalled();
    expect(mockGetDefaultOpenShiftNamespace).not.toHaveBeenCalled();

    const robotSelect = (await screen.findByLabelText('Robot')) as HTMLSelectElement;
    expect(robotSelect.value).toBe('robot_1');
    expect((screen.getByLabelText('Project / namespace') as HTMLInputElement).value).toBe('ns1');
  });

  it('does not bleed state between tabs and restores each tab on switch-back', async () => {
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-123', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [] },
    ]);
    lastOpenShiftSelection.set({ context: 'ctx1', namespace: 'ns1' });
    mockListOpenShiftDeployments.mockResolvedValue([workload({ name: 'sim1' })]);

    render(Diagnostics, { props: { query: {} } });
    await screen.findByLabelText('Simulation');
    expect((screen.getByLabelText('Simulation') as HTMLSelectElement).value).toBe('c1');

    await fireEvent.click(screen.getByRole('tab', { name: 'OpenShift' }));
    await waitFor(() => expect(mockListOpenShiftDeployments).toHaveBeenCalledWith('ns1', 'ctx1'));
    expect(screen.queryByLabelText('Project / namespace')).toBeTruthy();
    // The Local tab's own picker/panel isn't rendered while on the OpenShift tab.
    expect(screen.queryByText('pai-sim-123 — ros2-jazzy-sim:noble')).toBeNull();

    await fireEvent.click(screen.getByRole('tab', { name: 'Local' }));
    expect(screen.queryByLabelText('Project / namespace')).toBeNull();
    const localSelect = (await screen.findByLabelText('Simulation')) as HTMLSelectElement;
    expect(localSelect.value).toBe('c1');
    // Discovery was not re-run for the OpenShift tab a second time on switch-back.
    expect(mockListOpenShiftDeployments).toHaveBeenCalledTimes(1);
  });
});
