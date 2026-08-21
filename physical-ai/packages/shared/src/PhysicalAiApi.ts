import type { QuayRepository, QuayTag, PullProgress, BuildProgress, PushProgress } from './types/ImageCatalog';
import type { SimulationConfig } from './types/SimulationConfig';
import type { SimLaunchOptions, SimContainerInfo, ExecResult } from './types/SimulationContainer';
import type { TopicInfo, TopicDetailInfo, TopicPeekResult, TopicSchemaResult } from './types/TopicInfo';
import type { NavigationGoalResult, Nav2WarmStatus } from './types/NavigationGoalResult';
import type {
  OpenShiftDeployConfig,
  OpenShiftDeployResult,
  OpenShiftContext,
  OpenShiftWorkload,
} from './types/OpenShiftDeploy';

export abstract class PhysicalAiApi {
  abstract getStatus(): Promise<string>;
  abstract listCatalogImages(namespace: string): Promise<QuayRepository[]>;
  abstract getImageTags(namespace: string, name: string): Promise<QuayTag[]>;
  abstract pullImage(fullImageName: string, tag: string): Promise<void>;
  abstract getPullProgress(image: string): Promise<PullProgress | undefined>;
  abstract listLocalImages(): Promise<string[]>;
  abstract buildBaseImage(tag: string, config: SimulationConfig): Promise<void>;
  abstract buildSimulationImage(tag: string, config: SimulationConfig): Promise<void>;
  abstract cancelBuild(tag: string): Promise<void>;
  abstract getBuildProgress(tag: string): Promise<BuildProgress | undefined>;
  abstract pushImage(tag: string): Promise<void>;
  abstract cancelPush(tag: string): Promise<void>;
  abstract getPushProgress(tag: string): Promise<PushProgress | undefined>;
  abstract getDefaultNamespace(): Promise<string>;
  abstract getHostArch(): Promise<string>;
  abstract getCatalogViewMode(): Promise<'all' | 'curated'>;
  abstract setCatalogViewMode(mode: 'all' | 'curated'): Promise<void>;
  abstract getCatalogCuratedAllowlist(): Promise<string>;
  /** Empty string = default ros2-*-sim* / ros2-*-turtlebot3 patterns. */
  abstract getSimulationImageAllowlist(): Promise<string>;
  /** Peek wait in seconds (Preferences: physical-ai.topicPeekTimeoutSeconds, 1–30). */
  abstract getTopicPeekTimeoutSeconds(): Promise<number>;
  /** Validates and persists peek timeout (1–30). Throws a user-facing error if out of range. */
  abstract setTopicPeekTimeoutSeconds(seconds: number): Promise<void>;
  /** Default software-render CPU count that seeds the OpenShift deploy form (Preferences: physical-ai.defaultSoftwareRenderCpus, 1–64). */
  abstract getDefaultSoftwareRenderCpus(): Promise<number>;
  abstract getSimulationConfig(): Promise<SimulationConfig>;
  abstract saveSimulationConfig(config: SimulationConfig): Promise<void>;
  abstract launchSimulation(imageTag: string, containerName: string, options?: SimLaunchOptions): Promise<string>;
  abstract stopSimulation(containerId: string): Promise<void>;
  abstract deleteSimulation(containerId: string): Promise<void>;
  abstract listSimulationContainers(): Promise<SimContainerInfo[]>;
  abstract execInSimulation(containerId: string, command: string[]): Promise<ExecResult>;
  abstract openSimulationInBrowser(hostPort: number, containerPort?: number): Promise<void>;
  /** Open an external http(s) URL (e.g. an OpenShift Route) in the host browser. */
  abstract openUrlInBrowser(url: string): Promise<void>;
  abstract listRosTopics(containerId: string): Promise<TopicInfo[]>;
  abstract getRosTopicDetail(containerId: string, topicName: string): Promise<TopicDetailInfo>;
  /** One live message via `ros2 topic echo --once` (bounded wait). */
  abstract peekRosTopic(containerId: string, topicName: string): Promise<TopicPeekResult>;
  /** Message structural definition via `ros2 interface show`. */
  abstract getRosMessageSchema(containerId: string, messageType: string): Promise<TopicSchemaResult>;
  /** Copy text via the host clipboard (webview Clipboard API is unavailable). */
  abstract copyToClipboard(text: string): Promise<void>;
  abstract sendNavigationGoal(
    containerId: string,
    robotName: string,
    x: number,
    y: number,
  ): Promise<NavigationGoalResult>;
  /** Tear down a spawned robot: kill its ROS processes and remove its Gazebo model. */
  abstract despawnRobot(containerId: string, robotName: string): Promise<void>;
  /** Nav2 pre-warm state for a spawned robot (local sim), for an honest "warming…" indicator. */
  abstract getRobotWarmStatus(containerId: string, robotName: string): Promise<Nav2WarmStatus>;

