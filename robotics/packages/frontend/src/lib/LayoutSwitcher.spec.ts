import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import LayoutSwitcher from './LayoutSwitcher.svelte';

describe('LayoutSwitcher', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders the two supported layout options', () => {
    render(LayoutSwitcher, { value: 'sidebar', onSelect: vi.fn() });
    expect(screen.getByText('Sidebar')).toBeTruthy();
    expect(screen.getByText('Tabs')).toBeTruthy();
  });

  it('marks the selected option as checked and others as unchecked', () => {
    render(LayoutSwitcher, { value: 'tabs', onSelect: vi.fn() });
    expect(screen.getByText('Sidebar').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Tabs').getAttribute('aria-checked')).toBe('true');
  });

  it('calls onSelect with "sidebar" when Sidebar is clicked', async () => {
    const onSelect = vi.fn();
    render(LayoutSwitcher, { value: 'tabs', onSelect });
    await fireEvent.click(screen.getByText('Sidebar'));
    expect(onSelect).toHaveBeenCalledWith('sidebar');
  });

  it('calls onSelect with "tabs" when Tabs is clicked', async () => {
    const onSelect = vi.fn();
    render(LayoutSwitcher, { value: 'sidebar', onSelect });
    await fireEvent.click(screen.getByText('Tabs'));
    expect(onSelect).toHaveBeenCalledWith('tabs');
  });
});
