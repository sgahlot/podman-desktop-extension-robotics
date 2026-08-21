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
const mockGetImageBuilderLayout = vi.fn();
const mockSetImageBuilderLayout = vi.fn();
const mockGoto = vi.fn();

vi.mock('./api/client', () => ({
  physicalAiClient: {
    getDefaultNamespace: (...args: unknown[]) => mockGetDefaultNamespace(...args),
    getHostArch: (...args: unknown[]) => mockGetHostArch(...args),
    getSimulationConfig: (...args: unknown[]) => mockGetSimulationConfig(...args),
    saveSimulationConfig: (...args: unknown[]) => mockSaveSimulationConfig(...args),
    listLocalImages: (...args: unknown[]) => mockListLocalImages(...args),
    buildBaseImage: (...args: unknown[]) => mockBuildBaseImage(...args),
    buildSimulationImage: (...args: unknown[]) => mockBuildSimulationImage(...args),
    getBuildProgress: (...args: unknown[]) => mockGetBuildProgress(...args),
    cancelBuild: (...args: unknown[]) => mockCancelBuild(...args),
    pushImage: (...args: unknown[]) => mockPushImage(...args),
    cancelPush: (...args: unknown[]) => mockCancelPush(...args),
    getPushProgress: (...args: unknown[]) => mockGetPushProgress(...args),
    getImageTags: (...args: unknown[]) => mockGetImageTags(...args),
    getImageBuilderLayout: (...args: unknown[]) => mockGetImageBuilderLayout(...args),
    setImageBuilderLayout: (...args: unknown[]) => mockSetImageBuilderLayout(...args),
  },
}));

