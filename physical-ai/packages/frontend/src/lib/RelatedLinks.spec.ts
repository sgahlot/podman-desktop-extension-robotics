import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import RelatedLinks from './RelatedLinks.svelte';

const mockGoto = vi.fn();
vi.mock('tinro', () => ({
  router: { goto: (...args: unknown[]) => mockGoto(...args) },
}));

describe('RelatedLinks', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders a button per link', () => {
    render(RelatedLinks, {
      links: [
        { label: 'Image Builder', to: '/build' },
        { label: 'Topic Monitor', to: '/topics' },
      ],
    });
    expect(screen.getByText(/Image Builder/)).toBeTruthy();
    expect(screen.getByText(/Topic Monitor/)).toBeTruthy();
    expect(screen.getByText('Related:')).toBeTruthy();
  });

  it('navigates to the target route on click', async () => {
    render(RelatedLinks, { links: [{ label: 'Image Builder', to: '/build' }] });
    await fireEvent.click(screen.getByText(/Image Builder/));
    expect(mockGoto).toHaveBeenCalledWith('/build');
  });

  it('renders nothing when there are no links', () => {
    render(RelatedLinks, { links: [] });
    expect(screen.queryByText('Related:')).toBeNull();
  });
});
