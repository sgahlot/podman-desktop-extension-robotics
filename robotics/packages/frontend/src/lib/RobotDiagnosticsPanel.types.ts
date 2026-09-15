import type { TopicInfo } from '/@shared/src/types/TopicInfo';

/**
 * What RobotDiagnosticsPanel talks to: a local Podman simulation container, or a deployed
 * OpenShift pod. The divergence is narrow (which RPC trio to call, and whether a
 * topics-derived picker fallback exists — podman only) so one component branches on `kind`
 * rather than forking into two near-duplicate components.
 */
export type DiagnosticsTarget =
  | { kind: 'podman'; containerId: string; topics: TopicInfo[] }
  | { kind: 'oc'; namespace: string; workload: string; context?: string };
