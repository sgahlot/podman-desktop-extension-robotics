import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import DeployOpenShift from './OpenShiftSimulation.svelte';

const mockGetOpenShiftContext = vi.fn();
const mockGetDefaultNamespace = vi.fn();
const mockGetSimulationConfig = vi.fn();
const mockGetDefaultSoftwareRenderCpus = vi.fn();
const mockListOpenShiftDeployments = vi.fn();
const mockDeployToOpenShift = vi.fn();
const mockDeleteOpenShiftDeployment = vi.fn();
const mockSpawnRobotInOpenShift = vi.fn();
const mockSendOpenShiftNavigationGoal = vi.fn();
const mockGetRobotWarmStatusInOpenShift = vi.fn();
const mockOpenUrlInBrowser = vi.fn();
const mockGoto = vi.fn();

vi.mock('./api/client', () => ({
  physicalAiClient: {
    getOpenShiftContext: (...args: unknown[]) => mockGetOpenShiftContext(...args),
    getDefaultNamespace: (...args: unknown[]) => mockGetDefaultNamespace(...args),
    getSimulationConfig: (...args: unknown[]) => mockGetSimulationConfig(...args),
    getDefaultSoftwareRenderCpus: (...args: unknown[]) => mockGetDefaultSoftwareRenderCpus(...args),
    generateOpenShiftManifests: vi.fn(),
    listOpenShiftDeployments: (...args: unknown[]) => mockListOpenShiftDeployments(...args),
    deployToOpenShift: (...args: unknown[]) => mockDeployToOpenShift(...args),
    deleteOpenShiftDeployment: (...args: unknown[]) => mockDeleteOpenShiftDeployment(...args),
    spawnRobotInOpenShift: (...args: unknown[]) => mockSpawnRobotInOpenShift(...args),
    sendOpenShiftNavigationGoal: (...args: unknown[]) => mockSendOpenShiftNavigationGoal(...args),
    getRobotWarmStatusInOpenShift: (...args: unknown[]) => mockGetRobotWarmStatusInOpenShift(...args),
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
    mockGetOpenShiftContext.mockResolvedValue({ context: 'ctx', kubeconfigPath: '/k/config' });
    mockGetDefaultNamespace.mockResolvedValue('sgahlot-pd-extn');
    mockGetDefaultSoftwareRenderCpus.mockResolvedValue(8);
    // Keep the default image (avoids exercising simulationImageTag here).
    mockGetSimulationConfig.mockRejectedValue(new Error('no config'));
    mockListOpenShiftDeployments.mockResolvedValue([]);
    mockSpawnRobotInOpenShift.mockResolvedValue(undefined);
    mockDeleteOpenShiftDeployment.mockResolvedValue(undefined);
    mockGetRobotWarmStatusInOpenShift.mockResolvedValue('idle');
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

  it('passes useGpu when the GPU checkbox is ticked', async () => {
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
      expect(mockDeployToOpenShift).toHaveBeenCalledWith(expect.objectContaining({ useGpu: true }));
    });
  });

  it('spawns a robot into a ready workload and then navigates it', async () => {
    mockListOpenShiftDeployments.mockResolvedValue([READY_WORKLOAD]);
    mockSendOpenShiftNavigationGoal.mockResolvedValue({ status: 'reached', message: 'ok' });

    render(DeployOpenShift);
    const spawnBtn = await screen.findByRole('button', { name: 'Spawn' });
    await fireEvent.click(spawnBtn);

    await waitFor(() => {
      expect(mockSpawnRobotInOpenShift).toHaveBeenCalledWith(
        'sgahlot-pd-extn',
        'ros2-jazzy-sim',
        'robot_1',
        '-2.0',
        '-0.5',
        '0.0',
      );
    });

    const navBtn = await screen.findByRole('button', { name: 'Navigate' });
    await fireEvent.click(navBtn);

    await waitFor(() => {
      expect(mockSendOpenShiftNavigationGoal).toHaveBeenCalledWith(
        'sgahlot-pd-extn',
        'ros2-jazzy-sim',
        'robot_1',
        2.0,
        0.5,
      );
    });
    expect(await screen.findByText(/Reached/)).toBeTruthy();
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

  it('deletes a workload', async () => {
    mockListOpenShiftDeployments.mockResolvedValue([READY_WORKLOAD]);

    render(DeployOpenShift);
    await screen.findByText('ros2-jazzy-sim');
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockDeleteOpenShiftDeployment).toHaveBeenCalledWith('sgahlot-pd-extn', 'ros2-jazzy-sim');
    });
  });
});
