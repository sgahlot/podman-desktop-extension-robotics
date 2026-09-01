import type { TopicInfo } from '../types/TopicInfo';

/**
 * Curated TF chain for TB3-in-Gazebo (map frame → LIDAR frame), verified live against a
 * running Jazzy sim container (`ros2 topic echo /<robot>/tf_static --once` + `tf2_echo` per
 * pair): map→odom and odom→base_footprint are published dynamically (AMCL / diff-drive
 * odometry); base_footprint→base_link and base_link→base_scan are static (URDF). Full/dynamic
 * frame-graph discovery (tf2_monitor/view_frames) is explicitly out of scope — see plan.
 */
export const TF_FRAME_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['map', 'odom'],
  ['odom', 'base_footprint'],
  ['base_footprint', 'base_link'],
  ['base_link', 'base_scan'],
];

export interface ParsedTfEcho {
  available: boolean;
  translation?: { x: number; y: number; z: number };
  rotationQuaternion?: { x: number; y: number; z: number; w: number };
  error?: string;
}

// Matches a `tf2_echo` sample pair, e.g.:
//   - Translation: [-2.085, -0.571, 0.000]
//   - Rotation: in Quaternion (xyzw) [0.000, 0.000, 0.014, 1.000]
const TF_SAMPLE_RE = /- Translation:\s*\[([^\]]+)]\s*\n- Rotation: in Quaternion(?:\s*\(xyzw\))?\s*\[([^\]]+)]/g;

/**
 * Parses `ros2 run tf2_ros tf2_echo` stdout (which repeats one sample per second for the
 * whole run duration). Takes the LAST sample (most recent), not the first, so a dynamic
 * transform (e.g. map→odom) reflects current state rather than a stale first reading.
 */
export function parseTfEchoOutput(raw: string): ParsedTfEcho {
  const matches = [...raw.matchAll(TF_SAMPLE_RE)];
  if (matches.length === 0) {
    const errorLine = raw
      .split('\n')
      .map(line => line.trim())
      .find(line => /invalid frame id|waiting for transform|lookup would require extrapolation/i.test(line));
    return { available: false, error: errorLine };
  }

  const [, translationRaw, rotationRaw] = matches[matches.length - 1];
  const [x, y, z] = translationRaw.split(',').map(v => Number(v.trim()));
  const [rx, ry, rz, rw] = rotationRaw.split(',').map(v => Number(v.trim()));
  return {
    available: true,
    translation: { x, y, z },
    rotationQuaternion: { x: rx, y: ry, z: rz, w: rw },
  };
}

export interface ParsedOccupancyGrid {
  width: number;
  height: number;
  resolution: number;
  originX: number;
  originY: number;
  occupied: number;
  free: number;
  unknown: number;
  total: number;
}

const ORIGIN_XY_RE = /origin:\s*\n\s*position:\s*\n\s*x:\s*([-\d.eE+]+)\s*\n\s*y:\s*([-\d.eE+]+)/;

/**
 * Parses `nav_msgs/OccupancyGrid` echo text (expects `--full-length --flow-style` so the
 * `data:` array is complete and on a single line — see #peekOccupancyGrid in api-impl.ts;
 * the default `ros2 topic echo` truncates arrays at 128 elements, far short of a costmap's
 * cell count). Classifies each cell using the standard OccupancyGrid convention: -1 unknown,
 * 0 free, any positive value occupied — verified live that Nav2's inflation layer publishes
 * a continuous 1-100 gradient around obstacles, not just the literal value 100. Any other
 * out-of-spec value (negative but not -1) is counted as unknown rather than occupied, since
 * the OccupancyGrid contract never produces one from real Nav2 data.
 */