  // --- OpenShift deployment (APPENG-5777) ---
  /** Current Kubernetes/OpenShift context from the kubeconfig, or undefined if none. */
  abstract getOpenShiftContext(): Promise<OpenShiftContext | undefined>;
  /** Every context available in the kubeconfig, so the UI can offer switching to a
   * different cluster (S8-10) — each carries its own credentials/user. */
  abstract listKubeContexts(): Promise<{ name: string; clusterUrl?: string; namespace?: string }[]>;
  /** Configured fallback namespace (physical-ai.defaultOpenShiftNamespace) for when the
   * kubeconfig context sets none; '' when unconfigured (S8-16). */
  abstract getDefaultOpenShiftNamespace(): Promise<string>;
  /** Whether `oc` is currently logged in to a cluster (S8-11), via `oc whoami`. Checks the
   * given context (S8-10) when provided, else the kubeconfig's current-context. */
  abstract checkOpenShiftLogin(context?: string): Promise<{ loggedIn: boolean; message?: string }>;
  /** Render the Deployment/Service/Route manifests as a YAML preview (no side effects). */
  abstract generateOpenShiftManifests(config: OpenShiftDeployConfig): Promise<{ yaml: string }>;
  /** Apply the manifests to config.context when set (S8-10), else the current context. */
  abstract deployToOpenShift(config: OpenShiftDeployConfig): Promise<OpenShiftDeployResult>;
  /** List physical-ai-managed deployments in a namespace. */
  abstract listOpenShiftDeployments(namespace: string, context?: string): Promise<OpenShiftWorkload[]>;
  /** Delete the Deployment/Service/Route for a named workload. */
  abstract deleteOpenShiftDeployment(namespace: string, name: string, context?: string): Promise<void>;
  /** Spawn a TurtleBot3 into a deployed simulation pod (mirrors the local spawn). */
  abstract spawnRobotInOpenShift(
    namespace: string,
    name: string,
    robotName: string,
    x: string,
    y: string,
    yaw: string,
    context?: string,
  ): Promise<void>;
  /** Drive a spawned robot to (x, y) in a deployed pod (Nav2 on Jazzy, cmd_vel on Humble). */
  abstract sendOpenShiftNavigationGoal(
    namespace: string,
    name: string,
    robotName: string,
    x: number,
    y: number,
    context?: string,
  ): Promise<NavigationGoalResult>;
  /** Tear down a robot in a deployed pod: kill its ROS processes and remove its Gazebo model. */
  abstract despawnRobotInOpenShift(namespace: string, name: string, robotName: string, context?: string): Promise<void>;
  /** Nav2 pre-warm state for a robot in a deployed pod, for an honest "warming…" indicator. */
  abstract getRobotWarmStatusInOpenShift(namespace: string, name: string, robotName: string): Promise<Nav2WarmStatus>;
  /** Robots actually running in the deployment's pod, via `ros2 node list` (S8-17) — used
   * to reconcile the UI's robot list after a reload/restart forgets in-memory spawn state. */
  abstract listSpawnedRobotsInOpenShift(namespace: string, name: string, context?: string): Promise<string[]>;
}
