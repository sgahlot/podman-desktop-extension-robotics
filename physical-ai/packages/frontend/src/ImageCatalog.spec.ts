import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import ImageCatalog from './ImageCatalog.svelte';

const mockListCatalogImages = vi.fn();
const mockGetImageTags = vi.fn();
const mockListLocalImages = vi.fn();
const mockPullImage = vi.fn();
const mockGetPullProgress = vi.fn();
const mockGetDefaultNamespace = vi.fn();
const mockGoto = vi.fn();

vi.mock('./api/client', () => ({
  physicalAiClient: {
    listCatalogImages: (...args: any[]) => mockListCatalogImages(...args),
    getImageTags: (...args: any[]) => mockGetImageTags(...args),
    listLocalImages: (...args: any[]) => mockListLocalImages(...args),
    pullImage: (...args: any[]) => mockPullImage(...args),
    getPullProgress: (...args: any[]) => mockGetPullProgress(...args),
    getDefaultNamespace: (...args: any[]) => mockGetDefaultNamespace(...args),
  },
}));

vi.mock('tinro', () => ({
  router: { goto: (...args: any[]) => mockGoto(...args) },
}));

describe('ImageCatalog', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetDefaultNamespace.mockResolvedValue('ecosystem-appeng');
    mockListLocalImages.mockResolvedValue([]);
    mockListCatalogImages.mockResolvedValue([]);
  });

  it('renders heading', async () => {
    render(ImageCatalog);
    expect(screen.getByText('Image Catalog')).toBeTruthy();
  });

  it('initializes namespace from settings on mount', async () => {
    mockGetDefaultNamespace.mockResolvedValue('my-ns');
    render(ImageCatalog);
    await waitFor(() => {
      const input = screen.getByLabelText('Quay.io namespace') as HTMLInputElement;
      expect(input.value).toBe('my-ns');
    });
  });

  it('loads repos on mount', async () => {
    mockListCatalogImages.mockResolvedValue([
      { name: 'ros2-base', namespace: 'ecosystem-appeng' },
    ]);
    render(ImageCatalog);
    await waitFor(() => {
      expect(screen.getByText(/ros2-base/)).toBeTruthy();
    });
  });

  it('shows error when loading repos fails', async () => {
    mockListCatalogImages.mockRejectedValue(new Error('Network error'));
    render(ImageCatalog);
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeTruthy();
    });
  });

  it('shows repository count', async () => {
    mockListCatalogImages.mockResolvedValue([
      { name: 'repo1', namespace: 'ns' },
      { name: 'repo2', namespace: 'ns' },
    ]);
    render(ImageCatalog);
    await waitFor(() => {
      expect(screen.getByText(/Showing 2 of 2/)).toBeTruthy();
    });
  });

  it('filters repos by name', async () => {
    mockListCatalogImages.mockResolvedValue([
      { name: 'ros2-base', namespace: 'ns' },
      { name: 'ros2-sim', namespace: 'ns' },
    ]);
    render(ImageCatalog);
    await waitFor(() => {
      expect(screen.getByText(/Showing 2 of 2/)).toBeTruthy();
    });
    const filterInput = screen.getByLabelText('Filter by name');
    await fireEvent.input(filterInput, { target: { value: 'sim' } });
    await waitFor(() => {
      expect(screen.getByText(/Showing 1 of 2/)).toBeTruthy();
    });
  });

  it('shows locally available section', async () => {
    mockListLocalImages.mockResolvedValue(['quay.io/ecosystem-appeng/ros2-base:latest']);
    render(ImageCatalog);
    await waitFor(() => {
      expect(screen.getByText(/Locally Available/)).toBeTruthy();
    });
  });

  it('navigates back to dashboard', async () => {
    render(ImageCatalog);
    const backBtn = screen.getByText(/Back to Dashboard/);
    await fireEvent.click(backBtn);
    expect(mockGoto).toHaveBeenCalledWith('/');
  });

  it('expands repo to show tags', async () => {
    mockListCatalogImages.mockResolvedValue([
      { name: 'ros2-base', namespace: 'ecosystem-appeng' },
    ]);
    mockGetImageTags.mockResolvedValue([
      { name: 'latest', size: 1024000, last_modified: '2026-01-15T10:00:00Z', manifest_digest: 'sha256:abc123def456' },
    ]);
    render(ImageCatalog);
    await waitFor(() => {
      expect(screen.getByText(/ros2-base/)).toBeTruthy();
    });
    const repoBtn = screen.getByText(/ros2-base/);
    await fireEvent.click(repoBtn);
    await waitFor(() => {
      expect(screen.getByText('latest')).toBeTruthy();
    });
  });

  it('shows Pull button for non-local tags', async () => {
    mockListCatalogImages.mockResolvedValue([
      { name: 'ros2-base', namespace: 'ecosystem-appeng' },
    ]);
    mockGetImageTags.mockResolvedValue([
      { name: 'v1.0', size: 2048000, last_modified: '2026-01-15T10:00:00Z', manifest_digest: 'sha256:abc123def456' },
    ]);
    render(ImageCatalog);
    await waitFor(() => {
      expect(screen.getByText(/ros2-base/)).toBeTruthy();
    });
    await fireEvent.click(screen.getByText(/ros2-base/));
    await waitFor(() => {
      expect(screen.getByText('Pull')).toBeTruthy();
    });
  });
});
