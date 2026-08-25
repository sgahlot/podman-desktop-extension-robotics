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
    listLocalImages: (...args: unknown[]) => mockListLocalImages(...args),
    getImageTags: (...args: unknown[]) => mockGetImageTags(...args),
    getBuildProgress: (...args: unknown[]) => mockGetBuildProgress(...args),
    cancelBuild: (...args: unknown[]) => mockCancelBuild(...args),
    pushImage: (...args: unknown[]) => mockPushImage(...args),
    cancelPush: (...args: unknown[]) => mockCancelPush(...args),
    getPushProgress: (...args: unknown[]) => mockGetPushProgress(...args),
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
    mockGetBuildProgress.mockResolvedValue(undefined);
    mockGetPushProgress.mockResolvedValue(undefined);
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
    expect(await screen.findByText(/Build cancelled/)).toBeTruthy();
  });

  it('shows build duration and a "Last build" label once done', async () => {
    const startedAt = 1_000;
    mockGetBuildProgress.mockResolvedValue({
      tag: TAG,
      status: 'Complete',
      logs: ['[00:00:01] STEP 1/1', '[00:00:06] Build finished'],
      currentStep: 1,
      totalSteps: 1,
      done: true,
      startedAt,
      finishedAt: startedAt + 5_000,
    });

    render(BuildPushPanel, {
      props: {
        buildImage,
        tag: TAG,
        tagInputId: 'phase1-tag',
      },
    });

    await fireEvent.click(await screen.findByRole('button', { name: 'Build' }));
    expect(await screen.findByText(/Image built successfully/)).toBeTruthy();
    expect(screen.getByText(/built in 5s/)).toBeTruthy();
    expect(screen.getByText(/Last build/)).toBeTruthy();
  });

  it('clears stale build logs/status when the tag prop changes to a different (unbuilt) tag', async () => {
    const startedAt = 1_000;
    mockGetBuildProgress.mockResolvedValue({
      tag: TAG,
      status: 'Complete',
      logs: ['[00:00:01] STEP 1/1', '[00:00:06] Build finished'],
      currentStep: 1,
      totalSteps: 1,
      done: true,
      startedAt,
      finishedAt: startedAt + 5_000,
    });

    const { rerender } = render(BuildPushPanel, {
      props: { buildImage, tag: TAG, tagInputId: 'phase1-tag' },
    });

    await fireEvent.click(await screen.findByRole('button', { name: 'Build' }));
    expect(await screen.findByText(/Image built successfully/)).toBeTruthy();
    expect(screen.getByText(/Last build/)).toBeTruthy();

    const OTHER_TAG = 'quay.io/ns/ros2-jazzy-base:noble-amd64';
    await rerender({ buildImage, tag: OTHER_TAG, tagInputId: 'phase1-tag' });

    await waitFor(() => {
      expect(screen.queryByText(/Last build/)).toBeNull();
    });
    expect(screen.queryByText(/Image built successfully/)).toBeNull();
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
