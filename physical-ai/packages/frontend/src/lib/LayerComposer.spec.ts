import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import LayerComposer from './LayerComposer.svelte';

describe('LayerComposer', () => {
  it('renders all 4 picker labels and opens with the success banner (known-good default)', () => {
    render(LayerComposer);
    expect(screen.getByLabelText('Base OS')).toBeTruthy();
    expect(screen.getByLabelText('Hardened app')).toBeTruthy();
    expect(screen.getByLabelText('ROS')).toBeTruthy();
    expect(screen.getByLabelText('Simulation')).toBeTruthy();

    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain('Ready — builds and runs today');
  });

  it('selecting a bootc base with ROS produces the error banner text and disables the Build button', async () => {
    render(LayerComposer);
    const baseOsSelect = screen.getByLabelText('Base OS');
    await fireEvent.change(baseOsSelect, { target: { value: 'centos-bootc-stream9' } });

    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain("Won't build");
    expect(banner.textContent).toContain('ROS install step');

    const buildButton = screen.getByRole('button', { name: 'Build image' });
    expect((buildButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('checking "Attempt anyway" re-enables the Build button while blocked', async () => {
    render(LayerComposer);
    const baseOsSelect = screen.getByLabelText('Base OS');
    await fireEvent.change(baseOsSelect, { target: { value: 'centos-bootc-stream9' } });

    const buildButton = screen.getByRole('button', { name: 'Build image' }) as HTMLButtonElement;
    expect(buildButton.disabled).toBe(true);

    const attemptAnyway = screen.getByLabelText("Attempt anyway — I understand this won't build");
    await fireEvent.click(attemptAnyway);

    expect(buildButton.disabled).toBe(false);
  });

  it('the Containerfile preview reflects a selection change', async () => {
    render(LayerComposer);
    const baseOsSelect = screen.getByLabelText('Base OS');
    await fireEvent.change(baseOsSelect, { target: { value: 'centos-bootc-stream9' } });

    expect(document.body.textContent).toContain('quay.io/centos-bootc/centos-bootc:stream9');
  });
});
