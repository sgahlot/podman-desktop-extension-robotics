import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import BuildPushPanel from './BuildPushPanel.svelte';

const mockListLocalImages = vi.fn();
const mockGetImageTags = vi.fn();
const mockGetBuildProgress = vi.fn();
const mockCancelBuild = vi.fn();
const mockPushImage = vi.fn();
const mockCancelPush = vi.fn();
const mockGetPushProgress = vi.fn();

vi.mock('../api/client', () => ({
  physicalAiClient: {
    listLocalImages: (...args: any[]) => mockListLocalImages(...args),
    getImageTags: (...args: any[]) => mockGetImageTags(...args),
    getBuildProgress: (...args: any[]) => mockGetBuildProgress(...args),
    cancelBuild: (...args: any[]) => mockCancelBuild(...args),
    pushImage: (...args: any[]) => mockPushImage(...args),
    cancelPush: (...args: any[]) => mockCancelPush(...args),
    getPushProgress: (...args: any[]) => mockGetPushProgress(...args),
  },
}));

const TAG = 'quay.io/ns/ros2-jazzy-base:noble';

describe('BuildPushPanel', () => {
  const buildImage = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    buildImage.mockResolvedValue(undefined);
    mockListLocalImages.mockResolvedValue([]);
    mockGetImageTags.mockResolvedValue([]);
    mockGetBuildProgress.mockResolvedValue(null);
    mockGetPushProgress.mockResolvedValue(null);
    mockCancelBuild.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders tag input and Build button', async () => {
    render(BuildPushPanel, {
      props: {
        buildImage,
        tag: TAG,
        tagInputId: 'phase1-tag',
      },
    });

    expect(screen.getByLabelText('Image tag')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Build' })).toBeTruthy();
  });

  it('shows Rebuild when image exists locally', async () => {
    mockListLocalImages.mockResolvedValue([TAG]);

    render(BuildPushPanel, {
      props: {
        buildImage,
        tag: TAG,
        tagInputId: 'phase1-tag',
      },
    });

    expect(await screen.findByRole('button', { name: 'Rebuild' })).toBeTruthy();
    expect(await screen.findByText(/Image exists locally/)).toBeTruthy();
  });

  it('starts build and shows Cancel while in progress', async () => {
    let resolveBuild!: () => void;
    buildImage.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          resolveBuild = resolve;
        }),
    );
    mockGetBuildProgress.mockResolvedValue({
      tag: TAG,
      status: 'Building...',
      logs: ['STEP 1/2'],
      currentStep: 1,
      totalSteps: 2,
    });

    render(BuildPushPanel, {
      props: {
        buildImage,
        tag: TAG,
        tagInputId: 'phase1-tag',
      },
    });

    await fireEvent.click(await screen.findByRole('button', { name: 'Build' }));
    await waitFor(() => {
      expect(buildImage).toHaveBeenCalledWith(TAG);
    });
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeTruthy();

    resolveBuild();
  });

  it('cancels an in-flight build', async () => {
    buildImage.mockImplementation(() => new Promise(() => {}));
    mockGetBuildProgress.mockResolvedValue({
      tag: TAG,
      status: 'Building...',
      logs: [],
    });

    render(BuildPushPanel, {
      props: {
        buildImage,
        tag: TAG,
        tagInputId: 'phase1-tag',
      },
    });

    await fireEvent.click(await screen.findByRole('button', { name: 'Build' }));
    const cancelBtn = await screen.findByRole('button', { name: 'Cancel' });
    await fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(mockCancelBuild).toHaveBeenCalledWith(TAG);
    });
    expect(await screen.findByText('Build cancelled')).toBeTruthy();
  });

  it('surfaces build start failures', async () => {
    buildImage.mockRejectedValue(new Error('no podman'));

    render(BuildPushPanel, {
      props: {
        buildImage,
        tag: TAG,
        tagInputId: 'phase1-tag',
      },
    });

    await fireEvent.click(await screen.findByRole('button', { name: 'Build' }));
    expect(await screen.findByText(/Build failed: no podman/)).toBeTruthy();
  });
});
