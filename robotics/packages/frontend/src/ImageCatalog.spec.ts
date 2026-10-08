import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import ImageCatalog from './ImageCatalog.svelte';
import { navigationLayout } from './lib/navigationLayout';

const mockListCatalogImages = vi.fn();
const mockGetImageTags = vi.fn();
const mockGetCatalogRegistries = vi.fn();
const mockGetCatalogRegistriesJson = vi.fn();
const mockSetCatalogRegistriesJson = vi.fn();
const mockListCatalogRepositories = vi.fn();
const mockGetCatalogTags = vi.fn();
const mockListLocalImages = vi.fn();
const mockPullImage = vi.fn();
const mockPullImageByRef = vi.fn();
const mockGetPullProgress = vi.fn();
const mockGetDefaultNamespace = vi.fn();
const mockGetCatalogViewMode = vi.fn();
const mockSetCatalogViewMode = vi.fn();
const mockGetCatalogCuratedAllowlist = vi.fn();
const mockGoto = vi.fn();

vi.mock('./api/client', () => ({
  physicalAiClient: {
    getCatalogRegistries: (...args: unknown[]) => mockGetCatalogRegistries(...args),
    getCatalogRegistriesJson: (...args: unknown[]) => mockGetCatalogRegistriesJson(...args),
    setCatalogRegistriesJson: (...args: unknown[]) => mockSetCatalogRegistriesJson(...args),
    listCatalogRepositories: (...args: unknown[]) => mockListCatalogRepositories(...args),
    getCatalogTags: (...args: unknown[]) => mockGetCatalogTags(...args),
    listCatalogImages: (...args: unknown[]) => mockListCatalogImages(...args),
    getImageTags: (...args: unknown[]) => mockGetImageTags(...args),
    listLocalImages: (...args: unknown[]) => mockListLocalImages(...args),
    pullImage: (...args: unknown[]) => mockPullImage(...args),
    pullImageByRef: (...args: unknown[]) => mockPullImageByRef(...args),
    getPullProgress: (...args: unknown[]) => mockGetPullProgress(...args),
    getDefaultNamespace: (...args: unknown[]) => mockGetDefaultNamespace(...args),
    getCatalogViewMode: (...args: unknown[]) => mockGetCatalogViewMode(...args),
    setCatalogViewMode: (...args: unknown[]) => mockSetCatalogViewMode(...args),
    getCatalogCuratedAllowlist: (...args: unknown[]) => mockGetCatalogCuratedAllowlist(...args),
  },
}));

vi.mock('tinro', () => ({
  router: { goto: (...args: unknown[]) => mockGoto(...args) },
}));

