import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import Dashboard from './Dashboard.svelte';

const mockGetStatus = vi.fn();
const mockListLocalImages = vi.fn();
const mockListSimulationContainers = vi.fn();
const mockListOpenShiftDeployments = vi.fn();
const mockGetOpenShiftContext = vi.fn();
const mockGetDefaultOpenShiftNamespace = vi.fn();
const mockOpenUrlInBrowser = vi.fn();
const mockGoto = vi.fn();

vi.mock('./api/client', () => ({
  physicalAiClient: {
    getStatus: (...args: unknown[]) => mockGetStatus(...args),
    listLocalImages: (...args: unknown[]) => mockListLocalImages(...args),
    listSimulationContainers: (...args: unknown[]) => mockListSimulationContainers(...args),
    listOpenShiftDeployments: (...args: unknown[]) => mockListOpenShiftDeployments(...args),
    getOpenShiftContext: (...args: unknown[]) => mockGetOpenShiftContext(...args),
    getDefaultOpenShiftNamespace: (...args: unknown[]) => mockGetDefaultOpenShiftNamespace(...args),
    openUrlInBrowser: (...args: unknown[]) => mockOpenUrlInBrowser(...args),
  },
}));

vi.mock('tinro', () => ({
  router: { goto: (...args: unknown[]) => mockGoto(...args) },
}));

