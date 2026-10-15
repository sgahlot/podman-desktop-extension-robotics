/** Hard cap remains below typical host exec argv limits while supporting larger sensor messages. */
export const ROS_TOPIC_PUBLISH_MAX_BYTES = 64 * 1024;
/** Type discovery is also bounded because publishing must not hang the sim UI. */
export const ROS_TOPIC_PUBLISH_INFO_TIMEOUT_SECONDS = 3;
/** One-shot `ros2 topic pub` wall-clock bound, including discovery and publish. */
export const ROS_TOPIC_PUBLISH_TIMEOUT_SECONDS = 5;
/** At most one publish request per container per interval. */
export const ROS_TOPIC_PUBLISH_MIN_INTERVAL_MS = 1000;

const PROTECTED_TOPIC_BASENAMES = new Set([
  'cmd_vel',
  'cmd_vel_unstamped',
  'cmd_vel_smoothed',
  'goal_pose',
  'initialpose',
  'navigate_to_pose',
  'scan',
  'odom',
  'joint_states',
  'tf',
  'tf_static',
  'clock',
  'map',
  'parameter_events',
]);

/** UTF-8 byte count shared by the UI preflight and backend enforcement. */
export function topicPublishPayloadBytes(payload: string): number {
  return new TextEncoder().encode(payload).byteLength;
}

/** Return a user-facing caution for topics that can affect simulation behavior. */
export function getRosTopicPublishWarning(topicName: string): string | undefined {
  const basename = topicName.split('/').filter(Boolean).at(-1)?.toLowerCase();
  if (!basename || !PROTECTED_TOPIC_BASENAMES.has(basename)) return undefined;
  return `Publishing to ${topicName} may affect motion, sensors, transforms, simulation time, or mapping. Confirm only if this is intentional.`;
}

/** Validate one raw ROS YAML payload before it reaches the container CLI. */
export function assertRosTopicPublishPayload(payload: unknown): string {
  if (typeof payload !== 'string' || payload.trim().length === 0) {
    throw new Error('Message payload must not be empty.');
  }
  if (payload.length > ROS_TOPIC_PUBLISH_MAX_BYTES) {
    throw new Error(`Message payload exceeds the ${ROS_TOPIC_PUBLISH_MAX_BYTES}-byte limit.`);
  }
  const size = topicPublishPayloadBytes(payload);
  if (size > ROS_TOPIC_PUBLISH_MAX_BYTES) {
    throw new Error(`Message payload exceeds the ${ROS_TOPIC_PUBLISH_MAX_BYTES}-byte limit (${size} bytes).`);
  }
  return payload;
}

/** Validate the explicit UI confirmation; the backend remains the authority. */
export function assertRosTopicPublishConfirmed(confirmed: unknown): void {
  if (confirmed !== true) {
    throw new Error('Confirm that this one-shot message is safe for the topic subscribers before publishing.');
  }
}