describe('ImageCatalog', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    navigationLayout.set('sidebar');
    mockGetDefaultNamespace.mockResolvedValue('ecosystem-appeng');
    mockGetCatalogRegistries.mockResolvedValue([
      { id: 'quay', displayName: 'Quay.io', kind: 'quay', host: 'quay.io', namespace: 'ecosystem-appeng' },
    ]);
    mockGetCatalogRegistriesJson.mockResolvedValue('');
    mockSetCatalogRegistriesJson.mockResolvedValue(undefined);
    mockListCatalogRepositories.mockImplementation((...args: unknown[]) => mockListCatalogImages(...args));
    mockGetCatalogTags.mockImplementation((...args: unknown[]) => mockGetImageTags(...args));
    mockGetCatalogViewMode.mockResolvedValue('all');
    mockGetCatalogCuratedAllowlist.mockResolvedValue('ros2-*-base,ros2-*-turtlebot3,ros2-*-sim*');
    mockSetCatalogViewMode.mockResolvedValue(undefined);
    mockListLocalImages.mockResolvedValue([]);
    mockListCatalogImages.mockResolvedValue([]);
  });

  it('renders heading', async () => {
    render(ImageCatalog);
    expect(screen.getByText('Image Catalog')).toBeTruthy();
  });

  it('shows a validation error when registry settings are invalid', async () => {
    mockGetCatalogRegistries.mockRejectedValue(new Error('Invalid catalog.registries JSON: unexpected token'));
    render(ImageCatalog);
    await waitFor(() => expect(screen.getAllByText(/Invalid catalog\.registries JSON/).length).toBeGreaterThan(0));
  });

  it('refreshes local images when the tab becomes active again', async () => {
    mockListLocalImages.mockResolvedValueOnce([]).mockResolvedValueOnce(['quay.io/sgahlot/ros2-jazzy-base:noble']);
    const { rerender } = render(ImageCatalog, { props: { active: false } });
    await waitFor(() => {
      expect(mockListLocalImages).not.toHaveBeenCalled();
    });
    void rerender({ active: true });
    await waitFor(() => {
      expect(mockListLocalImages).toHaveBeenCalled();
    });
    void rerender({ active: false });
    void rerender({ active: true });
    await waitFor(() => {
      expect(mockListLocalImages.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
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
    mockListCatalogImages.mockResolvedValue([{ name: 'ros2-base', namespace: 'ecosystem-appeng' }]);
    render(ImageCatalog);
    await waitFor(() => {
      expect(screen.getByText(/ros2-base/)).toBeTruthy();
    });
  });

  it('switches registries and uses the configured namespace', async () => {
    mockGetCatalogRegistries.mockResolvedValue([
      { id: 'quay', displayName: 'Quay.io', kind: 'quay', host: 'quay.io', namespace: 'ecosystem-appeng' },
      { id: 'docker-hub', displayName: 'Docker Hub', kind: 'docker-hub', host: 'docker.io', namespace: 'library' },
    ]);
    render(ImageCatalog);
    await waitFor(() => expect(screen.getByLabelText('Registry')).toBeTruthy());
    await fireEvent.change(screen.getByLabelText('Registry'), { target: { value: 'docker-hub' } });
    await waitFor(() => {
      expect((screen.getByLabelText('Docker Hub namespace') as HTMLInputElement).value).toBe('library');
      expect(mockListCatalogRepositories).toHaveBeenCalledWith('docker-hub', 'library');
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
    const filterInput = screen.getByLabelText('Filter by repository name');
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
    navigationLayout.set('cards');
    render(ImageCatalog);
    const backBtn = screen.getByText(/Back to Dashboard/);
    await fireEvent.click(backBtn);
    expect(mockGoto).toHaveBeenCalledWith('/');
  });

  it('hides the back-to-dashboard link and Quick Links when navigation layout is sidebar', () => {
    navigationLayout.set('sidebar');
    render(ImageCatalog);
    expect(screen.queryByText(/Back to Dashboard/)).toBeNull();
    expect(screen.queryByText('Quick Links:')).toBeNull();
  });

  it('expands repo to show tags', async () => {
    mockListCatalogImages.mockResolvedValue([{ name: 'ros2-base', namespace: 'ecosystem-appeng' }]);
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
    mockListCatalogImages.mockResolvedValue([{ name: 'ros2-base', namespace: 'ecosystem-appeng' }]);
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

  it('filters tags within an expanded repository', async () => {
    mockListCatalogImages.mockResolvedValue([{ name: 'ros2-base', namespace: 'ecosystem-appeng' }]);
    mockGetImageTags.mockResolvedValue([
      { name: 'jazzy', size: 1, last_modified: '2026-01-15T10:00:00Z', manifest_digest: 'sha256:jazzy' },
      { name: 'humble', size: 1, last_modified: '2026-01-15T10:00:00Z', manifest_digest: 'sha256:humble' },
    ]);
    render(ImageCatalog);
    await waitFor(() => expect(screen.getByText(/ros2-base/)).toBeTruthy());
    await fireEvent.click(screen.getByText(/ros2-base/));
    await waitFor(() => expect(screen.getAllByText('jazzy').length).toBeGreaterThan(0));
    await fireEvent.input(screen.getByLabelText('Filter by tag'), { target: { value: 'humble' } });
    await waitFor(() => {
      expect(screen.getAllByText('humble').length).toBeGreaterThan(0);
      expect(screen.queryAllByText('jazzy')).toHaveLength(0);
    });
  });

  it('filters to curated allowlist when Curated is selected', async () => {
    mockListCatalogImages.mockResolvedValue([
      { name: 'ros2-humble-base', namespace: 'ns' },
      { name: 'other-tool', namespace: 'ns' },
      { name: 'ros2-humble-turtlebot3', namespace: 'ns' },
      { name: 'ros2-jazzy-sim', namespace: 'ns' },
    ]);
    render(ImageCatalog);
    await waitFor(() => {
      expect(screen.getByText(/Showing 4 of 4/)).toBeTruthy();
    });
    await fireEvent.click(screen.getByText('Curated'));
    await waitFor(() => {
      expect(mockSetCatalogViewMode).toHaveBeenCalledWith('curated');
      expect(screen.getByText(/Showing 3 curated of 4/)).toBeTruthy();
      expect(screen.queryByText('other-tool')).toBeNull();
    });
  });

  it('saves a curated pattern override for the selected registry', async () => {
    mockListCatalogImages.mockResolvedValue([{ name: 'custom-image', namespace: 'ecosystem-appeng' }]);
    render(ImageCatalog);
    await waitFor(() => expect(screen.getByText(/custom-image/)).toBeTruthy());
    await fireEvent.click(screen.getByText('Curated'));
    await fireEvent.input(screen.getByLabelText('Curated repository patterns'), { target: { value: 'custom-*' } });
    await fireEvent.click(screen.getByText('Save curated patterns'));
    await waitFor(() => {
      expect(mockSetCatalogRegistriesJson).toHaveBeenCalledWith(
        expect.stringContaining('"curatedAllowlist":"custom-*"'),
      );
      expect(screen.getByText('Saved for this registry.')).toBeTruthy();
    });
  });

  it('clears stale results when namespace is emptied', async () => {
    mockListCatalogImages.mockResolvedValue([{ name: 'ros2-base', namespace: 'ecosystem-appeng' }]);
    render(ImageCatalog);
    await waitFor(() => {
      expect(screen.getByText(/ros2-base/)).toBeTruthy();
    });
    const input = screen.getByLabelText('Quay.io namespace') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '' } });
    await waitFor(() => {
      expect(screen.queryByText(/ros2-base/)).toBeNull();
      expect(screen.getByText(/Namespace is required/)).toBeTruthy();
      expect(screen.queryByText(/Click Load to browse/)).toBeNull();
    });
  });

  it('prompts to click Load when a namespace is entered but not loaded', async () => {
    mockListCatalogImages.mockResolvedValue([]);
    render(ImageCatalog);
    await waitFor(() => {
      expect(screen.getByLabelText('Quay.io namespace')).toBeTruthy();
    });
    const input = screen.getByLabelText('Quay.io namespace') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'a' } });
    await waitFor(() => {
      expect(screen.queryByText(/Namespace is required/)).toBeNull();
      expect(screen.getByText(/Click Load to browse images for this namespace/)).toBeTruthy();
    });
  });
});
