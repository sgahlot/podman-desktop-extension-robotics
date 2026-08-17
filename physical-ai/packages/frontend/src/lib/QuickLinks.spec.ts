import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import QuickLinks from './QuickLinks.svelte';

const mockGoto = vi.fn();
vi.mock('tinro', () => ({
  router: { goto: (...args: unknown[]) => mockGoto(...args) },
}));

describe('QuickLinks', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders a chip per link', () => {
    render(QuickLinks, {
      links: [
        { label: 'Image Builder', to: '/build' },
        { label: 'Topic Monitor', to: '/topics' },
      ],
    });
    expect(screen.getByText('Image Builder')).toBeTruthy();
    expect(screen.getByText('Topic Monitor')).toBeTruthy();
    expect(screen.getByText('Quick Links:')).toBeTruthy();
  });

  it('navigates to the target route on click', async () => {
    render(QuickLinks, { links: [{ label: 'Image Builder', to: '/build' }] });
    await fireEvent.click(screen.getByText('Image Builder'));
    expect(mockGoto).toHaveBeenCalledWith('/build');
  });

  it('renders nothing when there are no links', () => {
    render(QuickLinks, { links: [] });
    expect(screen.queryByText('Quick Links:')).toBeNull();
  });
});