vi.mock('tinro', () => ({
  router: { goto: (...args: unknown[]) => mockGoto(...args) },
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
    mockGetBuildProgress.mockResolvedValue(undefined);
    mockGetPushProgress.mockResolvedValue(undefined);
    mockGetImageBuilderLayout.mockResolvedValue('pipeline');
    mockSetImageBuilderLayout.mockResolvedValue(undefined);
  });

  it('renders heading after config loads', async () => {
    render(SimulationSetup);
    expect(screen.getByText('Image Builder')).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText('Loading configuration...')).toBeNull();
    });
    expect(screen.getByRole('button', { name: 'TurtleBot3 Sim (Jazzy)' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /This machine \(arm64\)/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /amd64 \(for OpenShift\)/ })).toBeTruthy();

    // Configuration selects are behind "Customize"
    await fireEvent.click(screen.getByText('Customize'));
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
      expect(screen.queryByText('Loading configuration...')).toBeNull();
    });
    await fireEvent.click(screen.getByText('Customize'));
    await waitFor(() => {
      const distro = screen.getByLabelText('ROS distro') as HTMLSelectElement;
      expect(distro.value).toBe('jazzy');
    });
  });

  it('Quick Start saves jazzy config (arch from the Target toggle, defaults to host)', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(SimulationSetup);
    await waitFor(() => {
      expect(screen.queryByText('Loading configuration...')).toBeNull();
    });

    // Default loaded config (humble/sloretz) differs from the preset, so clicking
    // Quick Start surfaces a confirmation instead of saving immediately.
    await fireEvent.click(screen.getByRole('button', { name: 'TurtleBot3 Sim (Jazzy)' }));
    expect(mockSaveSimulationConfig).not.toHaveBeenCalled();
    await fireEvent.click(await screen.findByRole('button', { name: 'Apply Quick Start' }));

    await waitFor(() => {
      expect(mockSaveSimulationConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          robot: 'turtlebot3',
          distro: 'jazzy',
          middleware: 'dds',
          engine: 'gazebo',
          baseImage: 'jazzy-noble',
          targetArch: 'arm64',
        }),
      );
    });
  });

  it('toggling Target to amd64 then Quick Start saves jazzy config targeting amd64', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(SimulationSetup);
    await waitFor(() => {
      expect(screen.queryByText('Loading configuration...')).toBeNull();
    });

    await fireEvent.click(screen.getByRole('radio', { name: /amd64 \(for OpenShift\)/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'TurtleBot3 Sim (Jazzy)' }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Apply Quick Start' }));

    await waitFor(() => {
      expect(mockSaveSimulationConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          robot: 'turtlebot3',
          distro: 'jazzy',
          middleware: 'dds',
          engine: 'gazebo',
          baseImage: 'jazzy-noble',
          targetArch: 'amd64',
        }),
      );
    });
  });

  it('Quick Start applies immediately without a confirmation when the current config already matches the preset', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    mockGetSimulationConfig.mockResolvedValue({
      robot: 'turtlebot3',
      distro: 'jazzy',
      middleware: 'dds',
      engine: 'gazebo',
      baseImage: 'jazzy-noble',
    });
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
    expect(screen.queryByRole('button', { name: 'Apply Quick Start' })).toBeNull();
  });

  it('Quick Start shows a confirmation when the config differs, and Cancel dismisses it without saving', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(SimulationSetup);
    await waitFor(() => {
      expect(screen.queryByText('Loading configuration...')).toBeNull();
    });

    await fireEvent.click(screen.getByRole('button', { name: 'TurtleBot3 Sim (Jazzy)' }));
    expect(await screen.findByRole('button', { name: 'Apply Quick Start' })).toBeTruthy();
    expect(mockSaveSimulationConfig).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('button', { name: 'Apply Quick Start' })).toBeNull();
    expect(mockSaveSimulationConfig).not.toHaveBeenCalled();
  });

  it('surfaces save errors', async () => {
    mockSaveSimulationConfig.mockRejectedValue(new Error('prefs locked'));
    render(SimulationSetup);
    await waitFor(() => {
      expect(screen.queryByText('Loading configuration...')).toBeNull();
    });

    await fireEvent.click(screen.getByText('Customize'));
    await fireEvent.click(screen.getByRole('button', { name: /Save/i }));
    expect(await screen.findByText('prefs locked')).toBeTruthy();
  });

  it('unlocks Step 2 (simulation build) when the base image already exists locally, without running Quick Start', async () => {
    mockGetSimulationConfig.mockResolvedValue({
      robot: 'turtlebot3',
      distro: 'jazzy',
      middleware: 'dds',
      engine: 'gazebo',
      baseImage: 'jazzy-noble',
    });
    const baseTag = 'quay.io/ecosystem-appeng/ros2-jazzy-base:noble';
    const simTag = 'quay.io/ecosystem-appeng/ros2-jazzy-sim:noble';
    mockListLocalImages.mockResolvedValue([baseTag]);
    mockBuildSimulationImage.mockResolvedValue(undefined);

    render(SimulationSetup);
    await waitFor(() => {
      expect(screen.queryByText('Loading configuration...')).toBeNull();
    });

    // Step 2's build control should be enabled once the base image is found locally.
    const simBuildButton = (await screen.findByRole('button', { name: 'Build' })) as HTMLButtonElement;
    await waitFor(() => expect(simBuildButton.disabled).toBe(false));

    await fireEvent.click(simBuildButton);

    await waitFor(() => {
      expect(mockBuildSimulationImage).toHaveBeenCalledWith(
        simTag,
        expect.objectContaining({
          robot: 'turtlebot3',
          distro: 'jazzy',
          middleware: 'dds',
          engine: 'gazebo',
          baseImage: 'jazzy-noble',
        }),
      );
    });
    // Quick Start / base-image build were never triggered in this session.
    expect(mockBuildBaseImage).not.toHaveBeenCalled();
  });

  it('keeps Step 2 disabled with a hint when the base image is not built locally', async () => {
    mockGetSimulationConfig.mockResolvedValue({
      robot: 'turtlebot3',
      distro: 'jazzy',
      middleware: 'dds',
      engine: 'gazebo',
      baseImage: 'jazzy-noble',
    });
    mockListLocalImages.mockResolvedValue([]);

    render(SimulationSetup);
    await waitFor(() => {
      expect(screen.queryByText('Loading configuration...')).toBeNull();
    });

    expect(await screen.findByText(/Build the base image \(Step 1\) first/)).toBeTruthy();
    const buildButtons = screen.getAllByRole('button', { name: 'Build' }) as HTMLButtonElement[];
    // Step 2's Build button (the second BuildPushPanel rendered) is disabled.
    expect(buildButtons[buildButtons.length - 1].disabled).toBe(true);
  });

  // Note: the beforeEach above pins mockGetImageBuilderLayout to 'pipeline' so the
  // legacy pipeline-mode tests below stay deterministic. The *actual* default (both
  // the `imageBuilderLayout` preference default and the component's pre-load `layout`
  // initializer) is now 'guided' — see the "guided layout hides both build steps..."
  // test, which exercises that mode explicitly.
  describe('Image Builder layout', () => {
    it('pipeline layout mode renders both build steps (explicitly mocked, not the default)', async () => {
      render(SimulationSetup);
      await waitFor(() => {
        expect(screen.queryByText('Loading configuration...')).toBeNull();
      });

      expect(mockGetImageBuilderLayout).toHaveBeenCalled();
      expect(screen.getByText(/Step 1.*Base image/)).toBeTruthy();
      expect(screen.getByText(/Step 2.*Simulation image/)).toBeTruthy();
      expect(screen.getByRole('radio', { name: 'Pipeline' })).toBeTruthy();
      expect(screen.getByRole('radio', { name: 'Guided' })).toBeTruthy();
    });

    it('clicking the Guided layout switcher persists the preference', async () => {
      render(SimulationSetup);
      await waitFor(() => {
        expect(screen.queryByText('Loading configuration...')).toBeNull();
      });

      await fireEvent.click(screen.getByRole('radio', { name: 'Guided' }));

      await waitFor(() => {
        expect(mockSetImageBuilderLayout).toHaveBeenCalledWith('guided');
      });
    });

    // Guided is the actual default layout (imageBuilderLayout preference default
    // and the component's pre-load `layout` initializer both resolve to 'guided').
    it('guided layout hides both build steps until a choice is made', async () => {
      mockGetImageBuilderLayout.mockResolvedValue('guided');

      render(SimulationSetup);
      await waitFor(() => {
        expect(screen.queryByText('Loading configuration...')).toBeNull();
      });

      expect(screen.getByText('What do you want to build?')).toBeTruthy();
      expect(screen.getByText('Choose what to build to continue.')).toBeTruthy();
      expect(screen.queryByText(/Step 1.*Base image/)).toBeNull();
      expect(screen.queryByText(/Step 2.*Simulation image/)).toBeNull();
      expect(screen.getByRole('radio', { name: 'Base image only' })).toBeTruthy();
      expect(screen.getByRole('radio', { name: 'Simulation image' })).toBeTruthy();
      expect(screen.getByRole('radio', { name: 'Both' })).toBeTruthy();
    });

    it('guided layout: choosing "Base image only" reveals Step 1 and not Step 2', async () => {
      mockGetImageBuilderLayout.mockResolvedValue('guided');

      render(SimulationSetup);
      await waitFor(() => {
        expect(screen.queryByText('Loading configuration...')).toBeNull();
      });

      await fireEvent.click(screen.getByRole('radio', { name: 'Base image only' }));

      expect(await screen.findByText(/Step 1.*Base image/)).toBeTruthy();
      expect(screen.queryByText(/Step 2.*Simulation image/)).toBeNull();
      expect(screen.queryByText('Choose what to build to continue.')).toBeNull();
    });

    it('guided layout: choosing "Simulation image" reveals Step 2 (enabled) and hides Step 1 when the base image already exists locally', async () => {
      mockGetImageBuilderLayout.mockResolvedValue('guided');
      mockGetSimulationConfig.mockResolvedValue({
        robot: 'turtlebot3',
        distro: 'jazzy',
        middleware: 'dds',
        engine: 'gazebo',
        baseImage: 'jazzy-noble',
      });
      const baseTag = 'quay.io/ecosystem-appeng/ros2-jazzy-base:noble';
      mockListLocalImages.mockResolvedValue([baseTag]);

      render(SimulationSetup);
      await waitFor(() => {
        expect(screen.queryByText('Loading configuration...')).toBeNull();
      });

      await fireEvent.click(screen.getByRole('radio', { name: 'Simulation image' }));

      expect(screen.queryByText(/Step 1.*Base image/)).toBeNull();
      const simBuildButton = (await screen.findByRole('button', { name: 'Build' })) as HTMLButtonElement;
      await waitFor(() => expect(simBuildButton.disabled).toBe(false));
    });

    it('guided layout: choosing "Simulation image" without the base image reveals Step 1 as a prerequisite and keeps Step 2 disabled', async () => {
      mockGetImageBuilderLayout.mockResolvedValue('guided');
      mockGetSimulationConfig.mockResolvedValue({
        robot: 'turtlebot3',
        distro: 'jazzy',
        middleware: 'dds',
        engine: 'gazebo',
        baseImage: 'jazzy-noble',
      });
      mockListLocalImages.mockResolvedValue([]);

      render(SimulationSetup);
      await waitFor(() => {
        expect(screen.queryByText('Loading configuration...')).toBeNull();
      });

      await fireEvent.click(screen.getByRole('radio', { name: 'Simulation image' }));

      expect(await screen.findByText(/Step 1.*Base image/)).toBeTruthy();
      expect(await screen.findByText(/Build the base image \(Step 1\) first/)).toBeTruthy();
      const buildButtons = screen.getAllByRole('button', { name: 'Build' }) as HTMLButtonElement[];
      expect(buildButtons[buildButtons.length - 1].disabled).toBe(true);
    });
  });
});
