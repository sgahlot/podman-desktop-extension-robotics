import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Dashboard from './Dashboard.svelte';

const mockGetStatus = vi.fn();
const mockGoto = vi.fn();

vi.mock('./api/client', () => ({
  physicalAiClient: {
    getStatus: (...args: any[]) => mockGetStatus(...args),
  },
}));

vi.mock('tinro', () => ({
  router: { goto: (...args: any[]) => mockGoto(...args) },
}));

describe('Dashboard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetStatus.mockResolvedValue('Physical AI extension is running');
  });

  it('renders heading', () => {
    render(Dashboard);
    expect(screen.getByText('Physical AI')).toBeTruthy();
  });

  it('renders quick link cards', () => {
    render(Dashboard);
    expect(screen.getByText('Image Catalog')).toBeTruthy();
    expect(screen.getByText('Simulation')).toBeTruthy();
    expect(screen.getByText('Fleet')).toBeTruthy();
    expect(screen.getByText('Build & Push Base Image')).toBeTruthy();
    expect(screen.getByText('Help')).toBeTruthy();
  });

  it('shows status after loading', async () => {
    render(Dashboard);
    const statusEl = await screen.findByText(/Physical AI extension is running/);
    expect(statusEl).toBeTruthy();
  });

  it('shows error status when backend is unreachable', async () => {
    mockGetStatus.mockRejectedValue(new Error('connection refused'));
    render(Dashboard);
    const statusEl = await screen.findByText(/Unable to connect to backend/);
    expect(statusEl).toBeTruthy();
  });

  it('navigates to Image Catalog on click', async () => {
    render(Dashboard);
    const btn = screen.getByText('Image Catalog');
    await fireEvent.click(btn);
    expect(mockGoto).toHaveBeenCalledWith('/images');
  });

  it('navigates to Build & Push on click', async () => {
    render(Dashboard);
    const btn = screen.getByText('Build & Push Base Image');
    await fireEvent.click(btn);
    expect(mockGoto).toHaveBeenCalledWith('/build');
  });

  it('navigates to Help on click', async () => {
    render(Dashboard);
    const btn = screen.getByText('Help');
    await fireEvent.click(btn);
    expect(mockGoto).toHaveBeenCalledWith('/help');
  });

  it('marks Simulation and Fleet as coming soon', () => {
    render(Dashboard);
    const comingSoon = screen.getAllByText('Coming soon');
    expect(comingSoon).toHaveLength(2);
  });
});
