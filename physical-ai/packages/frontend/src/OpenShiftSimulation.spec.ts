import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import DeployOpenShift from './OpenShiftSimulation.svelte';

const mockGetOpenShiftContext = vi.fn();
const mockGetDefaultNamespace = vi.fn();
const mockGetDefaultOpenShiftNamespace = vi.fn();
const mockCheckOpenShiftLogin = vi.fn();
const mockGetSimulationConfig = vi.fn();
const mockGetDefaultSoftwareRenderCpus = vi.fn();
const mockListOpenShiftDeployments = vi.fn();
const mockDeployToOpenShift = vi.fn();
const mockDeleteOpenShiftDeployment = vi.fn();
const mockSpawnRobotInOpenShift = vi.fn();
const mockSendOpenShiftNavigationGoal = vi.fn();
const mockGetRobotWarmStatusInOpenShift = vi.fn();
const mockListSpawnedRobotsInOpenShift = vi.fn();
const mockOpenUrlInBrowser = vi.fn();
const mockGoto = vi.fn();

vi.mock('./api/client', () => ({
  physicalAiClient: {
    getOpenShiftContext: (...args: unknown[]) => mockGetOpenShiftContext(...args),
    getDefaultNamespace: (...args: unknown[]) => mockGetDefaultNamespace(...args),
    getDefaultOpenShiftNamespace: (...args: unknown[]) => mockGetDefaultOpenShiftNamespace(...args),
    checkOpenShiftLogin: (...args: unknown[]) => mockCheckOpenShiftLogin(...args),
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
    // The real OpenShiftContext carries the context's namespace (via the
    // kubeconfigContextNamespace helper); the component seeds its namespace from it,
    // and refreshWorkloads() no-ops without one — so the mock must provide it.
    mockGetOpenShiftContext.mockResolvedValue({
      context: 'ctx',
      kubeconfigPath: '/k/config',
      namespace: 'sgahlot-pd-extn',
    });
    mockGetDefaultNamespace.mockResolvedValue('sgahlot-pd-extn');
    mockGetDefaultOpenShiftNamespace.mockResolvedValue('');
    mockCheckOpenShiftLogin.mockResolvedValue({ loggedIn: true });
    mockGetDefaultSoftwareRenderCpus.mockResolvedValue(8);
    // Keep the default image (avoids exercising simulationImageTag here).
    mockGetSimulationConfig.mockRejectedValue(new Error('no config'));
    mockListOpenShiftDeployments.mockResolvedValue([]);
    mockSpawnRobotInOpenShift.mockResolvedValue(undefined);
    mockDeleteOpenShiftDeployment.mockResolvedValue(undefined);
    mockGetRobotWarmStatusInOpenShift.mockResolvedValue('idle');
    mockListSpawnedRobotsInOpenShift.mockResolvedValue([]);
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
      expect(mockDeleteOpenShiftDeployment).toHaveBeenCalledWith('sgahlot-pd-extn', 'ros2-jazzy-sim');
    });
  });

  it('seeds the Cluster URL field from the context (S8-10)', async () => {
    mockGetOpenShiftContext.mockResolvedValue({
      context: 'ctx',
      kubeconfigPath: '/k/config',
      namespace: 'sgahlot-pd-extn',
      clusterUrl: 'https://api.cluster.example.com:6443',
    });

    render(DeployOpenShift);
    const input = (await screen.findByLabelText('Cluster URL')) as HTMLInputElement;
    expect(input.value).toBe('https://api.cluster.example.com:6443');
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
      expect(mockListSpawnedRobotsInOpenShift).toHaveBeenCalledWith('sgahlot-pd-extn', 'ros2-jazzy-sim');
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
});
