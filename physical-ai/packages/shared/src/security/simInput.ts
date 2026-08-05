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
export const GAZEBO_ENTRYPOINT = '/entrypoint-gazebo.sh';

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

/** Env keys the gazebo entrypoint may honor from the client. */
export const ALLOWED_LAUNCH_ENV_KEYS = new Set([
  'ROBOTS',
  'WORLD_NAME',
  'WEB_PORT',
  'VNC_PORT',
  'NOVNC_PORT',
  'DISPLAY_NUM',
  'RESOLUTION',
  'TURTLEBOT3_MODEL',
]);

const WORLD_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const RESOLUTION_RE = /^\d{2,5}x\d{2,5}$/;
const PORT_ENV_RE = /^\d{1,5}$/;
const CONTAINER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
const LABEL_KEY_RE = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?(\/[a-z0-9]([a-z0-9._-]*[a-z0-9])?)*$/i;
const LABEL_VALUE_RE = /^[\x20-\x7e]{0,4096}$/;

function assertPortEnv(value: string, label: string): string {
  if (!PORT_ENV_RE.test(value)) {
    throw new Error(`Invalid ${label}: must be a port number.`);
  }
  const n = Number(value);
  if (n < 1 || n > 65535) {
    throw new Error(`Invalid ${label}: must be between 1 and 65535.`);
  }
  return value;
}

/** ROBOTS=name:x:y:yaw[,name:x:y:yaw...] — same shape as entrypoint validation. */
export function assertRobotsEnv(value: string): string {
  if (!value.trim()) {
    throw new Error('ROBOTS env must not be empty.');
  }
  for (const entry of value.split(',')) {
    const parts = entry.split(':');
    if (parts.length !== 4) {
      throw new Error(`Invalid ROBOTS entry "${entry}". Expected name:x:y:yaw.`);
    }
    assertRobotName(parts[0]);
    assertNumericArg(parts[1], 'x');
    assertNumericArg(parts[2], 'y');
    assertNumericArg(parts[3], 'yaw');
  }
  return value;
}

/**
 * Filters client env to allowlisted keys with validated values.
 * Rejects PATH, LD_PRELOAD, and other injection vectors.
 */
export function assertLaunchEnv(env: Record<string, string> | undefined): Record<string, string> {
  if (!env || Object.keys(env).length === 0) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!ALLOWED_LAUNCH_ENV_KEYS.has(key)) {
      throw new Error(`Env key "${key}" is not allowed for launchSimulation.`);
    }
    if (typeof value !== 'string') {
      throw new Error(`Env value for "${key}" must be a string.`);
    }
    switch (key) {
      case 'ROBOTS':
        out[key] = assertRobotsEnv(value);
        break;
      case 'WORLD_NAME':
        if (!WORLD_NAME_RE.test(value)) {
          throw new Error(`Invalid WORLD_NAME "${value}".`);
        }
        out[key] = value;
        break;
      case 'WEB_PORT':
      case 'VNC_PORT':
      case 'NOVNC_PORT':
      case 'DISPLAY_NUM':
        out[key] = assertPortEnv(value, key);
        break;
      case 'RESOLUTION':
        if (!RESOLUTION_RE.test(value)) {
          throw new Error(`Invalid RESOLUTION "${value}". Use WxH (e.g. 1280x720).`);
        }
        out[key] = value;
        break;
      case 'TURTLEBOT3_MODEL':
        if (value !== 'burger' && value !== 'waffle' && value !== 'waffle_pi') {
          throw new Error(`Invalid TURTLEBOT3_MODEL "${value}".`);
        }
        out[key] = value;
        break;
      default:
        throw new Error(`Env key "${key}" is not allowed for launchSimulation.`);
    }
  }
  return out;
}

/** Client Cmd is not honored; only the gazebo entrypoint is allowed. */
export function assertLaunchCmd(cmd: string[] | undefined): string[] {
  if (cmd === undefined) {
    return [GAZEBO_ENTRYPOINT];
  }
  if (cmd.length === 1 && cmd[0] === GAZEBO_ENTRYPOINT) {
    return [GAZEBO_ENTRYPOINT];
  }
  throw new Error(`launchSimulation only allows Cmd [${GAZEBO_ENTRYPOINT}].`);
}

export function assertContainerName(name: string): string {
  if (!CONTAINER_NAME_RE.test(name)) {
    throw new Error(
      `Invalid container name "${name}". Use letters, digits, underscore, hyphen, period (max 64).`,
    );
  }
  return name;
}

export function assertLaunchLabels(
  labels: Record<string, string> | undefined,
): Record<string, string> {
  if (!labels || Object.keys(labels).length === 0) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (!LABEL_KEY_RE.test(key) || key.length > 128) {
      throw new Error(`Invalid label key "${key}".`);
    }
    if (typeof value !== 'string' || !LABEL_VALUE_RE.test(value)) {
      throw new Error(`Invalid label value for "${key}".`);
    }
    out[key] = value;
  }
  return out;
}

export function assertPortMappings(
  mappings: Array<{ hostPort: number; containerPort: number; protocol?: string }> | undefined,
): Array<{ hostPort: number; containerPort: number; protocol: string }> | undefined {
  if (mappings === undefined) {
    return undefined;
  }
  return mappings.map((p, i) => {
    const hostPort = Number(p.hostPort);
    const containerPort = Number(p.containerPort);
    if (!Number.isInteger(hostPort) || hostPort < 1 || hostPort > 65535) {
      throw new Error(`Invalid hostPort at index ${i}.`);
    }
    if (!Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65535) {
      throw new Error(`Invalid containerPort at index ${i}.`);
    }
    const protocol = (p.protocol ?? 'tcp').toLowerCase();
    if (protocol !== 'tcp' && protocol !== 'udp') {
      throw new Error(`Invalid protocol at index ${i}: use tcp or udp.`);
    }
    return { hostPort, containerPort, protocol };
  });
}

/** Ports openSimulationInBrowser may open (noVNC + landing page). */
export const ALLOWED_BROWSER_PORTS = new Set([6080, 8080]);

export function assertBrowserPort(port: number): number {
  const n = Number(port);
  if (!Number.isInteger(n) || !ALLOWED_BROWSER_PORTS.has(n)) {
    throw new Error(
      `Port ${port} is not allowed. openSimulationInBrowser only opens ${[...ALLOWED_BROWSER_PORTS].join(' or ')}.`,
    );
  }
  return n;
}
