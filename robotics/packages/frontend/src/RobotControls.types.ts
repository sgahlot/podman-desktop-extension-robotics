import type { Nav2WarmStatus } from '/@shared/src/types/NavigationGoalResult';

export type RobotEntry = {
  name: string;
  /** Spawn coordinates. Omitted for robots discovered via reconciliation (S8-17) — their
   * position isn't recoverable from `ros2 node list`, so the row shows just the name. */
  x?: string;
  y?: string;
  yaw?: string;
  /** The image-provided launch owns placement (for example an SDF <pose>). */
  positionManagedByProfile?: boolean;
  /** Static/profile-defined entities do not create a ROS node for liveness reconciliation. */
  livenessManagedByProfile?: boolean;
  navStatus: 'idle' | 'navigating' | 'reached' | 'failed';
  navTarget: { x: string; y: string };
  navReached: { x: string; y: string } | null;
  /** Nav2 pre-warm state, polled by the parent; drives the "warming…/ready" badge. */
  warmStatus?: Nav2WarmStatus;
  supportsNavigation: boolean;
};
