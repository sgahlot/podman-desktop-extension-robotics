export interface LaserScanVisualization {
  points: Array<{ x: number; y: number }>;
  rangeMax: number;
  displayRange: number;
}

export interface PoseVisualization {
  x: number;
  y: number;
  yaw: number;
}

function scalar(message: string, key: string): number | undefined {
  const match = message.match(new RegExp(`(?:^|\\n)\\s*${key}:\\s*([-+\\d.eE]+)`));
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) ? value : undefined;
}

export function parseLaserScanVisualization(message: string): LaserScanVisualization | undefined {
  const inlineRanges = message.match(/(?:^|\n)\s*ranges:\s*\[([^\]]*)]/)?.[1];
  const blockRanges = message.match(/(?:^|\n)\s*ranges:\s*\n([\s\S]*?)(?=\n\s*[a-zA-Z_]\w*:\s*|$)/)?.[1];
  const angleMin = scalar(message, 'angle_min');
  const increment = scalar(message, 'angle_increment');
  const rangeMax = scalar(message, 'range_max');
  const rawRanges = inlineRanges
    ? inlineRanges.split(',')
    : (blockRanges?.match(/^\s*-\s+(.+)$/gm) ?? []).map(line => line.replace(/^\s*-\s+/, ''));
  if (!rawRanges.length || angleMin === undefined || increment === undefined || rangeMax === undefined)
    return undefined;
  const finiteRanges: number[] = [];
  const points = rawRanges
    .map((raw, index) => ({ range: Number(raw.trim()), angle: angleMin + index * increment }))
    .filter(({ range }) => Number.isFinite(range) && range >= 0 && range <= rangeMax)
    .map(({ range, angle }) => {
      finiteRanges.push(range);
      return { x: range * Math.cos(angle), y: range * Math.sin(angle) };
    });
  const sortedRanges = [...finiteRanges].sort((a, b) => a - b);
  const observedRange =
    sortedRanges.length < 20 ? sortedRanges.at(-1) : sortedRanges[Math.floor((sortedRanges.length - 1) * 0.95)];
  const displayRange = observedRange === undefined ? rangeMax : Math.min(rangeMax, Math.max(1, observedRange * 1.15));
  return { points, rangeMax, displayRange };
}

export function parsePoseVisualization(message: string): PoseVisualization | undefined {
  const position = message.match(/position:\s*\n\s*x:\s*([-+\d.eE]+)\s*\n\s*y:\s*([-+\d.eE]+)/m);
  const orientation = message.match(
    /orientation:\s*\n\s*x:\s*[-+\d.eE]+\s*\n\s*y:\s*[-+\d.eE]+\s*\n\s*z:\s*([-+\d.eE]+)\s*\n\s*w:\s*([-+\d.eE]+)/m,
  );
  if (!position || !orientation) return undefined;
  const [x, y, z, w] = [Number(position[1]), Number(position[2]), Number(orientation[1]), Number(orientation[2])];
  if (![x, y, z, w].every(Number.isFinite)) return undefined;
  return { x, y, yaw: Math.atan2(2 * w * z, 1 - 2 * z * z) };
}
