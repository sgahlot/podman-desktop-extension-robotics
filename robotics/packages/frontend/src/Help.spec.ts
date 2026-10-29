import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Help from './Help.svelte';

describe('Help', () => {
  it('renders heading', () => {
    render(Help);
    expect(screen.getByRole('heading', { level: 1, name: 'Help' })).toBeTruthy();
  });

  it('renders all documentation sections', () => {
    render(Help);
    expect(screen.getByText('Getting Started')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getAllByText('Image Catalog').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Image Builder').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Simulation').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Tips')).toBeTruthy();
    expect(screen.getByText('Coming Soon')).toBeTruthy();
    expect(screen.getByText('Golden Quay images')).toBeTruthy();
  });

  it('mentions key features in coming soon section', () => {
    render(Help);
    expect(screen.getByRole('heading', { name: 'Coming Soon' })).toBeTruthy();
    expect(screen.getByText(/Multi-robot local fleets with Zenoh/)).toBeTruthy();
  });

  it('renders Image Builder section', () => {
    render(Help);
    expect(screen.getAllByText('Image Builder').length).toBeGreaterThanOrEqual(1);
  });
});
