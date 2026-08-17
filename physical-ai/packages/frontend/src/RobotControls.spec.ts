import { vi, describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import RobotControls, { type RobotEntry } from './RobotControls.svelte';

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

  it('shows the Nav2 warm-status badge while warming and when ready', () => {
    const { rerender } = render(RobotControls, {
      robots: [robot('robot_1', { warmStatus: 'warming' })],
      onSpawn: vi.fn(),
      onNavigate: vi.fn(),
      onRemove: vi.fn(),
    });
    expect(screen.getByText('Nav2 warming…')).toBeTruthy();

    rerender({
      robots: [robot('robot_1', { warmStatus: 'ready' })],
      onSpawn: vi.fn(),
      onNavigate: vi.fn(),
      onRemove: vi.fn(),
    });
    expect(screen.getByText('Nav2 ready')).toBeTruthy();
  });

  it('shows "Waiting for Nav2…" when navigating during warm-up', () => {
    render(RobotControls, {
      robots: [robot('robot_1', { navStatus: 'navigating', warmStatus: 'warming' })],
      onSpawn: vi.fn(),
      onNavigate: vi.fn(),
      onRemove: vi.fn(),
    });
    expect(screen.getByText('Waiting for Nav2…')).toBeTruthy();
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
