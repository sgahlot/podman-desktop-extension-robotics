import { vi, describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import RobotControls from './RobotControls.svelte';
import type { RobotEntry } from './RobotControls.types';

function robot(name: string, over: Partial<RobotEntry> = {}): RobotEntry {
  return {
    name,
    x: '0',
    y: '0',
    navStatus: 'idle',
    navTarget: { x: '2.0', y: '0.5' },
    navReached: null,
    ...over,
  };
}

describe('RobotControls', () => {
  it('spawns with the form values then suggests the next free name', async () => {
    const onSpawn = vi.fn().mockResolvedValue(undefined);
    render(RobotControls, { robots: [], onSpawn, onNavigate: vi.fn(), onRemove: vi.fn() });

    await fireEvent.click(screen.getByRole('button', { name: 'Spawn' }));

    await waitFor(() => {
      expect(onSpawn).toHaveBeenCalledWith({ name: 'robot_1', x: '-2.0', y: '-0.5', yaw: '0.0' });
    });
    // Name field advances to the next free robot_N.
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('robot_2');
  });

  it('skips names already taken when suggesting the next name', async () => {
    const onSpawn = vi.fn().mockResolvedValue(undefined);
    render(RobotControls, { robots: [robot('robot_2')], onSpawn, onNavigate: vi.fn(), onRemove: vi.fn() });

    await fireEvent.click(screen.getByRole('button', { name: 'Spawn' }));

    await waitFor(() => {
      expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('robot_3');
    });
  });

  it('blocks a duplicate name without calling onSpawn', async () => {
    const onSpawn = vi.fn().mockResolvedValue(undefined);
    render(RobotControls, { robots: [robot('robot_1')], onSpawn, onNavigate: vi.fn(), onRemove: vi.fn() });

    await fireEvent.click(screen.getByRole('button', { name: 'Spawn' }));

    expect(await screen.findByText(/already exists/)).toBeTruthy();
    expect(onSpawn).not.toHaveBeenCalled();
  });

  it('surfaces spawn errors from onSpawn', async () => {
    const onSpawn = vi.fn().mockRejectedValue(new Error('spawn boom'));
    render(RobotControls, { robots: [], onSpawn, onNavigate: vi.fn(), onRemove: vi.fn() });

    await fireEvent.click(screen.getByRole('button', { name: 'Spawn' }));

    expect(await screen.findByText('spawn boom')).toBeTruthy();
  });

  it('navigates and removes a listed robot by index', async () => {
    const onNavigate = vi.fn().mockResolvedValue(undefined);
    const onRemove = vi.fn().mockResolvedValue(undefined);
    render(RobotControls, {
      robots: [robot('robot_1'), robot('robot_2')],
      onSpawn: vi.fn(),
      onNavigate,
      onRemove,
    });

    const navButtons = screen.getAllByRole('button', { name: 'Navigate' });
    await fireEvent.click(navButtons[1]);
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(1));

    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    await fireEvent.click(removeButtons[0]);
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith(0));
  });

  it('hides the nav controls while warming, then reveals them when ready', () => {
    const { rerender } = render(RobotControls, {
      robots: [robot('robot_1', { warmStatus: 'warming' })],
      onSpawn: vi.fn(),
      onNavigate: vi.fn(),
      onRemove: vi.fn(),
    });
    // Warming: the indicator is shown and Remove stays available (so a robot stuck
    // warming can be reaped), but Navigate + target inputs are hidden.
    expect(screen.getByText('Nav2 warming…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Navigate' })).toBeNull();
    expect(screen.queryByLabelText('target X for robot_1')).toBeNull();

    // Ready: controls appear, and there's no leftover "ready" badge text.
    rerender({
      robots: [robot('robot_1', { warmStatus: 'ready' })],
      onSpawn: vi.fn(),
      onNavigate: vi.fn(),
      onRemove: vi.fn(),
    });
    expect(screen.getByRole('button', { name: 'Navigate' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
    expect(screen.queryByText('Nav2 ready')).toBeNull();
    expect(screen.queryByText('Nav2 warming…')).toBeNull();
  });

  it('keeps the nav controls available when pre-warm failed', () => {
    render(RobotControls, {
      robots: [robot('robot_1', { warmStatus: 'failed' })],
      onSpawn: vi.fn(),
      onNavigate: vi.fn(),
      onRemove: vi.fn(),
    });
    expect(screen.getByText('Nav2 warm-up failed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Navigate' })).toBeTruthy();
  });

  it('uses the custom spawn label', () => {
    render(RobotControls, {
      robots: [],
      onSpawn: vi.fn(),
      onNavigate: vi.fn(),
      onRemove: vi.fn(),
      spawnLabel: 'Add TurtleBot3',
    });
    expect(screen.getByRole('button', { name: 'Add TurtleBot3' })).toBeTruthy();
  });
});
