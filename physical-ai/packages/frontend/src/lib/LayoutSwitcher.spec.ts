import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import LayoutSwitcher from './LayoutSwitcher.svelte';

describe('LayoutSwitcher', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders the three layout options', () => {
    render(LayoutSwitcher, { value: 'sidebar', onSelect: vi.fn() });
    expect(screen.getByText('Sidebar')).toBeTruthy();
    expect(screen.getByText('Tabs')).toBeTruthy();
    expect(screen.getByText('Cards')).toBeTruthy();
  });

  it('marks the selected option as checked and others as unchecked', () => {
    render(LayoutSwitcher, { value: 'tabs', onSelect: vi.fn() });
    expect(screen.getByText('Sidebar').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Tabs').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Cards').getAttribute('aria-checked')).toBe('false');
  });

  it('calls onSelect with "sidebar" when Sidebar is clicked', async () => {
    const onSelect = vi.fn();
    render(LayoutSwitcher, { value: 'cards', onSelect });
    await fireEvent.click(screen.getByText('Sidebar'));
    expect(onSelect).toHaveBeenCalledWith('sidebar');
  });

  it('calls onSelect with "tabs" when Tabs is clicked', async () => {
    const onSelect = vi.fn();
    render(LayoutSwitcher, { value: 'cards', onSelect });
    await fireEvent.click(screen.getByText('Tabs'));
    expect(onSelect).toHaveBeenCalledWith('tabs');
  });

  it('calls onSelect with "cards" when Cards is clicked', async () => {
    const onSelect = vi.fn();
    render(LayoutSwitcher, { value: 'sidebar', onSelect });
    await fireEvent.click(screen.getByText('Cards'));
    expect(onSelect).toHaveBeenCalledWith('cards');
  });
});
