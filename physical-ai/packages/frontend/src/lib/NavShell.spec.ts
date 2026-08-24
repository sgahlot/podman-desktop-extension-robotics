import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import NavShell from './NavShell.svelte';

const mockGoto = vi.fn();
let currentPath = '/';
vi.mock('tinro', () => ({
  router: {
    goto: (...args: unknown[]) => mockGoto(...args),
    subscribe: (run: (r: { path: string; url: string }) => void) => {
      run({ path: currentPath, url: currentPath });
      return () => {};
    },
  },
}));

describe('NavShell', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    currentPath = '/';
  });

  it('renders all 7 nav labels in sidebar layout', () => {
    render(NavShell, { layout: 'sidebar', onLayoutChange: vi.fn() });
    for (const label of ['Home', 'Image Builder', 'Image Catalog', 'Simulation', 'Topic Monitor', 'Fleet', 'Help']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('renders all 7 nav labels + a tablist in tabs layout', () => {
    render(NavShell, { layout: 'tabs', onLayoutChange: vi.fn() });
    for (const label of ['Home', 'Image Builder', 'Image Catalog', 'Simulation', 'Topic Monitor', 'Fleet', 'Help']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByRole('tablist')).toBeTruthy();
  });

  it('renders no chrome in cards layout', () => {
    render(NavShell, { layout: 'cards', onLayoutChange: vi.fn() });
    expect(screen.queryByText('Fleet')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('navigates to /build when Image Builder is clicked in sidebar layout', async () => {
    render(NavShell, { layout: 'sidebar', onLayoutChange: vi.fn() });
    await fireEvent.click(screen.getByText('Image Builder'));
    expect(mockGoto).toHaveBeenCalledWith('/build');
  });

  it('marks the active sidebar item with aria-current="page"', () => {
    currentPath = '/build';
    render(NavShell, { layout: 'sidebar', onLayoutChange: vi.fn() });
    const item = screen.getByText('Image Builder');
    expect(item.getAttribute('aria-current')).toBe('page');
  });

  it('marks Fleet as aria-disabled and does not navigate on click', async () => {
    render(NavShell, { layout: 'sidebar', onLayoutChange: vi.fn() });
    const fleet = screen.getByText('Fleet');
    expect(fleet.closest('[aria-disabled="true"]')).toBeTruthy();
    await fireEvent.click(fleet);
    expect(mockGoto).not.toHaveBeenCalled();
  });

  it('calls onLayoutChange with "tabs" when the Tabs switcher option is clicked', async () => {
    const onLayoutChange = vi.fn();
    render(NavShell, { layout: 'sidebar', onLayoutChange });
    await fireEvent.click(screen.getByText('Tabs'));
    expect(onLayoutChange).toHaveBeenCalledWith('tabs');
  });
});
