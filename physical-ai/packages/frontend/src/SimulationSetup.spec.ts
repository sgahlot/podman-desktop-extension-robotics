import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import SimulationSetup from './SimulationSetup.svelte';

const mockGetDefaultNamespace = vi.fn();
const mockGetHostArch = vi.fn();
const mockGetSimulationConfig = vi.fn();
const mockSaveSimulationConfig = vi.fn();
const mockListLocalImages = vi.fn();
const mockBuildBaseImage = vi.fn();
const mockBuildSimulationImage = vi.fn();
const mockGetBuildProgress = vi.fn();
const mockCancelBuild = vi.fn();
const mockPushImage = vi.fn();
const mockCancelPush = vi.fn();
const mockGetPushProgress = vi.fn();
const mockGetImageTags = vi.fn();
const mockGoto = vi.fn();

vi.mock('./api/client', () => ({
  physicalAiClient: {
    getDefaultNamespace: (...args: any[]) => mockGetDefaultNamespace(...args),
    getHostArch: (...args: any[]) => mockGetHostArch(...args),
    getSimulationConfig: (...args: any[]) => mockGetSimulationConfig(...args),
    saveSimulationConfig: (...args: any[]) => mockSaveSimulationConfig(...args),
    listLocalImages: (...args: any[]) => mockListLocalImages(...args),
    buildBaseImage: (...args: any[]) => mockBuildBaseImage(...args),
    buildSimulationImage: (...args: any[]) => mockBuildSimulationImage(...args),
    getBuildProgress: (...args: any[]) => mockGetBuildProgress(...args),
    cancelBuild: (...args: any[]) => mockCancelBuild(...args),
    pushImage: (...args: any[]) => mockPushImage(...args),
    cancelPush: (...args: any[]) => mockCancelPush(...args),
    getPushProgress: (...args: any[]) => mockGetPushProgress(...args),
    getImageTags: (...args: any[]) => mockGetImageTags(...args),
  },
}));

vi.mock('tinro', () => ({
  router: { goto: (...args: any[]) => mockGoto(...args) },
}));

describe('SimulationSetup (Image Builder)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetDefaultNamespace.mockResolvedValue('ecosystem-appeng');
    mockGetHostArch.mockResolvedValue('arm64');
    mockGetSimulationConfig.mockResolvedValue({
      robot: 'turtlebot3',
      distro: 'humble',
      middleware: 'dds',
      engine: 'gazebo',
      baseImage: 'sloretz',
    });
    mockSaveSimulationConfig.mockResolvedValue(undefined);
    mockListLocalImages.mockResolvedValue([]);
    mockGetImageTags.mockResolvedValue([]);
    mockGetBuildProgress.mockResolvedValue(null);
    mockGetPushProgress.mockResolvedValue(null);
  });

  it('renders heading after config loads', async () => {
    render(SimulationSetup);
    expect(screen.getByText('Image Builder')).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText('Loading configuration...')).toBeNull();
    });
    expect(screen.getByText('Quick Start')).toBeTruthy();
    expect(screen.getByLabelText('ROS distro')).toBeTruthy();
  });

  it('loads preferences into the form', async () => {
    mockGetSimulationConfig.mockResolvedValue({
      robot: 'turtlebot3',
      distro: 'jazzy',
      middleware: 'dds',
      engine: 'gazebo',
      baseImage: 'jazzy-noble',
    });

    render(SimulationSetup);
    await waitFor(() => {
      const distro = screen.getByLabelText('ROS distro') as HTMLSelectElement;
      expect(distro.value).toBe('jazzy');
    });
  });

  it('Quick Start saves jazzy config', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(SimulationSetup);
    await waitFor(() => {
      expect(screen.queryByText('Loading configuration...')).toBeNull();
    });

    await fireEvent.click(screen.getByRole('button', { name: 'TurtleBot3 Sim (Jazzy)' }));

    await waitFor(() => {
      expect(mockSaveSimulationConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          robot: 'turtlebot3',
          distro: 'jazzy',
          middleware: 'dds',
          engine: 'gazebo',
          baseImage: 'jazzy-noble',
        }),
      );
    });
  });

  it('surfaces save errors', async () => {
    mockSaveSimulationConfig.mockRejectedValue(new Error('prefs locked'));
    render(SimulationSetup);
    await waitFor(() => {
      expect(screen.queryByText('Loading configuration...')).toBeNull();
    });

    await fireEvent.click(screen.getByRole('button', { name: /Save/i }));
    expect(await screen.findByText('prefs locked')).toBeTruthy();
  });
});