function metricButton(name: string): HTMLElement {
  return screen.getByRole('button', { name }) as HTMLElement;
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetStatus.mockResolvedValue('Robotics extension is running');
    mockListLocalImages.mockResolvedValue(['quay.io/x/ros2-jazzy-sim:noble', 'docker.io/lib/nginx']);
    mockListSimulationContainers.mockResolvedValue([
      { id: 'c1', name: 'pai-sim-1', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [], labels: {} },
      { id: 'c2', name: 'pai-sim-2', imageTag: 'ros2-jazzy-sim:noble', state: 'exited', ports: [], labels: {} },
    ]);
    mockGetOpenShiftContext.mockResolvedValue({ context: 'ctx1', kubeconfigPath: '/x', namespace: 'team-ns' });
    mockListOpenShiftDeployments.mockResolvedValue([
      {
        name: 'ros2-jazzy-sim',
        namespace: 'team-ns',
        replicas: 1,
        readyReplicas: 1,
        ready: true,
        image: 'img',
        routeUrl: 'https://x',
        hasHummingbirdSidecar: false,
      },
    ]);
    mockGetDefaultOpenShiftNamespace.mockResolvedValue('');
    mockOpenUrlInBrowser.mockResolvedValue(undefined);
  });

  it('renders heading', () => {
    render(Dashboard);
    expect(screen.getByText('Robotics')).toBeTruthy();
  });

  it('shows status after loading', async () => {
    render(Dashboard);
    const statusEl = await screen.findByText(/Robotics extension is running/);
    expect(statusEl).toBeTruthy();
  });

  it('shows error status when backend is unreachable', async () => {
    mockGetStatus.mockRejectedValue(new Error('connection refused'));
    render(Dashboard);
    const statusEl = await screen.findByText(/Unable to connect to backend/);
    expect(statusEl).toBeTruthy();
  });

  it('navigates to Image Catalog on click', async () => {
    render(Dashboard);
    const btn = screen.getByText('Local ROS 2 images');
    await fireEvent.click(btn);
    expect(mockGoto).toHaveBeenCalledWith('/images');
  });

  it('navigates to Help on click', async () => {
    render(Dashboard);
    const btn = screen.getByText(/Read the full guide/);
    await fireEvent.click(btn);
    expect(mockGoto).toHaveBeenCalledWith('/help');
  });

  it('navigates to Simulation on click', async () => {
    render(Dashboard);
    const btn = screen.getByText(/Simulate/);
    await fireEvent.click(btn);
    expect(mockGoto).toHaveBeenCalledWith('/simulation');
  });

  it('navigates to Simulation when the Get Started "3 · Navigate" step is clicked (APPENG-6260)', async () => {
    render(Dashboard);
    const btn = screen.getByText(/Navigate/);
    await fireEvent.click(btn);
    expect(mockGoto).toHaveBeenCalledWith('/simulation');
  });

  it('describes the Get Started flow with wording matching the step buttons below it (APPENG-6260)', () => {
    render(Dashboard);
    // "Simulate" and "Navigate" both land on /simulation (driving the robot happens on the
    // same page as launching the sim) — that's intentional, not a routing bug. The actual
    // confusion was this sentence saying "drive the robot" while the button below it says
    // "Navigate"; the wording should match.
    expect(screen.getByText(/navigate the robot/)).toBeTruthy();
    expect(screen.queryByText(/drive the robot/)).toBeNull();
  });

  it('shows the guidance dashboard', async () => {
    render(Dashboard);
    expect(screen.getByText('Welcome to Robotics')).toBeTruthy();
    expect(screen.getByText('Open Image Builder')).toBeTruthy();
    expect(screen.getByText('Local ROS 2 images')).toBeTruthy();
    expect(screen.getByText('local')).toBeTruthy();
    expect(screen.getByText('OpenShift')).toBeTruthy();
    expect(screen.getByText('ROS 2 Jazzy documentation')).toBeTruthy();
    expect(screen.getByText('TurtleBot3')).toBeTruthy();
    expect(screen.getByText('Nav2')).toBeTruthy();
    expect(screen.getByText('Extension guide')).toBeTruthy();
  });

  it('loads and shows metric counts', async () => {
    render(Dashboard);
    // Only the quay.io/x/ros2-jazzy-sim ref matches the ros2- image name filter.
    const imagesTile = screen.getByText('Local ROS 2 images').closest('button');
    expect(imagesTile).toBeTruthy();
    expect(await within(imagesTile as HTMLElement).findByText('1')).toBeTruthy();
    const localTile = metricButton('Local simulations');
    expect(within(localTile).getByText('1')).toBeTruthy();
    const openShiftTile = metricButton('OpenShift simulations');
    expect(await within(openShiftTile).findByText('1')).toBeTruthy();
  });

  it('refreshes local sim count when the dashboard becomes active again', async () => {
    mockListSimulationContainers
      .mockResolvedValueOnce([
        { id: 'c1', name: 'pai-sim-1', imageTag: 'ros2-jazzy-sim:noble', state: 'running', ports: [], labels: {} },
      ])
      .mockResolvedValueOnce([]);
    const { rerender } = render(Dashboard, { active: true });
    const localTile = metricButton('Local simulations');
    expect(await within(localTile).findByText('1')).toBeTruthy();
    await rerender({ active: false });
    await rerender({ active: true });
    expect(await within(localTile).findByText('0')).toBeTruthy();
    expect(mockListSimulationContainers).toHaveBeenCalledTimes(2);
  });

  it('opens the ROS 2 docs URL when the explore card is clicked', async () => {
    render(Dashboard, { layout: 'sidebar' });
    await fireEvent.click(screen.getByText('ROS 2 Jazzy documentation'));
    expect(mockOpenUrlInBrowser).toHaveBeenCalledWith('https://docs.ros.org/en/jazzy/');
  });

  it('navigates to Help when the Extension guide card is clicked', async () => {
    render(Dashboard, { layout: 'sidebar' });
    await fireEvent.click(screen.getByText('Extension guide'));
    expect(mockGoto).toHaveBeenCalledWith('/help');
  });

  it('navigates to Image Catalog when the local images metric tile is clicked', async () => {
    render(Dashboard, { layout: 'sidebar' });
    await fireEvent.click(screen.getByText('Local ROS 2 images'));
    expect(mockGoto).toHaveBeenCalledWith('/images');
  });

  it('navigates to Simulation Local tab when the local simulations metric tile is clicked', async () => {
    render(Dashboard, { layout: 'sidebar' });
    await fireEvent.click(metricButton('Local simulations'));
    expect(mockGoto).toHaveBeenCalledWith('/simulation');
  });

  it('navigates to Simulation OpenShift tab when the OpenShift simulations metric tile is clicked', async () => {
    render(Dashboard, { layout: 'sidebar' });
    await fireEvent.click(metricButton('OpenShift simulations'));
    expect(mockGoto).toHaveBeenCalledWith('/simulation/openshift');
  });

  it('loads OpenShift simulation count from listOpenShiftDeployments using the resolved namespace', async () => {
    render(Dashboard, { layout: 'sidebar' });
    expect(await within(metricButton('OpenShift simulations')).findByText('1')).toBeTruthy();
    expect(mockListOpenShiftDeployments).toHaveBeenCalledWith('team-ns', 'ctx1');
  });
});
