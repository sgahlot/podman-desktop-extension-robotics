import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Help from './Help.svelte';
import { navigationLayout } from './lib/navigationLayout';

const mockGoto = vi.fn();

vi.mock('tinro', () => ({
  router: { goto: (...args: unknown[]) => mockGoto(...args) },
}));

describe('Help', () => {
  beforeEach(() => {
    navigationLayout.set('sidebar');
  });

  it('renders heading', () => {
    render(Help);
    expect(screen.getByText('Help')).toBeTruthy();
  });

  it('renders all documentation sections', () => {
    render(Help);
    expect(screen.getByText('Getting Started')).toBeTruthy();
    expect(screen.getAllByText('Image Catalog').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Image Builder').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Simulation').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Tips')).toBeTruthy();
    expect(screen.getByText('Coming Soon')).toBeTruthy();
    expect(screen.getByText('Golden Quay images')).toBeTruthy();
  });

  it('navigates back to dashboard on click', async () => {
    navigationLayout.set('cards');
    render(Help);
    const backBtn = screen.getByText(/Back to Dashboard/);
    await fireEvent.click(backBtn);
    expect(mockGoto).toHaveBeenCalledWith('/');
  });

  it('hides the back-to-dashboard link when navigation layout is sidebar', () => {
    navigationLayout.set('sidebar');
    render(Help);
    expect(screen.queryByText(/Back to Dashboard/)).toBeNull();
  });

  it('mentions key features in coming soon section', () => {
    render(Help);
    expect(screen.getByText('Coming Soon')).toBeTruthy();
    expect(screen.getByText(/Fleet/)).toBeTruthy();
  });

  it('renders Image Builder section', () => {
    render(Help);
    expect(screen.getAllByText('Image Builder').length).toBeGreaterThanOrEqual(1);
  });
});
