export interface TopicInfo {
  name: string;
  type: string;
  publishers: number;
  subscribers: number;
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
