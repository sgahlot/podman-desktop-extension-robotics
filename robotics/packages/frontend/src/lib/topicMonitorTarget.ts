import { physicalAiClient } from '../api/client';
import { resolveOpenShiftNamespace } from './resolveOpenShiftNamespace';
import type { OpenShiftWorkload } from '/@shared/src/types/OpenShiftDeploy';
import type { RosbagRecording } from '/@shared/src/types/RosbagRecording';
import type {
  TopicDetailInfo,
  TopicGraphTopology,
  TopicInfo,
  TopicPeekResult,
  TopicPublishResult,
  TopicSchemaResult,
  TopicTelemetry,
} from '/@shared/src/types/TopicInfo';

export type TopicMonitorTargetKind = 'local' | 'openshift';

export interface TopicMonitorTargetOption {
  id: string;
  label: string;
  ready: boolean;
}

export interface TopicMonitorTargetApi {
  readonly kind: TopicMonitorTargetKind;
  listTargets(): Promise<TopicMonitorTargetOption[]>;
  getTopicTopology(id: string): Promise<TopicGraphTopology>;
  listRosTopicSummaries(id: string): Promise<TopicInfo[]>;
  listRosTopics(id: string): Promise<TopicInfo[]>;
  getRosTopicDetail(id: string, topicName: string): Promise<TopicDetailInfo>;
  getRosMessageSchema(id: string, messageType: string): Promise<TopicSchemaResult>;
  peekRosTopic(id: string, topicName: string): Promise<TopicPeekResult>;
  getTopicTelemetry(id: string, topicNames: string[]): Promise<TopicTelemetry[]>;
  publishRosTopic(id: string, topicName: string, payload: string, confirmed: boolean): Promise<TopicPublishResult>;
  startRosbagRecording(id: string, topicNames: string[], outputPath: string): Promise<RosbagRecording>;
  getRosbagRecording(id: string): Promise<RosbagRecording | undefined>;
  stopRosbagRecording(id: string): Promise<RosbagRecording | undefined>;
  getTopicPeekTimeoutSeconds(): Promise<number>;
  copyToClipboard(text: string): Promise<void>;
}

interface OpenShiftTarget {
  namespace: string;
  name: string;
  context?: string;
}

function localTargetApi(): TopicMonitorTargetApi {
  return {
    kind: 'local',
    async listTargets() {
      const containers = await physicalAiClient.listSimulationContainers();
      return containers
        .filter(container => container.state === 'running')
        .map(container => ({ id: container.id, label: `${container.name} — ${container.imageTag}`, ready: true }));
    },
    getTopicTopology: id => physicalAiClient.getTopicTopology(id),
    listRosTopicSummaries: id => physicalAiClient.listRosTopicSummaries(id),
    listRosTopics: id => physicalAiClient.listRosTopics(id),
    getRosTopicDetail: (id, topicName) => physicalAiClient.getRosTopicDetail(id, topicName),
    getRosMessageSchema: (id, type) => physicalAiClient.getRosMessageSchema(id, type),
    peekRosTopic: (id, topicName) => physicalAiClient.peekRosTopic(id, topicName),
    getTopicTelemetry: (id, names) => physicalAiClient.getTopicTelemetry(id, names),
    publishRosTopic: (id, topicName, payload, confirmed) =>
      physicalAiClient.publishRosTopic(id, topicName, payload, confirmed),
    startRosbagRecording: (id, names, path) => physicalAiClient.startRosbagRecording(id, names, path),
    getRosbagRecording: id => physicalAiClient.getRosbagRecording(id),
    stopRosbagRecording: id => physicalAiClient.stopRosbagRecording(id),
    getTopicPeekTimeoutSeconds: () => physicalAiClient.getTopicPeekTimeoutSeconds(),
    copyToClipboard: text => physicalAiClient.copyToClipboard(text),
  };
}

function openShiftTargetApi(): TopicMonitorTargetApi {
  const targets = new Map<string, OpenShiftTarget>();
  const target = (id: string): OpenShiftTarget => {
    const resolved = targets.get(id);
    if (!resolved) throw new Error('Select an OpenShift simulation and refresh the target list.');
    return resolved;
  };
  const workloadsForSelection = async (): Promise<{
    workloads: OpenShiftWorkload[];
    selection: { namespace: string; context?: string };
  }> => {
    const selection = await resolveOpenShiftNamespace();
    if (!selection) return { workloads: [], selection: { namespace: '' } };
    return {
      workloads: await physicalAiClient.listOpenShiftDeployments(selection.namespace, selection.context),
      selection,
    };
  };

  return {
    kind: 'openshift',
    async listTargets() {
      const { workloads, selection } = await workloadsForSelection();
      targets.clear();
      return workloads.map(workload => {
        const id = `${workload.namespace}/${workload.name}`;
        targets.set(id, { namespace: workload.namespace, name: workload.name, context: selection.context });
        return { id, label: `${workload.name} — ${workload.namespace}`, ready: workload.ready };
      });
    },
    getTopicTopology: async id => {
      const t = target(id);
      return physicalAiClient.getTopicTopologyInOpenShift(t.namespace, t.name, t.context);
    },
    listRosTopicSummaries: async id => {
      const t = target(id);
      return physicalAiClient.listRosTopicSummariesInOpenShift(t.namespace, t.name, t.context);
    },
    listRosTopics: async id => {
      const t = target(id);
      return physicalAiClient.listRosTopicsInOpenShift(t.namespace, t.name, t.context);
    },
    getRosTopicDetail: async (id, topicName) => {
      const t = target(id);
      return physicalAiClient.getRosTopicDetailInOpenShift(t.namespace, t.name, topicName, t.context);
    },
    getRosMessageSchema: async (id, type) => {
      const t = target(id);
      return physicalAiClient.getRosMessageSchemaInOpenShift(t.namespace, t.name, type, t.context);
    },
    peekRosTopic: async (id, topicName) => {
      const t = target(id);
      return physicalAiClient.peekRosTopicInOpenShift(t.namespace, t.name, topicName, t.context);
    },
    getTopicTelemetry: async (id, names) => {
      const t = target(id);
      return physicalAiClient.getTopicTelemetryInOpenShift(t.namespace, t.name, names, t.context);
    },
    publishRosTopic: async (id, topicName, payload, confirmed) => {
      const t = target(id);
      return physicalAiClient.publishRosTopicInOpenShift(t.namespace, t.name, topicName, payload, confirmed, t.context);
    },
    startRosbagRecording: async (id, names, path) => {
      const t = target(id);
      return physicalAiClient.startRosbagRecordingInOpenShift(t.namespace, t.name, names, path, t.context);
    },
    getRosbagRecording: async id => {
      const t = target(id);
      return physicalAiClient.getRosbagRecordingInOpenShift(t.namespace, t.name, t.context);
    },
    stopRosbagRecording: async id => {
      const t = target(id);
      return physicalAiClient.stopRosbagRecordingInOpenShift(t.namespace, t.name, t.context);
    },
    getTopicPeekTimeoutSeconds: () => physicalAiClient.getTopicPeekTimeoutSeconds(),
    copyToClipboard: text => physicalAiClient.copyToClipboard(text),
  };
}

export function createTopicMonitorTarget(kind: TopicMonitorTargetKind): TopicMonitorTargetApi {
  return kind === 'openshift' ? openShiftTargetApi() : localTargetApi();
}
