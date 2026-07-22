import { vi, describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Help from './Help.svelte';

const mockGoto = vi.fn();

vi.mock('tinro', () => ({
  router: { goto: (...args: any[]) => mockGoto(...args) },
}));

describe('Help', () => {
  it('renders heading', () => {
    render(Help);
    expect(screen.getByText('Help')).toBeTruthy();
  });

  it('renders all documentation sections', () => {
    render(Help);
    expect(screen.getByText('Getting Started')).toBeTruthy();
    expect(screen.getAllByText('Image Catalog').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Build & Push Base Image')).toBeTruthy();
    expect(screen.getByText('Tips')).toBeTruthy();
    expect(screen.getByText('Coming Soon')).toBeTruthy();
  });

  it('navigates back to dashboard on click', async () => {
    render(Help);
    const backBtn = screen.getByText(/Back to Dashboard/);
    await fireEvent.click(backBtn);
    expect(mockGoto).toHaveBeenCalledWith('/');
  });

  it('mentions key features in coming soon section', () => {
    render(Help);
    expect(screen.getByText('Coming Soon')).toBeTruthy();
    expect(screen.getByText(/OpenShift Bridge/)).toBeTruthy();
  });

  it('renders Simulation Setup section', () => {
    render(Help);
    expect(screen.getByText('Simulation Setup')).toBeTruthy();
  });
});
