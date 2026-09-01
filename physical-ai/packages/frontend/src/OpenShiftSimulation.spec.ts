import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import DeployOpenShift from './OpenShiftSimulation.svelte';
import { lastOpenShiftSelection } from './lib/simSelection';
import { spawnedRobotsByTarget } from './lib/spawnedRobotsStore';
import { ocTargetKey } from './lib/diagnosticsTargetKey';

const mockClearCachedDiagnostics = vi.fn();

vi.mock('./lib/robotDiagnosticsCache', () => ({
  clearCachedDiagnostics: (...args: unknown[]) => mockClearCachedDiagnostics(...args),
}));

const mockGetOpenShiftContext = vi.fn();
const mockListKubeContexts = vi.fn();
const mockGetDefaultNamespace = vi.fn();
const mockGetDefaultOpenShiftNamespace = vi.fn();
const mockCheckOpenShiftLogin = vi.fn();
const mockListOpenShiftProjects = vi.fn();
const mockGetSimulationConfig = vi.fn();
const mockGetDefaultSoftwareRenderCpus = vi.fn();
const mockListOpenShiftDeployments = vi.fn();
const mockDeployToOpenShift = vi.fn();
const mockDeleteOpenShiftDeployment = vi.fn();
const mockSpawnRobotInOpenShift = vi.fn();
const mockSendOpenShiftNavigationGoal = vi.fn();
const mockGetRobotWarmStatusInOpenShift = vi.fn();
const mockListSpawnedRobotsInOpenShift = vi.fn();
const mockDespawnRobotInOpenShift = vi.fn();
const mockOpenUrlInBrowser = vi.fn();
const mockGoto = vi.fn();

vi.mock('./api/client', () => ({
  physicalAiClient: {
    getOpenShiftContext: (...args: unknown[]) => mockGetOpenShiftContext(...args),
    listKubeContexts: (...args: unknown[]) => mockListKubeContexts(...args),
    getDefaultNamespace: (...args: unknown[]) => mockGetDefaultNamespace(...args),
    getDefaultOpenShiftNamespace: (...args: unknown[]) => mockGetDefaultOpenShiftNamespace(...args),
    checkOpenShiftLogin: (...args: unknown[]) => mockCheckOpenShiftLogin(...args),
    listOpenShiftProjects: (...args: unknown[]) => mockListOpenShiftProjects(...args),
    getSimulationConfig: (...args: unknown[]) => mockGetSimulationConfig(...args),
    getDefaultSoftwareRenderCpus: (...args: unknown[]) => mockGetDefaultSoftwareRenderCpus(...args),
    generateOpenShiftManifests: vi.fn(),
    listOpenShiftDeployments: (...args: unknown[]) => mockListOpenShiftDeployments(...args),
    deployToOpenShift: (...args: unknown[]) => mockDeployToOpenShift(...args),
    deleteOpenShiftDeployment: (...args: unknown[]) => mockDeleteOpenShiftDeployment(...args),
    spawnRobotInOpenShift: (...args: unknown[]) => mockSpawnRobotInOpenShift(...args),
    sendOpenShiftNavigationGoal: (...args: unknown[]) => mockSendOpenShiftNavigationGoal(...args),
    getRobotWarmStatusInOpenShift: (...args: unknown[]) => mockGetRobotWarmStatusInOpenShift(...args),
    listSpawnedRobotsInOpenShift: (...args: unknown[]) => mockListSpawnedRobotsInOpenShift(...args),
    despawnRobotInOpenShift: (...args: unknown[]) => mockDespawnRobotInOpenShift(...args),
    openUrlInBrowser: (...args: unknown[]) => mockOpenUrlInBrowser(...args),
  },
}));

vi.mock('tinro', () => ({
  router: { goto: (...args: unknown[]) => mockGoto(...args) },
}));

const READY_WORKLOAD = {
  name: 'ros2-jazzy-sim',
  namespace: 'sgahlot-pd-extn',
  replicas: 1,
  readyReplicas: 1,
  ready: true,
  image: 'quay.io/ns/ros2-jazzy-sim:noble-amd64',
  routeUrl: 'https://host.apps.example.com',
};