export function parseOccupancyGridEcho(text: string): ParsedOccupancyGrid | undefined {
  const widthMatch = text.match(/\bwidth:\s*(\d+)/);
  const heightMatch = text.match(/\bheight:\s*(\d+)/);
  const dataMatch = text.match(/\bdata:\s*\[([^\]]*)]/);
  if (!widthMatch || !heightMatch || !dataMatch) return undefined;

  const resolutionMatch = text.match(/\bresolution:\s*([-\d.eE+]+)/);
  const originMatch = text.match(ORIGIN_XY_RE);

  let occupied = 0;
  let free = 0;
  let unknown = 0;
  let total = 0;
  const rawData = dataMatch[1].trim();
  if (rawData.length > 0) {
    for (const token of rawData.split(',')) {
      const value = parseInt(token.trim(), 10);
      if (Number.isNaN(value)) continue;
      total++;
      if (value === -1) unknown++;
      else if (value === 0) free++;
      else if (value > 0) occupied++;
      else unknown++;
    }
  }

  return {
    width: parseInt(widthMatch[1], 10),
    height: parseInt(heightMatch[1], 10),
    resolution: resolutionMatch ? Number(resolutionMatch[1]) : 0,
    originX: originMatch ? Number(originMatch[1]) : 0,
    originY: originMatch ? Number(originMatch[2]) : 0,
    occupied,
    free,
    unknown,
    total,
  };
}

export interface ParsedLaserScan {
  angleMin: number;
  angleMax: number;
  angleIncrement: number;
  rangeMin: number;
  rangeMax: number;
  min?: number;
  max?: number;
  mean?: number;
  finiteCount: number;
  infCount: number;
  nanCount: number;
  totalCount: number;
}

/** Parses a YAML scalar float, including ROS 2's `.inf` / `-.inf` / `.nan` tokens. */
function parseRosFloat(token: string): number {
  const t = token.trim();
  if (/^[-+]?\.inf$/i.test(t)) return t.startsWith('-') ? -Infinity : Infinity;
  if (/^\.nan$/i.test(t)) return NaN;
  return Number(t);
}

/**
 * Parses `sensor_msgs/LaserScan` echo text (expects `--full-length --flow-style` for the
 * same reason as parseOccupancyGridEcho — the TB3 LDS publishes 360+ ranges, over the
 * default 128-element truncation).
 */
export function parseLaserScanEcho(text: string): ParsedLaserScan | undefined {
  const rangesMatch = text.match(/\branges:\s*\[([^\]]*)]/);
  if (!rangesMatch) return undefined;

  const angleMinMatch = text.match(/\bangle_min:\s*([-\d.eE+]+)/);
  const angleMaxMatch = text.match(/\bangle_max:\s*([-\d.eE+]+)/);
  const angleIncrementMatch = text.match(/\bangle_increment:\s*([-\d.eE+]+)/);
  const rangeMinMatch = text.match(/\brange_min:\s*([-\d.eE+]+)/);
  const rangeMaxMatch = text.match(/\brange_max:\s*([-\d.eE+]+)/);

  let finiteCount = 0;
  let infCount = 0;
  let nanCount = 0;
  let totalCount = 0;
  let sum = 0;
  let min: number | undefined;
  let max: number | undefined;

  const rawRanges = rangesMatch[1].trim();
  if (rawRanges.length > 0) {
    for (const token of rawRanges.split(',')) {
      const value = parseRosFloat(token);
      totalCount++;
      if (Number.isNaN(value)) {
        nanCount++;
      } else if (!Number.isFinite(value)) {
        infCount++;
      } else {
        finiteCount++;
        sum += value;
        if (min === undefined || value < min) min = value;
        if (max === undefined || value > max) max = value;
      }
    }
  }

  return {
    angleMin: angleMinMatch ? Number(angleMinMatch[1]) : 0,
    angleMax: angleMaxMatch ? Number(angleMaxMatch[1]) : 0,
    angleIncrement: angleIncrementMatch ? Number(angleIncrementMatch[1]) : 0,
    rangeMin: rangeMinMatch ? Number(rangeMinMatch[1]) : 0,
    rangeMax: rangeMaxMatch ? Number(rangeMaxMatch[1]) : 0,
    min,
    max,
    mean: finiteCount > 0 ? sum / finiteCount : undefined,
    finiteCount,
    infCount,
    nanCount,
    totalCount,
  };
}

const ROBOT_NAMESPACE_TOPIC_RE = /^\/([^/]+)\/(scan|local_costmap\/costmap|global_costmap\/costmap|tf|tf_static)$/;

/** Distinct robot namespaces inferred from already-polled topic names, sorted. */
export function deriveRobotNamespaces(topics: TopicInfo[]): string[] {
  const namespaces = new Set<string>();
  for (const topic of topics) {
    const match = topic.name.match(ROBOT_NAMESPACE_TOPIC_RE);
    if (match) namespaces.add(match[1]);
  }
  return [...namespaces].sort();
}
