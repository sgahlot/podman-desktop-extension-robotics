/**
 * Allowlists and validators for values that reach container shells / argv.
 * Backend must enforce; frontend may use the same patterns for early UX.
 *
 * Keep regexes in sync with:
 * packages/backend/assets/ros2-jazzy-sim/lib/validate-input.sh
 */

/** Robot names used in spawn / nav (ROS namespace / Gazebo model). */
export const ROBOT_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

/** ROS 2 topic names (absolute, simple path segments). */
export const ROS_TOPIC_NAME_RE = /^(\/[a-zA-Z][a-zA-Z0-9_]*)+$/;

export type SupportedRosDistro = 'humble' | 'jazzy';

export function assertRobotName(name: string): string {
  if (!ROBOT_NAME_RE.test(name)) {
    throw new Error(
      `Invalid robot name "${name}". Use letters, digits, underscore, hyphen (max 64, must start with a letter).`,
    );
  }
  return name;
}

export function assertRosTopicName(name: string): string {
  if (!ROS_TOPIC_NAME_RE.test(name)) {
    throw new Error(`Invalid ROS topic name "${name}".`);
  }
  return name;
}

export function assertRosDistro(distro: string): SupportedRosDistro {
  if (distro === 'humble' || distro === 'jazzy') {
    return distro;
  }
  throw new Error(`Unsupported ROS distro "${distro}".`);
}

/** Numeric pose / duration strings for spawn argv (no shell metacharacters). */
export function assertNumericArg(value: string, label: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(value)) {
    throw new Error(`Invalid ${label}: must be a number.`);
  }
  return value;
}

export const SPAWN_ENTRYPOINT = '/entrypoint-spawn-robot.sh';

/**
 * Validates execInSimulation argv: only spawn entrypoint + name + x + y + yaw.
 */
export function assertSpawnExecCommand(command: string[]): string[] {
  if (command[0] !== SPAWN_ENTRYPOINT) {
    throw new Error(`Only ${SPAWN_ENTRYPOINT} is allowed via execInSimulation.`);
  }
  if (command.length !== 5) {
    throw new Error('Spawn requires exactly: entrypoint, robot_name, x, y, yaw.');
  }
  return [
    SPAWN_ENTRYPOINT,
    assertRobotName(command[1]),
    assertNumericArg(command[2], 'x'),
    assertNumericArg(command[3], 'y'),
    assertNumericArg(command[4], 'yaw'),
  ];
}
