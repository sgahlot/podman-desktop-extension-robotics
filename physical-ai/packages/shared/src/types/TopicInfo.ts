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
  /** Raw message text from stdout (empty if timed out / failed). */
  message: string;
  timedOut: boolean;
  error?: string;
}

