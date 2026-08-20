import type { Nav2WarmStatus } from '/@shared/src/types/NavigationGoalResult';

export type RobotEntry = {
  name: string;
  x: string;
  y: string;
  navStatus: 'idle' | 'navigating' | 'reached' | 'failed';
  navTarget: { x: string; y: string };
  navReached: { x: string; y: string } | null;
  /** Nav2 pre-warm state, polled by the parent; drives the "warming…/ready" badge. */
  warmStatus?: Nav2WarmStatus;
};
