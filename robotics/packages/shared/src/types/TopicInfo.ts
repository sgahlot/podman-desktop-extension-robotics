export interface TopicInfo {
  name: string;
  type: string;
  publishers: number;
  subscribers: number;
  /** True after `ros2 topic list -t` before pub/sub counts have been fetched. */
  countsPending?: boolean;
}

export interface TopicNodeInfo {
  nodeName: string;
  nodeNamespace: string;
}

export interface TopicDetailInfo {
  topicName: string;
  type: string;
  publishers: TopicNodeInfo[];
  subscribers: TopicNodeInfo[];
}

/** A downsampled OccupancyGrid snapshot safe to render in the Topic Monitor. */
export interface TopicOccupancyGridSnapshot {
  topicName: string;
  width: number;
  height: number;
  resolutionMeters: number;
  originX: number;
  originY: number;
  /** Row-major cells: -1 unknown, 0 free, positive occupied. Capped at 96 × 96. */
  cells: number[];
  capturedAt: string;
  error?: string;
}

/** A byte-capped latest CompressedImage frame for safe webview preview. */
export interface TopicCompressedImageSnapshot {
  topicName: string;
  format: string;
  dataBase64: string;
  capturedAt: string;
  error?: string;
}

/** A ROS node and the topic endpoints it exposes. */
export interface NodeDetail {
  nodeName: string;
  nodeNamespace: string;
  publishingTopics: string[];
  subscribingTopics: string[];
}

/** Snapshot of the node/topic relationships available to the graphical monitor. */
export interface TopicGraphTopology {
  topics: TopicInfo[];
  nodes: NodeDetail[];
  capturedAt: string;
}

/** `no-samples` means no data arrived during the bounded observation window; it is not proof of a dead publisher. */
export type TopicTelemetryStatus = 'active' | 'no-samples' | 'unavailable';

/** Bounded runtime measurement for one selected topic. */
export interface TopicTelemetry {
  topicName: string;
  status: TopicTelemetryStatus;
  publishHz?: number;
  bandwidthBytesPerSecond?: number;
  capturedAt: string;
  error?: string;
}

/** Result metadata for one completed local `ros2 topic pub --once` request. */
export interface TopicPublishResult {
  topicName: string;
  messageType: string;
  publishedAt: string;
}

/** One-shot snapshot from `ros2 topic echo --once`. */
export interface TopicPeekResult {
  topicName: string;
  /** Cleaned message YAML (noise stripped). Empty if timed out / failed. */
  message: string;
  timedOut: boolean;
  error?: string;
  /** Wall-clock ISO time when the peek completed. */
  capturedAt: string;
  /** From header.stamp / clock when present in the message body. */
  messageStamp?: string;
  /** True when the cleaned body was truncated to the size cap. */
  truncated?: boolean;
}

/** Structural definition from `ros2 interface show`. */
export interface TopicSchemaResult {
  type: string;
  schema: string;
  error?: string;
}
