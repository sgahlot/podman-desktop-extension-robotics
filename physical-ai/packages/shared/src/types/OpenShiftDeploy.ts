/**
 * Types for the "Deploy to OpenShift" flow (APPENG-5777).
 * Milestone 1 deploys a single simulation container (Gazebo + noVNC) reachable
 * via an OpenShift Route. Robot spawn + Nav2 in-cluster are a fast follow.
 */

export interface OpenShiftDeployConfig {
  /** Deployment/Service/Route name (DNS-1123 label, e.g. `ros2-jazzy-sim`). */
  name: string;
  /** Target namespace/project (e.g. `sgahlot-pd-extn`). */
  namespace: string;
  /**
   * Fully-qualified, cluster-pullable image ref (amd64), e.g.
   * `quay.io/<ns>/ros2-jazzy-sim:noble-amd64`.
   */
  image: string;
}

export interface OpenShiftDeployResult {
  name: string;
  namespace: string;
  /** `https://<route-host>` once the Route is admitted; undefined if not readable yet. */
  routeUrl?: string;
  /** Kinds applied, in order (Deployment, Service, Route). */
  applied: string[];
  message: string;
}

/** Current Kubernetes/OpenShift context resolved from the kubeconfig. */
export interface OpenShiftContext {
  context: string;
  kubeconfigPath: string;
}

/** A physical-ai-managed workload observed in a namespace. */
export interface OpenShiftWorkload {
  name: string;
  namespace: string;
  replicas: number;
  readyReplicas: number;
  ready: boolean;
  routeUrl?: string;
  image?: string;
}
