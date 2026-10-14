/** Maximum number of topics sampled by one telemetry RPC. */
export const ROS_TOPIC_TELEMETRY_MAX_TOPICS = 4;
/** Each ROS CLI observer is forcibly stopped after this many seconds. */
export const ROS_TOPIC_TELEMETRY_SAMPLE_SECONDS = 3;
/** Maximum number of single-process topic observers the backend starts at once. */
export const ROS_TOPIC_TELEMETRY_CONCURRENCY = 2;

/**
 * One sensor-QoS bandwidth observer provides both bytes/sec and mean message size;
 * their ratio gives the observed message rate without launching a second ROS node.
 */
export const ROS_TOPIC_TELEMETRY_SCRIPT = `
sample_seconds="$1"
topic="$2"
printf '__PAI_BW_BEGIN__\\n'
timeout -k 1 "$sample_seconds" ros2 topic bw --window 10 "$topic" 2>&1 || true
`;

export interface ParsedTopicTelemetry {
  status: 'active' | 'no-samples' | 'unavailable';
  publishHz?: number;
  bandwidthBytesPerSecond?: number;
  error?: string;
}

const BW_OUTPUT_RE = /__PAI_BW_BEGIN__\s*([\s\S]*)$/;
const BANDWIDTH_RE =
  /(?:average\s*:\s*)?([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(bytes?|b|kb|kib|mb|mib|gb|gib)\s*\/\s*s\b/gi;
const MESSAGE_SIZE_RE =
  /message\s+size\s+mean\s*:\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(bytes?|b|kb|kib|mb|mib|gb|gib)\b/gi;
const CLI_ERROR_RE =
  /command not found|no executable found|unknown command|failed to load command|(?:ros2|ros2topic)[^:\n]*:\s*error|invalid choice|usage:/i;

const BYTES_PER_UNIT: Record<string, number> = {
  B: 1,
  BYTE: 1,
  BYTES: 1,
  KB: 1_000,
  KIB: 1_024,
  MB: 1_000_000,
  MIB: 1_048_576,
  GB: 1_000_000_000,
  GIB: 1_073_741_824,
};

function finiteNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function outputFor(stdout: string, regex: RegExp): string {
  return stdout.match(regex)?.[1]?.trim() ?? '';
}

function lastMatch(output: string, regex: RegExp): RegExpMatchArray | undefined {
  const matches = Array.from(output.matchAll(regex));
  return matches[matches.length - 1];
}

/** Parse the marker-delimited output from ROS_TOPIC_TELEMETRY_SCRIPT. */
export function parseTopicTelemetryOutput(stdout: string, stderr = ''): ParsedTopicTelemetry {
  const bwOutput = outputFor(stdout, BW_OUTPUT_RE);
  const bandwidthMatch = lastMatch(bwOutput, BANDWIDTH_RE);
  const bandwidthValue = finiteNumber(bandwidthMatch?.[1]);
  const bandwidthUnit = bandwidthMatch?.[2]?.toUpperCase();
  const bandwidthFactor = bandwidthUnit ? BYTES_PER_UNIT[bandwidthUnit] : undefined;
  const bandwidthBytesPerSecond =
    bandwidthValue !== undefined && bandwidthFactor !== undefined ? bandwidthValue * bandwidthFactor : undefined;
  const messageSizeMatch = lastMatch(bwOutput, MESSAGE_SIZE_RE);
  const messageSizeValue = finiteNumber(messageSizeMatch?.[1]);
  const messageSizeUnit = messageSizeMatch?.[2]?.toUpperCase();
  const messageSizeFactor = messageSizeUnit ? BYTES_PER_UNIT[messageSizeUnit] : undefined;
  const meanMessageSizeBytes =
    messageSizeValue !== undefined && messageSizeFactor !== undefined
      ? messageSizeValue * messageSizeFactor
      : undefined;
  const publishHz =
    bandwidthBytesPerSecond !== undefined && meanMessageSizeBytes !== undefined && meanMessageSizeBytes > 0
      ? bandwidthBytesPerSecond / meanMessageSizeBytes
      : undefined;

  if (
    (publishHz !== undefined && publishHz > 0) ||
    (bandwidthBytesPerSecond !== undefined && bandwidthBytesPerSecond > 0)
  ) {
    return {
      status: 'active',
      ...(publishHz !== undefined && publishHz > 0 ? { publishHz } : {}),
      ...(bandwidthBytesPerSecond !== undefined ? { bandwidthBytesPerSecond } : {}),
    };
  }

  const combinedOutput = `${bwOutput}\n${stderr}`.trim();
  if (CLI_ERROR_RE.test(combinedOutput)) {
    const error = combinedOutput
      .split('\n')
      .map(line => line.trim())
      .find(line => line && CLI_ERROR_RE.test(line));
    return { status: 'unavailable', ...(error ? { error: error.slice(0, 240) } : {}) };
  }

  return { status: 'no-samples' };
}
