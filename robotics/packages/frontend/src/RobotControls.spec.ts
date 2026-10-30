import { vi, describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import RobotControls from './RobotControls.svelte';
import type { RobotEntry } from './RobotControls.types';

function robot(name: string, over: Partial<RobotEntry> = {}): RobotEntry {
  return {
    name,
    x: '0',
    y: '0',
    navStatus: 'idle',
    navTarget: { x: '2.0', y: '0.5' },
    // eslint-disable-next-line no-null/no-null -- matches RobotEntry's declared `| null` contract
    navReached: null,
    supportsNavigation: true,
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

    // The pre-filled name auto-corrects away from the taken robot_1 (to robot_2); to hit the
    // spawn-time duplicate guard the user has to type a colliding name themselves, which also
    // marks the field as user-edited so the auto-suggestion no longer overrides it.
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'robot_1' } });
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

  it('hides the nav controls while warming, then reveals them when ready', async () => {
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
    await rerender({
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

  it('keeps an idle robot name and navigation on one row when no extra details are displayed', () => {
    render(RobotControls, {
      robots: [robot('robot_1', { x: undefined, y: undefined, warmStatus: 'ready' })],
      onSpawn: vi.fn(),
      onNavigate: vi.fn(),
      onRemove: vi.fn(),
      onDiagnose: vi.fn(),
    });

    const identity = screen.getByText('robot_1').parentElement;
    const navigation = screen.getByRole('group', { name: 'Navigation target for robot_1' }).parentElement;
    const card = identity?.parentElement;
    expect(navigation).toBe(identity);
    expect(navigation?.classList.contains('flex-nowrap')).toBe(true);
    expect(within(navigation as HTMLElement).getByText('Idle')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Actions for robot_1' }).parentElement).toBe(card);
    expect(card?.children).toHaveLength(2);
  });

  it.each<Partial<RobotEntry>>([
    { x: '0', y: '0' },
    { warmStatus: 'ready', warmElapsedMs: 22_100 },
    { warmStatus: 'failed' },
    { navStatus: 'navigating' },
    { navStatus: 'reached' },
    { navStatus: 'failed' },
  ])('keeps identity and navigation together with extra details below: %j', details => {
    render(RobotControls, {
      robots: [robot('robot_1', { x: undefined, y: undefined, ...details })],
      onSpawn: vi.fn(),
      onNavigate: vi.fn(),
      onRemove: vi.fn(),
    });

    const card = screen.getByText('robot_1').parentElement?.parentElement;
    const header = screen.getByText('robot_1').parentElement;
    const controls = screen.getByRole('group', { name: 'Navigation target for robot_1' });
    expect(controls.parentElement).toBe(header);
    expect(header?.classList.contains('flex-nowrap')).toBe(true);
    expect(card?.children.length).toBeGreaterThan(2);
    if (details.navStatus) {
      const result = screen.getByText(
        details.navStatus === 'navigating'
          ? 'Navigating…'
          : details.navStatus === 'reached'
            ? 'Reached'
            : /Navigate failed/,
      );
      expect(result.parentElement).toBe(card);
      expect(header?.contains(result)).toBe(false);
    }
  });

  it.each(['reached', 'failed'] as const)(
    'constrains a long %s result without splitting controls or actions',
    navStatus => {
      render(RobotControls, {
        robots: [
          robot('robot_1', {
            warmStatus: 'ready',
            warmElapsedMs: 22_100,
            navStatus,
            navReached: { x: '123456789.123456789', y: '-987654321.987654321' },
            navElapsedMs: 292_800,
          }),
        ],
        onSpawn: vi.fn(),
        onNavigate: vi.fn(),
        onRemove: vi.fn(),
        onDiagnose: vi.fn(),
      });

      const controls = screen.getByRole('group', { name: 'Navigation target for robot_1' });
      expect(within(controls).getByLabelText('target X for robot_1')).toBeTruthy();
      expect(within(controls).getByLabelText('target Y for robot_1')).toBeTruthy();
      expect(within(controls).getByRole('button', { name: 'Navigate' })).toBeTruthy();
      expect(controls.classList.contains('flex-nowrap')).toBe(true);

      const resultText =
        navStatus === 'reached'
          ? 'Reached (123456789.123456789, -987654321.987654321) — Navigate took 4m 52.8s'
          : 'Navigate failed after 4m 52.8s to (123456789.123456789, -987654321.987654321)';
      const result = screen.getByText(resultText);
      expect(result.getAttribute('title')).toBe(resultText);
      expect(result.classList.contains('truncate')).toBe(true);
      expect(controls.parentElement).toBe(screen.getByText('robot_1').parentElement);
      expect(result.parentElement).toBe(controls.parentElement?.parentElement);
      expect(controls.parentElement?.contains(result)).toBe(false);

      const actions = screen.getByRole('group', { name: 'Actions for robot_1' });
      expect(within(actions).getByRole('button', { name: 'Remove' })).toBeTruthy();
      expect(within(actions).getByRole('button', { name: 'Diagnose' })).toBeTruthy();
      expect(actions.parentElement).toBe(controls.parentElement?.parentElement);
      expect(actions.contains(result)).toBe(false);
      expect(screen.queryByText(/Nav2 warmed in/)).toBeNull();
      expect(screen.queryByText(/spawned at/)).toBeNull();
      expect(actions.parentElement?.children).toHaveLength(3);
    },
  );

  it('hides startup details when navigation starts and keeps them hidden after completion', async () => {
    const initialRobot = robot('robot_1', { warmStatus: 'ready', warmElapsedMs: 29_700 });
    const callbacks = { onSpawn: vi.fn(), onNavigate: vi.fn(), onRemove: vi.fn(), onDiagnose: vi.fn() };
    const { rerender } = render(RobotControls, { robots: [initialRobot], ...callbacks });

    expect(screen.getByText(/spawned at/)).toBeTruthy();
    expect(screen.getByText('Nav2 warmed in 29.7s')).toBeTruthy();

    for (const navStatus of ['navigating', 'reached', 'failed'] as const) {
      await rerender({ robots: [{ ...initialRobot, navStatus }], ...callbacks });
      expect(screen.queryByText(/spawned at/)).toBeNull();
      expect(screen.queryByText(/Nav2 warmed in/)).toBeNull();
      const header = screen.getByText('robot_1').parentElement;
      expect(screen.getByRole('group', { name: 'Navigation target for robot_1' }).parentElement).toBe(header);
      expect(header?.parentElement?.children).toHaveLength(3);
    }
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

  it('hides the Diagnose button when onDiagnose is not supplied', () => {
    render(RobotControls, { robots: [robot('robot_1')], onSpawn: vi.fn(), onNavigate: vi.fn(), onRemove: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Diagnose' })).toBeNull();
  });

  it('calls onDiagnose with the robot index, even while warming', async () => {
    const onDiagnose = vi.fn();
    render(RobotControls, {
      robots: [robot('robot_1'), robot('robot_2', { warmStatus: 'warming' })],
      onSpawn: vi.fn(),
      onNavigate: vi.fn(),
      onRemove: vi.fn(),
      onDiagnose,
    });

    const diagnoseButtons = screen.getAllByRole('button', { name: 'Diagnose' });
    expect(diagnoseButtons).toHaveLength(2);

    await fireEvent.click(diagnoseButtons[1]);
    expect(onDiagnose).toHaveBeenCalledWith(1);
  });
});
