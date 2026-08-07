/** Max cleaned peek payload returned to the UI (LaserScan / Image can be huge). */
export const PEEK_MAX_BYTES = 64 * 1024;

/** Topic Monitor Peek wait bounds ( Preferences + backend enforce the same range ). */
export const PEEK_TIMEOUT_MIN_SEC = 1;
export const PEEK_TIMEOUT_MAX_SEC = 30;
export const PEEK_TIMEOUT_DEFAULT_SEC = 5;

/**
 * Validate peek timeout from settings. Throws a user-facing message when out of range.
 */
export function assertPeekTimeoutSeconds(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(
      `Topic peek timeout must be a whole number of seconds between ${PEEK_TIMEOUT_MIN_SEC} and ${PEEK_TIMEOUT_MAX_SEC} (got ${String(value)}).`,
    );
  }
  if (n < PEEK_TIMEOUT_MIN_SEC) {
    throw new Error(
      `Topic peek timeout must be at least ${PEEK_TIMEOUT_MIN_SEC} second` +
        (PEEK_TIMEOUT_MIN_SEC === 1 ? '' : 's') +
        ` (got ${n}). Change Preferences → Physical AI → Topic peek timeout.`,
    );
  }
  if (n > PEEK_TIMEOUT_MAX_SEC) {
    throw new Error(
      `Topic peek timeout must be at most ${PEEK_TIMEOUT_MAX_SEC} seconds (got ${n}). ` +
        `Change Preferences → Physical AI → Topic peek timeout.`,
    );
  }
  return n;
}

const LOST_MESSAGE_RE = /message was lost/i;
const TOTAL_COUNT_RE = /total count/i;
const SEPARATOR_RE = /^---+$/;

export interface CleanEchoResult {
  message: string;
  truncated: boolean;
  /** From header.stamp / clock when present (e.g. "sec=21039 nanosec=900000000"). */
  messageStamp?: string;
}

/**
 * Strip DDS QoS noise from `ros2 topic echo` stdout and normalize to a YAML body.
 */
export function cleanEchoOutput(raw: string): CleanEchoResult {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    if (LOST_MESSAGE_RE.test(line)) continue;
    if (TOTAL_COUNT_RE.test(line)) continue;
    if (SEPARATOR_RE.test(line.trim())) continue;
    kept.push(line);
  }

  let body = kept.join('\n').trim();
  let truncated = false;
  if (body.length > PEEK_MAX_BYTES) {
    body = body.slice(0, PEEK_MAX_BYTES) + '\n… (truncated)';
    truncated = true;
  }

  const messageStamp = extractMessageStamp(body);
  return { message: body, truncated, messageStamp };
}

/**
 * Surface ROS/sim time from common stamp shapes without a full YAML parse.
 */
export function extractMessageStamp(yaml: string): string | undefined {
  const stampBlock = yaml.match(
    /(?:^|\n)\s*(?:stamp|clock):\s*\n\s*sec:\s*(-?\d+)\s*\n\s*nanosec:\s*(\d+)/,
  );
  if (stampBlock) {
    return `sec=${stampBlock[1]} nanosec=${stampBlock[2]}`;
  }
  const inline = yaml.match(
    /(?:^|\n)\s*(?:stamp|clock):\s*\{\s*sec:\s*(-?\d+)\s*,\s*nanosec:\s*(\d+)\s*\}/,
  );
  if (inline) {
    return `sec=${inline[1]} nanosec=${inline[2]}`;
  }
  return undefined;
}

export interface YamlTreeNode {
  key: string;
  value?: string;
  children?: YamlTreeNode[];
}

/**
 * Lightweight indentation parser for typical `ros2 topic echo` YAML.
 * Falls back gracefully — callers should show Raw when this returns [].
 */
export function parseEchoYamlTree(yaml: string): YamlTreeNode[] {
  const lines = yaml
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];

  interface StackEntry {
    indent: number;
    children: YamlTreeNode[];
  }

  const root: YamlTreeNode[] = [];
  const stack: StackEntry[] = [{ indent: -1, children: root }];

  for (const rawLine of lines) {
    const indent = rawLine.match(/^ */)?.[0].length ?? 0;
    const line = rawLine.slice(indent);

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].children;

    let node: YamlTreeNode;
    if (line.startsWith('- ')) {
      const rest = line.slice(2).trim();
      const kv = rest.match(/^([^:]+):\s*(.*)$/);
      if (kv) {
        const child: YamlTreeNode =
          kv[2] === '' ? { key: kv[1].trim() } : { key: kv[1].trim(), value: kv[2] };
        node = { key: `[${parent.length}]`, children: [child] };
        parent.push(node);
        if (kv[2] === '') {
          stack.push({ indent, children: child.children ?? (child.children = []) });
        }
      } else {
        node = { key: `[${parent.length}]`, value: rest };
        parent.push(node);
      }
      continue;
    }

    const colon = line.indexOf(':');
    if (colon < 0) {
      node = { key: line.trim() };
      parent.push(node);
      continue;
    }

    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (value === '') {
      node = { key, children: [] };
      parent.push(node);
      stack.push({ indent, children: node.children! });
    } else {
      node = { key, value };
      parent.push(node);
    }
  }

  return root;
}

/** Short type label for badges: `geometry_msgs/msg/Twist` → `Twist`. */
export function shortMessageType(type: string): string {
  const parts = type.split('/');
  return parts[parts.length - 1] || type;
}

/** ROS 2 interface names passed to `ros2 interface show`. */
export const ROS_MESSAGE_TYPE_RE =
  /^[a-zA-Z][a-zA-Z0-9_]*\/(msg|srv|action)\/[A-Za-z][A-Za-z0-9_]*$/;

export function assertRosMessageType(type: string): string {
  if (!ROS_MESSAGE_TYPE_RE.test(type)) {
    throw new Error(`Invalid ROS message type "${type}".`);
  }
  return type;
}
