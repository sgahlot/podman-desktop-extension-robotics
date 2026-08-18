/**
 * Types for the "Deploy to OpenShift" flow (APPENG-5777).
 * Milestone 1 deploys a single simulation container (Gazebo + noVNC) reachable
 * via an OpenShift Route. Milestone 2 adds in-cluster robot spawn + Nav2 (see
 * spawnRobotInOpenShift / sendOpenShiftNavigationGoal in PhysicalAiApi).
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
  /**
   * When true, the cluster has a GPU (NVIDIA GPU operator): request `nvidia.com/gpu`
   * and let the entrypoint use hardware (EGL) rendering. Default false = software
   * (llvmpipe + headless EGL), the safe no-GPU default. See the entrypoint's render branch.
   */
  useGpu?: boolean;
  /**
   * Guaranteed CPU count (requests == limits) for the **software-render** pod, so
   * users can dial it to their cluster's node sizes. Default `DEFAULT_SW_RENDER_CPU`.
   * Ignored when `useGpu` is set (GPU offloads the render, so CPU is fixed low).
   * See `story7-multipod-openshift-architecture.md` for why a single pod's request
   * must fit on one node.
   */
  cpu?: number;
  /**
   * Taint the GPU pod must tolerate to land on a GPU node, as `key[=value][:effect]`
   * (e.g. `g5-gpu=true:NoSchedule`). GPU MachineSets commonly taint their nodes so
   * only GPU workloads schedule there; without a matching toleration the pod sits
   * Pending. Only used when `useGpu` is set; defaults to `DEFAULT_GPU_TOLERATION`.
   * A bare `key:effect` (no value) tolerates the taint via `Exists`.
   */
  gpuToleration?: string;
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
