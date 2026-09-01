import { vi, describe, it, expect, beforeEach } from 'vitest';
import { tick } from 'svelte';
import { render, screen, fireEvent } from '@testing-library/svelte';
import NavShell from './NavShell.svelte';

const mockGoto = vi.fn();
let currentPath = '/';
let mockEmit: ((r: { path: string; url: string }) => void) | undefined;
vi.mock('tinro', () => ({
  router: {
    goto: (...args: unknown[]) => mockGoto(...args),
    subscribe: (run: (r: { path: string; url: string }) => void) => {
      mockEmit = run;
      run({ path: currentPath, url: currentPath });
      return () => {
        mockEmit = undefined;
      };
    },
  },
}));

/** Simulate a route change after mount so we can assert the active highlight follows it. */
async function navigateTo(path: string): Promise<void> {
  currentPath = path;
  mockEmit?.({ path, url: path });
  await tick();
}

describe('NavShell', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    currentPath = '/';
    mockEmit = undefined;
  });

  it('renders all 8 nav labels in sidebar layout', () => {
    render(NavShell, { layout: 'sidebar', onLayoutChange: vi.fn() });
    for (const label of [
      'Dashboard',
      'Image Builder',
      'Image Catalog',
      'Simulation',
      'Topic Monitor',
      'Diagnostics',
      'Fleet',
      'Help',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('renders all 8 nav labels + a tablist in tabs layout', () => {
    render(NavShell, { layout: 'tabs', onLayoutChange: vi.fn() });
    for (const label of [
      'Dashboard',
      'Image Builder',
      'Image Catalog',
      'Simulation',
      'Topic Monitor',
      'Diagnostics',
      'Fleet',
      'Help',
    ]) {
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

  it('moves the active sidebar highlight when the route changes after mount', async () => {
    render(NavShell, { layout: 'sidebar', onLayoutChange: vi.fn() });
    expect(screen.getByText('Dashboard').getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('Help').getAttribute('aria-current')).toBeNull();

    await navigateTo('/help');

    expect(screen.getByText('Dashboard').getAttribute('aria-current')).toBeNull();
    expect(screen.getByText('Help').getAttribute('aria-current')).toBe('page');
  });

  it('moves the active tab highlight when the route changes after mount', async () => {
    render(NavShell, { layout: 'tabs', onLayoutChange: vi.fn() });
    expect(screen.getByText('Dashboard').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Topic Monitor').getAttribute('aria-selected')).toBe('false');

    await navigateTo('/topics');

    expect(screen.getByText('Dashboard').getAttribute('aria-selected')).toBe('false');
    expect(screen.getByText('Topic Monitor').getAttribute('aria-selected')).toBe('true');
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
