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
