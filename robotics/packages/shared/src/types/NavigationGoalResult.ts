export interface NavigationGoalResult {
  status: 'accepted' | 'navigating' | 'reached' | 'failed' | 'rejected';
  message: string;
}

/**
 * Nav2 pre-warm state for a spawned robot, surfaced so the UI can show honest
 * progress ("Nav2 warming…") if the user clicks Navigate before the background
 * pre-warm has finished bringing the stack up.
 * - `idle`: no pre-warm tracked (e.g. custom image, or entry cleared)
 * - `warming`: pre-warm launched Nav2 and is waiting for it to become ready
 * - `ready`: map→base_link TF is up and bt_navigator is active
 * - `failed`: pre-warm gave up; the next Navigate pays the cold-start itself
 */
export type Nav2WarmStatus = 'idle' | 'warming' | 'ready' | 'failed';

/** Backend-measured pre-warm duration, independent of frontend polling or remounts. */
export interface Nav2WarmState {
  status: Nav2WarmStatus;
  /** Present once tracked pre-warm completes or fails; absent for untracked robots. */
  elapsedMs?: number;
}