describe('OpenShiftSimulation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    lastOpenShiftSelection.set(undefined);
    spawnedRobotsByTarget.set({});
    // The real OpenShiftContext carries the context's namespace (via the
    // kubeconfigContextNamespace helper); the component seeds its namespace from it,
    // and refreshWorkloads() no-ops without one — so the mock must provide it.
    mockGetOpenShiftContext.mockResolvedValue({
      context: 'ctx',
      kubeconfigPath: '/k/config',
      namespace: 'sgahlot-pd-extn',
    });
    mockListKubeContexts.mockResolvedValue([{ name: 'ctx', namespace: 'sgahlot-pd-extn' }]);
    mockGetDefaultNamespace.mockResolvedValue('sgahlot-pd-extn');
    mockGetDefaultOpenShiftNamespace.mockResolvedValue('');
    mockCheckOpenShiftLogin.mockResolvedValue({ loggedIn: true });
    mockListOpenShiftProjects.mockResolvedValue([]);
    mockGetDefaultSoftwareRenderCpus.mockResolvedValue(8);
    // Keep the default image (avoids exercising simulationImageTag here).
    mockGetSimulationConfig.mockRejectedValue(new Error('no config'));
    mockListOpenShiftDeployments.mockResolvedValue([]);
    mockSpawnRobotInOpenShift.mockResolvedValue(undefined);
    mockDeleteOpenShiftDeployment.mockResolvedValue(undefined);
    mockGetRobotWarmStatusInOpenShift.mockResolvedValue('idle');
    mockListSpawnedRobotsInOpenShift.mockResolvedValue([]);
    mockDespawnRobotInOpenShift.mockResolvedValue(undefined);
    mockOpenUrlInBrowser.mockResolvedValue(undefined);
  });

  it('renders the deployed-simulations section', async () => {
    render(DeployOpenShift);
    expect(await screen.findByText('Deployed simulations')).toBeTruthy();
  });

  it('lists a ready workload with its ready count', async () => {
    mockListOpenShiftDeployments.mockResolvedValue([READY_WORKLOAD]);
    render(DeployOpenShift);
    expect(await screen.findByText('ros2-jazzy-sim')).toBeTruthy();
    expect(screen.getByText('1/1 ready')).toBeTruthy();
  });

  it('opens the Route via the host browser (not a raw link)', async () => {
    mockListOpenShiftDeployments.mockResolvedValue([READY_WORKLOAD]);
    render(DeployOpenShift);

    const openBtn = await screen.findByRole('button', { name: /Open https:\/\/host\.apps\.example\.com/ });
    await fireEvent.click(openBtn);

    await waitFor(() => {
      expect(mockOpenUrlInBrowser).toHaveBeenCalledWith('https://host.apps.example.com');
    });
  });

  it('does not offer the Route link until the pod is ready, even if the route is admitted', async () => {
    // Route admitted (routeUrl present) but pod not ready → opening it early 503s (S8-5).
    mockListOpenShiftDeployments.mockResolvedValue([{ ...READY_WORKLOAD, readyReplicas: 0, ready: false }]);
    render(DeployOpenShift);

    await screen.findByText('ros2-jazzy-sim');
    expect(screen.queryByRole('button', { name: /Open https:\/\/host\.apps\.example\.com/ })).toBeNull();
    expect(screen.getByText(/waiting for the pod to be ready/i)).toBeTruthy();
  });

  it('deploys with software rendering by default (useGpu false)', async () => {
    mockDeployToOpenShift.mockResolvedValue({
      name: 'ros2-jazzy-sim',
      namespace: 'sgahlot-pd-extn',
      applied: ['Deployment', 'Service', 'Route'],
      message: 'Deployed',
    });
    render(DeployOpenShift);

    await fireEvent.click(await screen.findByRole('button', { name: 'Deploy' }));

    await waitFor(() => {
      expect(mockDeployToOpenShift).toHaveBeenCalledWith(expect.objectContaining({ useGpu: false }));
    });
  });

  it('passes useGpu and the default GPU toleration when the GPU checkbox is ticked', async () => {
    mockDeployToOpenShift.mockResolvedValue({
      name: 'ros2-jazzy-sim',
      namespace: 'sgahlot-pd-extn',
      applied: ['Deployment', 'Service', 'Route'],
      message: 'Deployed',
    });
    render(DeployOpenShift);

    await fireEvent.click(await screen.findByRole('checkbox', { name: /Cluster has a GPU/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Deploy' }));

    await waitFor(() => {
      expect(mockDeployToOpenShift).toHaveBeenCalledWith(
        expect.objectContaining({ useGpu: true, gpuToleration: 'g5-gpu=true:NoSchedule' }),
      );
    });
  });

  it('omits the GPU toleration on the software-render path', async () => {
    mockDeployToOpenShift.mockResolvedValue({
      name: 'ros2-jazzy-sim',
      namespace: 'sgahlot-pd-extn',
      applied: ['Deployment', 'Service', 'Route'],
      message: 'Deployed',
    });
    render(DeployOpenShift);

    await fireEvent.click(await screen.findByRole('button', { name: 'Deploy' }));

    await waitFor(() => {
      expect(mockDeployToOpenShift).toHaveBeenCalledWith(
        expect.objectContaining({ useGpu: false, gpuToleration: undefined }),
      );
    });
  });

  it('deploys with middleware dds by default when getSimulationConfig fails', async () => {
    mockDeployToOpenShift.mockResolvedValue({
      name: 'ros2-jazzy-sim',
      namespace: 'sgahlot-pd-extn',
      applied: ['Deployment', 'Service', 'Route'],
      message: 'Deployed',
    });
    render(DeployOpenShift);

    await fireEvent.click(await screen.findByRole('button', { name: 'Deploy' }));

    await waitFor(() => {
      expect(mockDeployToOpenShift).toHaveBeenCalledWith(expect.objectContaining({ middleware: 'dds' }));
    });
  });

  it('seeds middleware from the sim config (zenoh) and passes it through to deployToOpenShift', async () => {
    mockGetSimulationConfig.mockResolvedValue({
      robot: 'turtlebot3',
      distro: 'jazzy',
      middleware: 'zenoh',
      engine: 'gazebo',
      baseImage: 'jazzy-noble',
    });
    mockDeployToOpenShift.mockResolvedValue({
      name: 'ros2-jazzy-sim',
      namespace: 'sgahlot-pd-extn',
      applied: ['Deployment', 'Service', 'Route'],
      message: 'Deployed',
    });
    render(DeployOpenShift);

    await fireEvent.click(await screen.findByRole('button', { name: 'Deploy' }));

    await waitFor(() => {
      expect(mockDeployToOpenShift).toHaveBeenCalledWith(expect.objectContaining({ middleware: 'zenoh' }));
    });
  });

  it('spawns a robot into a ready workload and then navigates it', async () => {
    vi.useFakeTimers();
    try {
      mockListOpenShiftDeployments.mockResolvedValue([READY_WORKLOAD]);
      mockSendOpenShiftNavigationGoal.mockResolvedValue({ status: 'reached', message: 'ok' });
      // Pre-warm reports ready so the nav controls are revealed after a poll tick.
      mockGetRobotWarmStatusInOpenShift.mockResolvedValue('ready');

      render(DeployOpenShift);
      await vi.advanceTimersByTimeAsync(100); // onMount + initial list

      await fireEvent.click(screen.getByRole('button', { name: 'Spawn' }));
      await vi.advanceTimersByTimeAsync(0); // let the spawn promise settle

      expect(mockSpawnRobotInOpenShift).toHaveBeenCalledWith(
        'sgahlot-pd-extn',
        'ros2-jazzy-sim',
        'robot_1',
        '-2.0',
        '-0.5',
        '0.0',
        'ctx',
      );

      // Jazzy spawn is optimistically 'warming' → Navigate hidden until warm.
      expect(screen.queryByRole('button', { name: 'Navigate' })).toBeNull();

      // Warm-status poll flips it to 'ready' → controls appear.
      await vi.advanceTimersByTimeAsync(3000);
      await fireEvent.click(screen.getByRole('button', { name: 'Navigate' }));
      await vi.advanceTimersByTimeAsync(0);

      expect(mockSendOpenShiftNavigationGoal).toHaveBeenCalledWith(
        'sgahlot-pd-extn',
        'ros2-jazzy-sim',
        'robot_1',
        2.0,
        0.5,
        'ctx',
      );
      expect(screen.getByText(/Reached/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces spawn errors', async () => {
    mockListOpenShiftDeployments.mockResolvedValue([READY_WORKLOAD]);
    mockSpawnRobotInOpenShift.mockRejectedValue(new Error('no running pod'));

    render(DeployOpenShift);
    await fireEvent.click(await screen.findByRole('button', { name: 'Spawn' }));

    expect(await screen.findByText('no running pod')).toBeTruthy();
  });

  it('does not offer spawn for a not-ready workload', async () => {
    mockListOpenShiftDeployments.mockResolvedValue([
      { ...READY_WORKLOAD, readyReplicas: 0, ready: false, routeUrl: undefined },
    ]);

    render(DeployOpenShift);
    await screen.findByText('ros2-jazzy-sim');
    expect(screen.queryByRole('button', { name: 'Spawn' })).toBeNull();
  });

  it('auto-refreshes so a newly-ready deployment reveals its spawn controls without a manual refresh', async () => {
    vi.useFakeTimers();
    try {
      const notReady = { ...READY_WORKLOAD, readyReplicas: 0, ready: false, routeUrl: undefined };
      // First list (onMount) is not-ready; the 3 s auto-refresh sees it become ready.
      mockListOpenShiftDeployments.mockResolvedValueOnce([notReady]).mockResolvedValue([READY_WORKLOAD]);

      render(DeployOpenShift);
      // Let onMount settle: not-ready, so no Spawn yet.
      await vi.advanceTimersByTimeAsync(100);
      expect(screen.queryByRole('button', { name: 'Spawn' })).toBeNull();

      // Fire the auto-refresh tick — no manual Refresh click.
      await vi.advanceTimersByTimeAsync(3000);
      expect(screen.getByRole('button', { name: 'Spawn' })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('deletes a workload', async () => {
    mockListOpenShiftDeployments.mockResolvedValue([READY_WORKLOAD]);

    render(DeployOpenShift);
    await screen.findByText('ros2-jazzy-sim');
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockDeleteOpenShiftDeployment).toHaveBeenCalledWith('sgahlot-pd-extn', 'ros2-jazzy-sim', 'ctx');
    });
  });

  it('populates the Cluster picker from kubeconfig contexts, defaulting to the current one (S8-10)', async () => {
    mockGetOpenShiftContext.mockResolvedValue({
      context: 'ctx',
      kubeconfigPath: '/k/config',
      namespace: 'sgahlot-pd-extn',
      clusterUrl: 'https://api.cluster.example.com:6443',
    });
    mockListKubeContexts.mockResolvedValue([
      { name: 'ctx', clusterUrl: 'https://api.cluster.example.com:6443', namespace: 'sgahlot-pd-extn' },
      { name: 'other-ctx', clusterUrl: 'https://api.other-cluster.example.com:6443', namespace: 'other-ns' },
    ]);

    render(DeployOpenShift);
    const select = (await screen.findByLabelText('Cluster URL')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('ctx'));
    expect(screen.getByText('https://api.cluster.example.com:6443')).toBeTruthy();
    expect(screen.getByText('https://api.other-cluster.example.com:6443')).toBeTruthy();
  });

  it('keeps lastOpenShiftSelection in sync with the resolved context/namespace (APPENG-5810)', async () => {
    render(DeployOpenShift);
    await waitFor(() => {
      let stored: { context: string; namespace: string } | undefined = undefined;
      lastOpenShiftSelection.subscribe(v => (stored = v))();
      expect(stored).toEqual({ context: 'ctx', namespace: 'sgahlot-pd-extn' });
    });
  });

  it('updates lastOpenShiftSelection when the Cluster/namespace changes (APPENG-5810)', async () => {
    mockListKubeContexts.mockResolvedValue([
      { name: 'ctx', namespace: 'sgahlot-pd-extn' },
      { name: 'other-ctx', namespace: 'other-ns' },
    ]);

    render(DeployOpenShift);
    const select = (await screen.findByLabelText('Cluster URL')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('ctx'));

    await fireEvent.change(select, { target: { value: 'other-ctx' } });

    await waitFor(() => {
      let stored: { context: string; namespace: string } | undefined = undefined;
      lastOpenShiftSelection.subscribe(v => (stored = v))();
      expect(stored).toEqual({ context: 'other-ctx', namespace: 'other-ns' });
    });
  });

  it('switching the Cluster picker re-checks login and re-targets the workload list (S8-10)', async () => {
    mockGetOpenShiftContext.mockResolvedValue({
      context: 'ctx',
      kubeconfigPath: '/k/config',
      namespace: 'sgahlot-pd-extn',
    });
    mockListKubeContexts.mockResolvedValue([
      { name: 'ctx', namespace: 'sgahlot-pd-extn' },
      { name: 'other-ctx', namespace: 'other-ns' },
    ]);

    render(DeployOpenShift);
    const select = (await screen.findByLabelText('Cluster URL')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('ctx'));
    mockCheckOpenShiftLogin.mockClear();
    mockListOpenShiftDeployments.mockClear();

    await fireEvent.change(select, { target: { value: 'other-ctx' } });

    await waitFor(() => {
      expect(mockCheckOpenShiftLogin).toHaveBeenCalledWith('other-ctx');
      expect(mockListOpenShiftDeployments).toHaveBeenCalledWith('other-ns', 'other-ctx');
    });
  });

  it('renders project options in the custom dropdown after focusing the namespace field (S8-21)', async () => {
    // No context namespace/default configured, so `namespace` starts empty (S8-16) and
    // focusing shows the full suggestion list rather than filtering against stale text.
    mockGetOpenShiftContext.mockResolvedValue({ context: 'ctx', kubeconfigPath: '/k/config' });
    mockListOpenShiftProjects.mockResolvedValue(['my-project', 'other-ns']);

    render(DeployOpenShift);
    const input = (await screen.findByLabelText('Project / namespace')) as HTMLInputElement;
    await waitFor(() => expect(mockListOpenShiftProjects).toHaveBeenCalledWith('ctx'));

    await fireEvent.focus(input);

    const listbox = await screen.findByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    expect(options.map(o => o.textContent?.trim())).toEqual(['my-project', 'other-ns']);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-controls')).toBe(listbox.id);
  });

  it('filters the dropdown options as the namespace text is typed (S8-21)', async () => {
    mockListOpenShiftProjects.mockResolvedValue(['my-project', 'other-ns', 'my-other-project']);

    render(DeployOpenShift);
    const input = (await screen.findByLabelText('Project / namespace')) as HTMLInputElement;
    await waitFor(() => expect(mockListOpenShiftProjects).toHaveBeenCalledWith('ctx'));

    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: 'other' } });

    const listbox = await screen.findByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    expect(options.map(o => o.textContent?.trim())).toEqual(['other-ns', 'my-other-project']);
  });

  it('selecting a dropdown option sets the namespace and closes the menu, retargeting the workload list (S8-21)', async () => {
    mockGetOpenShiftContext.mockResolvedValue({ context: 'ctx', kubeconfigPath: '/k/config' });
    mockListOpenShiftProjects.mockResolvedValue(['my-project', 'other-ns']);

    render(DeployOpenShift);
    const input = (await screen.findByLabelText('Project / namespace')) as HTMLInputElement;
    await waitFor(() => expect(mockListOpenShiftProjects).toHaveBeenCalledWith('ctx'));
    mockListOpenShiftDeployments.mockClear();

    await fireEvent.focus(input);
    const listbox = await screen.findByRole('listbox');
    await fireEvent.click(within(listbox).getByText('other-ns'));

    expect(input.value).toBe('other-ns');
    expect(screen.queryByRole('listbox')).toBeNull();
    await waitFor(() => {
      expect(mockListOpenShiftDeployments).toHaveBeenCalledWith('other-ns', 'ctx');
    });
  });

  it('closes the dropdown on Escape without altering the typed value (S8-21)', async () => {
    mockGetOpenShiftContext.mockResolvedValue({ context: 'ctx', kubeconfigPath: '/k/config' });
    mockListOpenShiftProjects.mockResolvedValue(['my-project', 'other-ns']);

    render(DeployOpenShift);
    const input = (await screen.findByLabelText('Project / namespace')) as HTMLInputElement;
    await waitFor(() => expect(mockListOpenShiftProjects).toHaveBeenCalledWith('ctx'));

    await fireEvent.focus(input);
    await screen.findByRole('listbox');
    await fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('re-loads the project list when the targeted cluster/context changes (S8-21)', async () => {
    mockListKubeContexts.mockResolvedValue([
      { name: 'ctx', namespace: 'sgahlot-pd-extn' },
      { name: 'other-ctx', namespace: 'other-ns' },
    ]);
    mockListOpenShiftProjects.mockResolvedValueOnce(['my-project']).mockResolvedValueOnce(['other-project']);

    render(DeployOpenShift);
    const select = (await screen.findByLabelText('Cluster URL')) as HTMLSelectElement;
    await waitFor(() => expect(mockListOpenShiftProjects).toHaveBeenCalledWith('ctx'));
    mockListOpenShiftProjects.mockClear();

    await fireEvent.change(select, { target: { value: 'other-ctx' } });

    await waitFor(() => {
      expect(mockListOpenShiftProjects).toHaveBeenCalledWith('other-ctx');
    });
  });

  it('falls back to free-text entry when project listing fails/returns empty (S8-21)', async () => {
    mockListOpenShiftProjects.mockResolvedValue([]);

    render(DeployOpenShift);
    const input = (await screen.findByLabelText('Project / namespace')) as HTMLInputElement;
    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: 'a-brand-new-namespace' } });

    expect(input.value).toBe('a-brand-new-namespace');
    // No matches for free text against an empty suggestion list — the menu stays hidden
    // rather than showing an empty popup.
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('hides OpenShift/Kubernetes system projects from the dropdown by default (S8-21)', async () => {
    mockGetOpenShiftContext.mockResolvedValue({ context: 'ctx', kubeconfigPath: '/k/config' });
    mockListOpenShiftProjects.mockResolvedValue([
      'default',
      'openshift-apiserver',
      'kube-system',
      'sgahlot-pd-extn',
      'my-app',
    ]);

    render(DeployOpenShift);
    const input = (await screen.findByLabelText('Project / namespace')) as HTMLInputElement;
    await waitFor(() => expect(mockListOpenShiftProjects).toHaveBeenCalledWith('ctx'));

    await fireEvent.focus(input);

    const listbox = await screen.findByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    expect(options.map(o => o.textContent?.trim())).toEqual(['sgahlot-pd-extn', 'my-app']);
    expect(within(listbox).queryByText('default')).toBeNull();
    expect(within(listbox).queryByText('openshift-apiserver')).toBeNull();
    expect(within(listbox).queryByText('kube-system')).toBeNull();
  });

  it('reveals system projects in the dropdown when "Show system projects" is checked (S8-21)', async () => {
    mockGetOpenShiftContext.mockResolvedValue({ context: 'ctx', kubeconfigPath: '/k/config' });
    mockListOpenShiftProjects.mockResolvedValue([
      'default',
      'openshift-apiserver',
      'kube-system',
      'sgahlot-pd-extn',
      'my-app',
    ]);

    render(DeployOpenShift);
    const input = (await screen.findByLabelText('Project / namespace')) as HTMLInputElement;
    await waitFor(() => expect(mockListOpenShiftProjects).toHaveBeenCalledWith('ctx'));

    await fireEvent.click(await screen.findByRole('checkbox', { name: /Show system projects/ }));
    await fireEvent.focus(input);

    const listbox = await screen.findByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    expect(options.map(o => o.textContent?.trim())).toEqual([
      'default',
      'openshift-apiserver',
      'kube-system',
      'sgahlot-pd-extn',
      'my-app',
    ]);
  });

  it('does not render the "Show system projects" toggle when no system projects are present (S8-21)', async () => {
    mockGetOpenShiftContext.mockResolvedValue({ context: 'ctx', kubeconfigPath: '/k/config' });
    mockListOpenShiftProjects.mockResolvedValue(['sgahlot-pd-extn', 'my-app']);

    render(DeployOpenShift);
    await screen.findByLabelText('Project / namespace');
    await waitFor(() => expect(mockListOpenShiftProjects).toHaveBeenCalledWith('ctx'));

    expect(screen.queryByRole('checkbox', { name: /Show system projects/ })).toBeNull();
  });

  it('falls back to the configured default namespace when the context sets none (S8-16)', async () => {
    mockGetOpenShiftContext.mockResolvedValue({ context: 'ctx', kubeconfigPath: '/k/config' });
    mockGetDefaultOpenShiftNamespace.mockResolvedValue('my-team-dev');

    render(DeployOpenShift);
    const input = (await screen.findByLabelText('Project / namespace')) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('my-team-dev'));
  });

  it("never overrides the context's own namespace with the configured default (S8-16)", async () => {
    mockGetOpenShiftContext.mockResolvedValue({
      context: 'ctx',
      kubeconfigPath: '/k/config',
      namespace: 'sgahlot-pd-extn',
    });
    mockGetDefaultOpenShiftNamespace.mockResolvedValue('should-not-be-used');

    render(DeployOpenShift);
    const input = (await screen.findByLabelText('Project / namespace')) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('sgahlot-pd-extn'));
  });

  it("falls back to the configured default when the context's namespace is the generic 'default' project (S8-16)", async () => {
    // `oc login` commonly sets namespace: default explicitly rather than leaving it
    // unset — this must be treated the same as "no namespace bound", not as a real signal.
    mockGetOpenShiftContext.mockResolvedValue({
      context: 'ctx',
      kubeconfigPath: '/k/config',
      namespace: 'default',
    });
    mockGetDefaultOpenShiftNamespace.mockResolvedValue('sgahlot-pd-extn');

    render(DeployOpenShift);
    const input = (await screen.findByLabelText('Project / namespace')) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('sgahlot-pd-extn'));
  });

  it("keeps the context's 'default' namespace when no override is configured (S8-16)", async () => {
    mockGetOpenShiftContext.mockResolvedValue({
      context: 'ctx',
      kubeconfigPath: '/k/config',
      namespace: 'default',
    });
    mockGetDefaultOpenShiftNamespace.mockResolvedValue('');

    render(DeployOpenShift);
    const input = (await screen.findByLabelText('Project / namespace')) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('default'));
  });

  it('disables Deploy and shows a banner when not logged in to OpenShift (S8-11)', async () => {
    mockCheckOpenShiftLogin.mockResolvedValue({
      loggedIn: false,
      message: 'Not logged in to OpenShift — run `oc login` first.',
    });

    render(DeployOpenShift);
    expect(await screen.findByText(/Not logged in to OpenShift/)).toBeTruthy();
    const deployBtn = screen.getByRole('button', { name: 'Deploy' }) as HTMLButtonElement;
    expect(deployBtn.disabled).toBe(true);
  });

  it('reflects a robot already running in a ready workload without a manual spawn (S8-17)', async () => {
    mockListOpenShiftDeployments.mockResolvedValue([READY_WORKLOAD]);
    mockListSpawnedRobotsInOpenShift.mockResolvedValue(['robot_1']);

    render(DeployOpenShift);
    await screen.findByText('ros2-jazzy-sim');

    await waitFor(() => {
      expect(mockListSpawnedRobotsInOpenShift).toHaveBeenCalledWith('sgahlot-pd-extn', 'ros2-jazzy-sim', 'ctx');
    });
    expect(await screen.findByText('robot_1')).toBeTruthy();
  });

  it('does not duplicate or reset a reconciled robot on a second refresh (S8-17)', async () => {
    mockListOpenShiftDeployments.mockResolvedValue([READY_WORKLOAD]);
    mockListSpawnedRobotsInOpenShift.mockResolvedValue(['robot_1']);

    render(DeployOpenShift);
    await screen.findByText('robot_1');
    expect(mockListSpawnedRobotsInOpenShift).toHaveBeenCalledTimes(1);

    await fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(mockListOpenShiftDeployments).toHaveBeenCalledTimes(2));

    // Reconciliation runs at most once per workload — a second refresh must not
    // re-probe or duplicate the entry.
    expect(mockListSpawnedRobotsInOpenShift).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('robot_1')).toHaveLength(1);
  });

  it('skips the liveness check entirely for a robot still in the warming phase', async () => {
    vi.useFakeTimers();
    try {
      mockListOpenShiftDeployments.mockResolvedValue([READY_WORKLOAD]); // jazzy image
      mockListSpawnedRobotsInOpenShift.mockResolvedValue([]); // would look "gone" if ever checked
      mockGetRobotWarmStatusInOpenShift.mockResolvedValue('warming'); // stays warming every poll

      render(DeployOpenShift);
      await vi.advanceTimersByTimeAsync(100); // onMount + reconcile finds nothing yet

      await fireEvent.click(screen.getByRole('button', { name: 'Spawn' }));
      await vi.advanceTimersByTimeAsync(0); // spawn settles; optimistically warmStatus 'warming'

      const callsAfterSpawn = mockListSpawnedRobotsInOpenShift.mock.calls.length;

      // A robot still 'warming' has its own state machine (pollWarmStatus + the backend's
      // bounded pre-warm timeout) resolving it — pruneStaleRobots must not touch it, and
      // shouldn't even bother calling the liveness check when every tracked robot for a
      // workload is still warming.
      await vi.advanceTimersByTimeAsync(9000); // 3 more poll ticks
      expect(screen.getByText('robot_1')).toBeTruthy();
      expect(mockListSpawnedRobotsInOpenShift.mock.calls.length).toBe(callsAfterSpawn);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not prune a freshly-spawned robot still within its startup grace period, even if briefly absent', async () => {
    vi.useFakeTimers();
    try {
      // Humble, not Jazzy — this exercises the wall-clock grace fallback specifically
      // (no `warming` phase at all is ever assigned on this path; that case has its own
      // dedicated test above). Its ROS nodes still take a moment to register after a
      // Gazebo spawn regardless of distro, matching the raw appear-in-world latency the
      // backend's own pre-warm pose-poll accounts for (#prewarmNav2, up to 30 x 1s).
      const humbleWorkload = { ...READY_WORKLOAD, image: 'quay.io/ns/ros2-humble-sim:sloretz-amd64' };
      mockListOpenShiftDeployments.mockResolvedValue([humbleWorkload]);
      mockListSpawnedRobotsInOpenShift.mockResolvedValue([]); // absent from ros2 node list the whole time

      render(DeployOpenShift);
      await vi.advanceTimersByTimeAsync(100); // onMount + reconcile finds nothing yet

      await fireEvent.click(screen.getByRole('button', { name: 'Spawn' }));
      await vi.advanceTimersByTimeAsync(0); // spawn promise settles; trackedSince recorded
      expect(screen.getByText('robot_1')).toBeTruthy();

      // Well past what the 2-miss debounce alone would need (6s), but still under the 30s
      // grace period — must survive.
      await vi.advanceTimersByTimeAsync(25_000);
      expect(screen.getByText('robot_1')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('prunes a robot confirmed missing across 2 consecutive polls (APPENG-6149)', async () => {
    vi.useFakeTimers();
    try {
      mockListOpenShiftDeployments.mockResolvedValue([READY_WORKLOAD]);
      mockListSpawnedRobotsInOpenShift.mockResolvedValue(['robot_1']);

      render(DeployOpenShift);
      // A reconciled robot was, by definition, just confirmed alive — it needs no startup
      // grace at all, unlike a freshly-spawned one (see the grace-period test above).
      await vi.advanceTimersByTimeAsync(100); // onMount + reconcile adds robot_1
      expect(screen.getByText('robot_1')).toBeTruthy();

      mockListSpawnedRobotsInOpenShift.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await vi.advanceTimersByTimeAsync(3000); // miss #1 — below threshold, kept
      expect(screen.getByText('robot_1')).toBeTruthy();

      await vi.advanceTimersByTimeAsync(3000); // miss #2 -> pruned
      expect(screen.queryByText('robot_1')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not prune a robot after only a single missed poll (debounce)', async () => {
    vi.useFakeTimers();
    try {
      mockListOpenShiftDeployments.mockResolvedValue([READY_WORKLOAD]);
      mockListSpawnedRobotsInOpenShift.mockResolvedValue(['robot_1']);

      render(DeployOpenShift);
      await vi.advanceTimersByTimeAsync(100); // onMount + reconcile adds robot_1

      mockListSpawnedRobotsInOpenShift.mockResolvedValueOnce([]); // single miss only
      await vi.advanceTimersByTimeAsync(3000);

      // A single miss is below PRUNE_MISS_THRESHOLD (2) — a transient oc/exec hiccup
      // can't be told apart from a genuinely empty world in one shot, so it must not
      // wipe an actively-driven robot's state.
      expect(screen.getByText('robot_1')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets the miss streak when a robot reappears before hitting the prune threshold', async () => {
    vi.useFakeTimers();
    try {
      mockListOpenShiftDeployments.mockResolvedValue([READY_WORKLOAD]);
      mockListSpawnedRobotsInOpenShift.mockResolvedValue(['robot_1']);

      render(DeployOpenShift);
      await vi.advanceTimersByTimeAsync(100); // onMount + reconcile adds robot_1

      mockListSpawnedRobotsInOpenShift.mockResolvedValueOnce([]); // miss #1
      await vi.advanceTimersByTimeAsync(3000);
      expect(screen.getByText('robot_1')).toBeTruthy();

      // Falls back to the persistent ['robot_1'] default — reappears, streak resets.
      await vi.advanceTimersByTimeAsync(3000);
      expect(screen.getByText('robot_1')).toBeTruthy();

      mockListSpawnedRobotsInOpenShift.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await vi.advanceTimersByTimeAsync(3000); // miss #1 (post-reset)
      expect(screen.getByText('robot_1')).toBeTruthy();

      await vi.advanceTimersByTimeAsync(3000); // miss #2 -> pruned
      expect(screen.queryByText('robot_1')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps spawnedRobotsByTarget in sync with the workload (APPENG-5810)', async () => {
    mockListOpenShiftDeployments.mockResolvedValue([READY_WORKLOAD]);

    render(DeployOpenShift);
    await fireEvent.click(await screen.findByRole('button', { name: 'Spawn' }));

    await waitFor(() => {
      let stored: Record<string, string[]> = {};
      spawnedRobotsByTarget.subscribe(v => (stored = v))();
      expect(stored[ocTargetKey('sgahlot-pd-extn', 'ros2-jazzy-sim', 'ctx')]).toEqual(['robot_1']);
    });
  });

  it('clears the cached diagnostics entry for a robot on spawn (APPENG-5810 stale-cache fix)', async () => {
    mockListOpenShiftDeployments.mockResolvedValue([READY_WORKLOAD]);

    render(DeployOpenShift);
    await fireEvent.click(await screen.findByRole('button', { name: 'Spawn' }));

    await waitFor(() => {
      expect(mockClearCachedDiagnostics).toHaveBeenCalledWith(
        ocTargetKey('sgahlot-pd-extn', 'ros2-jazzy-sim', 'ctx'),
        'robot_1',
      );
    });
  });

  it('clears the cached diagnostics entry for a robot on remove (APPENG-5810 stale-cache fix)', async () => {
    mockListOpenShiftDeployments.mockResolvedValue([READY_WORKLOAD]);
    mockListSpawnedRobotsInOpenShift.mockResolvedValue(['robot_1']);

    render(DeployOpenShift);
    await screen.findByText('robot_1');
    mockClearCachedDiagnostics.mockClear();

    await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect(mockClearCachedDiagnostics).toHaveBeenCalledWith(
        ocTargetKey('sgahlot-pd-extn', 'ros2-jazzy-sim', 'ctx'),
        'robot_1',
      );
    });
  });
});
