import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import BuildBaseImage from './BuildBaseImage.svelte';

const mockBuildBaseImage = vi.fn();
const mockPushImage = vi.fn();
const mockListLocalImages = vi.fn();
const mockGetBuildProgress = vi.fn();
const mockGetPushProgress = vi.fn();
const mockGetDefaultNamespace = vi.fn();
const mockGoto = vi.fn();

vi.mock('./api/client', () => ({
  physicalAiClient: {
    buildBaseImage: (...args: any[]) => mockBuildBaseImage(...args),
    pushImage: (...args: any[]) => mockPushImage(...args),
    listLocalImages: (...args: any[]) => mockListLocalImages(...args),
    getBuildProgress: (...args: any[]) => mockGetBuildProgress(...args),
    getPushProgress: (...args: any[]) => mockGetPushProgress(...args),
    getDefaultNamespace: (...args: any[]) => mockGetDefaultNamespace(...args),
  },
}));

vi.mock('tinro', () => ({
  router: { goto: (...args: any[]) => mockGoto(...args) },
}));

describe('BuildBaseImage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetDefaultNamespace.mockResolvedValue('ecosystem-appeng');
    mockListLocalImages.mockResolvedValue([]);
  });

  it('renders heading', () => {
    render(BuildBaseImage);
    expect(screen.getByText('Build & Push Base Image')).toBeTruthy();
  });

  it('initializes tag from default namespace', async () => {
    mockGetDefaultNamespace.mockResolvedValue('my-org');
    render(BuildBaseImage);
    await waitFor(() => {
      const input = screen.getByLabelText('Image tag') as HTMLInputElement;
      expect(input.value).toBe('quay.io/my-org/ros2-jazzy-base:latest');
    });
  });

  it('shows Build button when image does not exist locally', async () => {
    render(BuildBaseImage);
    await waitFor(() => {
      expect(screen.getByText('Build')).toBeTruthy();
    });
  });

  it('shows Rebuild button when image exists locally', async () => {
    mockListLocalImages.mockResolvedValue(['quay.io/ecosystem-appeng/ros2-jazzy-base:latest']);
    render(BuildBaseImage);
    await waitFor(() => {
      expect(screen.getByText('Rebuild')).toBeTruthy();
    });
  });

  it('shows local image indicator when image exists', async () => {
    mockListLocalImages.mockResolvedValue(['quay.io/ecosystem-appeng/ros2-jazzy-base:latest']);
    render(BuildBaseImage);
    await waitFor(() => {
      expect(screen.getByText(/Image exists locally/)).toBeTruthy();
    });
  });

  it('starts build on button click', async () => {
    mockBuildBaseImage.mockResolvedValue(undefined);
    mockGetBuildProgress.mockResolvedValue({
      tag: 'quay.io/ecosystem-appeng/ros2-jazzy-base:latest',
      status: 'Building... Step 1/5',
      logs: ['STEP 1/5: FROM ubuntu:24.04'],
      currentStep: 1,
      totalSteps: 5,
    });

    render(BuildBaseImage);
    await waitFor(() => {
      expect(screen.getByText('Build')).toBeTruthy();
    });

    await fireEvent.click(screen.getByText('Build'));
    expect(mockBuildBaseImage).toHaveBeenCalledWith('quay.io/ecosystem-appeng/ros2-jazzy-base:latest');
  });

  it('navigates back to dashboard', async () => {
    render(BuildBaseImage);
    const backBtn = screen.getByText(/Back to Dashboard/);
    await fireEvent.click(backBtn);
    expect(mockGoto).toHaveBeenCalledWith('/');
  });

  it('shows Push to Registry when image exists locally', async () => {
    mockListLocalImages.mockResolvedValue(['quay.io/ecosystem-appeng/ros2-jazzy-base:latest']);
    render(BuildBaseImage);
    await waitFor(() => {
      expect(screen.getByText('Push to Registry')).toBeTruthy();
    });
  });
});
