import type {
  QuayRepository,
  QuayTag,
  PullProgress,
  BuildProgress,
  PushProgress,
  LocalImageInfo,
} from './types/ImageCatalog';
import type { BuildHistoryEntry, SbomFormat } from './types/BuildHistory';
import type { SimulationConfig } from './types/SimulationConfig';
import type { SimLaunchOptions, SimContainerInfo, ExecResult } from './types/SimulationContainer';
import type { TopicInfo, TopicDetailInfo, TopicPeekResult, TopicSchemaResult } from './types/TopicInfo';
import type { NavigationGoalResult, Nav2WarmStatus } from './types/NavigationGoalResult';
import type {
  TfTreeResult,
  CostmapSummaryResult,
  LaserScanSummary,
  RobotSensorDiagnosticsResult,
} from './types/RobotDiagnostics';
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
  /** Pull an image by its full registry reference (any registry, not just quay.io). */
  abstract pullImageByRef(imageRef: string): Promise<void>;
  abstract getPullProgress(image: string): Promise<PullProgress | undefined>;
  abstract listLocalImages(): Promise<string[]>;
  /** Local images with their reported CPU architecture, for finding genuinely-amd64 images
   * regardless of tag naming (see LocalImageInfo). */
  abstract listLocalImagesWithArch(): Promise<LocalImageInfo[]>;
  abstract buildBaseImage(tag: string, config: SimulationConfig): Promise<void>;
  abstract buildSimulationImage(tag: string, config: SimulationConfig): Promise<void>;
  /** Build an image from an in-memory Containerfile (layer-composition wizard). The
   * Containerfile is written to a throwaway build context; no bundled asset dir is used.
   * `options.generateSbom` (only meaningful here — the base/sim build paths never set it)
   * runs `syft` against the built image afterward and records the SBOM in build history,
   * in `options.sbomFormat` (defaults to SBOM_FORMAT_DEFAULT — see BuildHistory.ts for why
   * CycloneDX is the recommended default over SPDX). */
  abstract buildFromContainerfile(
    tag: string,
    containerfile: string,
    platform?: string,
    options?: { generateSbom?: boolean; sbomFormat?: SbomFormat },
  ): Promise<void>;
  abstract cancelBuild(tag: string): Promise<void>;
  abstract getBuildProgress(tag: string): Promise<BuildProgress | undefined>;
  /** Recent build results (tag, arch, duration, success, sbomPackageCount if generated),
   * newest first — up to physical-ai.build.historyLimit entries. Persisted across restarts.
   * Never includes the SBOM text itself (which can run tens of MB) — this is polled every
   * few seconds by the UI, so it must stay cheap regardless of SBOM size; fetch a specific
   * entry's SBOM on demand via getBuildHistorySbom (APPENG-6265). */
  abstract getBuildHistory(): Promise<BuildHistoryEntry[]>;
  /** Full SBOM text for one build history entry, identified by tag + startedAt (its stable
   * key). Undefined if the entry has aged out of history or has no recorded SBOM. */
  abstract getBuildHistorySbom(tag: string, startedAt: number): Promise<string | undefined>;
  /** Number of recent builds retained in history (Preferences: physical-ai.build.historyLimit, 1–20). */
  abstract getBuildHistoryLimit(): Promise<number>;
  /** Validates and persists the build history limit (1–20). Throws a user-facing error if out of range. */
  abstract setBuildHistoryLimit(limit: number): Promise<void>;
  abstract pushImage(tag: string): Promise<void>;
  abstract cancelPush(tag: string): Promise<void>;
  abstract getPushProgress(tag: string): Promise<PushProgress | undefined>;
  abstract getDefaultNamespace(): Promise<string>;
  abstract getHostArch(): Promise<string>;
  abstract getCatalogViewMode(): Promise<'all' | 'curated'>;
  abstract setCatalogViewMode(mode: 'all' | 'curated'): Promise<void>;
  abstract getImageBuilderLayout(): Promise<'pipeline' | 'guided' | 'layers'>;
  abstract setImageBuilderLayout(layout: 'pipeline' | 'guided' | 'layers'): Promise<void>;
  abstract getNavigationLayout(): Promise<'sidebar' | 'tabs' | 'cards'>;
  abstract setNavigationLayout(layout: 'sidebar' | 'tabs' | 'cards'): Promise<void>;
  abstract getCatalogCuratedAllowlist(): Promise<string>;
  /** Enforced (see assertLaunchImageTag) — Simulation launch fails if the tag doesn't
   * match. Empty string = default ros2-*-sim* / ros2-*-turtlebot3 patterns; a configured
   * value replaces the defaults entirely rather than adding to them. */
  abstract getSimulationImageAllowlist(): Promise<string>;
  /** NOT enforced (unlike getSimulationImageAllowlist) — UI convenience only. Comma-separated
   * image refs or repo patterns narrowing the OpenShift deploy tab's Image picker suggestions
   * (Preferences: physical-ai.openshift.deployImageAllowlist). Empty string = suggest every
   * genuinely-amd64 local image (real architecture metadata — see listLocalImagesWithArch),
   * regardless of name (APPENG-6259) — this only filters suggestions, never what the field
   * accepts as free text or what deploy actually sends. */
  abstract getOpenShiftImageAllowlist(): Promise<string>;
  /** Peek wait in seconds (Preferences: physical-ai.general.topicPeekTimeoutSeconds, 1–30). */
  abstract getTopicPeekTimeoutSeconds(): Promise<number>;
  /** Validates and persists peek timeout (1–30). Throws a user-facing error if out of range. */
  abstract setTopicPeekTimeoutSeconds(seconds: number): Promise<void>;
  /** Default software-render CPU count that seeds the OpenShift deploy form (Preferences: physical-ai.openshift.defaultSoftwareRenderCpus, 1–64). */
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
  /** Fast names+types via `ros2 topic list -t` (pub/sub counts pending). */
  abstract listRosTopicSummaries(containerId: string): Promise<TopicInfo[]>;
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
  /** Robots actually running in the local sim container, via `ros2 node list` — used
   * to reconcile the UI's robot list after a reload/restart forgets in-memory spawn
   * state (APPENG-6250). */
  abstract listSpawnedRobotsInSimulation(containerId: string): Promise<string[]>;

  // --- Robot diagnostics (APPENG-5810): one-shot textual TF/costmap/sensor snapshots ---
  /** Curated TF chain (map→odom→base_footprint→base_link→base_scan) via tf2_echo. */
  abstract getTfTreeStatus(containerId: string, robotName: string): Promise<TfTreeResult>;
  /** Local + global Nav2 OccupancyGrid summaries (cell counts, not raw grids). */
  abstract getCostmapSummary(containerId: string, robotName: string): Promise<CostmapSummaryResult>;
  /** LaserScan summary (angle/range bounds, min/max/mean of finite ranges). */
  abstract getLaserScanSummary(containerId: string, robotName: string): Promise<LaserScanSummary>;
  /** Dynamic sensor list for a robot: discovers `sensor_msgs/*` topics and peeks supported types. */
  abstract getRobotSensorDiagnostics(containerId: string, robotName: string): Promise<RobotSensorDiagnosticsResult>;

  // --- OpenShift deployment (APPENG-5777) ---
  /** Current Kubernetes/OpenShift context from the kubeconfig, or undefined if none. */
  abstract getOpenShiftContext(): Promise<OpenShiftContext | undefined>;
  /** Every context available in the kubeconfig, so the UI can offer switching to a
   * different cluster (S8-10) — each carries its own credentials/user. */
  abstract listKubeContexts(): Promise<{ name: string; clusterUrl?: string; namespace?: string }[]>;
  /** Configured fallback namespace (physical-ai.openshift.defaultNamespace) for when the
   * kubeconfig context sets none; '' when unconfigured (S8-16). */
  abstract getDefaultOpenShiftNamespace(): Promise<string>;
  /** Whether `oc` is currently logged in to a cluster (S8-11), via `oc whoami`. Checks the
   * given context (S8-10) when provided, else the kubeconfig's current-context. */
  abstract checkOpenShiftLogin(context?: string): Promise<{ loggedIn: boolean; message?: string }>;
  /** Every project/namespace the user can see on the given context (S8-21), via
   * `oc get projects`, for the deploy form's type-to-filter combobox. Returns [] on any
   * failure (not logged in, `oc` missing) rather than throwing, so the UI degrades to
   * free-text entry — mirrors listKubeContexts' fail-soft style. */
  abstract listOpenShiftProjects(context?: string): Promise<string[]>;
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

  // --- Robot diagnostics, OpenShift parity (APPENG-5810 follow-up) ---
  /** Curated TF chain for a robot in a deployed pod — see getTfTreeStatus. */
  abstract getTfTreeStatusInOpenShift(
    namespace: string,
    name: string,
    robotName: string,
    context?: string,
  ): Promise<TfTreeResult>;
  /** Local + global Nav2 costmap summaries for a robot in a deployed pod — see getCostmapSummary. */
  abstract getCostmapSummaryInOpenShift(
    namespace: string,
    name: string,
    robotName: string,
    context?: string,
  ): Promise<CostmapSummaryResult>;
  /** LaserScan summary for a robot in a deployed pod — see getLaserScanSummary. */
  abstract getLaserScanSummaryInOpenShift(
    namespace: string,
    name: string,
    robotName: string,
    context?: string,
  ): Promise<LaserScanSummary>;
  /** Dynamic sensor list for a robot in a deployed pod — see getRobotSensorDiagnostics. */
  abstract getRobotSensorDiagnosticsInOpenShift(
    namespace: string,
    name: string,
    robotName: string,
    context?: string,
  ): Promise<RobotSensorDiagnosticsResult>;
}
