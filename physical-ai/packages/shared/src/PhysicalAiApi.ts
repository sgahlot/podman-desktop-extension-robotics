import type { QuayRepository, QuayTag, PullProgress, BuildProgress, PushProgress } from './types/ImageCatalog';
import type { SimulationConfig } from './types/SimulationConfig';
import type { SimLaunchOptions, SimContainerInfo, ExecResult } from './types/SimulationContainer';
import type {
  TopicInfo,
  TopicDetailInfo,
  TopicPeekResult,
  TopicSchemaResult,
} from './types/TopicInfo';
import type { NavigationGoalResult } from './types/NavigationGoalResult';

export abstract class PhysicalAiApi {
  abstract getStatus(): Promise<string>;
  abstract listCatalogImages(namespace: string): Promise<QuayRepository[]>;
  abstract getImageTags(namespace: string, name: string): Promise<QuayTag[]>;
  abstract pullImage(fullImageName: string, tag: string): Promise<void>;
  abstract getPullProgress(image: string): Promise<PullProgress | null>;
  abstract listLocalImages(): Promise<string[]>;
  abstract buildBaseImage(tag: string, config: SimulationConfig): Promise<void>;
  abstract buildSimulationImage(tag: string, config: SimulationConfig): Promise<void>;
  abstract cancelBuild(tag: string): Promise<void>;
  abstract getBuildProgress(tag: string): Promise<BuildProgress | null>;
  abstract pushImage(tag: string): Promise<void>;
  abstract cancelPush(tag: string): Promise<void>;
  abstract getPushProgress(tag: string): Promise<PushProgress | null>;
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
  abstract getSimulationConfig(): Promise<SimulationConfig>;
  abstract saveSimulationConfig(config: SimulationConfig): Promise<void>;
  abstract launchSimulation(imageTag: string, containerName: string, options?: SimLaunchOptions): Promise<string>;
  abstract stopSimulation(containerId: string): Promise<void>;
  abstract deleteSimulation(containerId: string): Promise<void>;
  abstract listSimulationContainers(): Promise<SimContainerInfo[]>;
  abstract execInSimulation(containerId: string, command: string[]): Promise<ExecResult>;
  abstract openSimulationInBrowser(port: number): Promise<void>;
  abstract listRosTopics(containerId: string): Promise<TopicInfo[]>;
  abstract getRosTopicDetail(containerId: string, topicName: string): Promise<TopicDetailInfo>;
  /** One live message via `ros2 topic echo --once` (bounded wait). */
  abstract peekRosTopic(containerId: string, topicName: string): Promise<TopicPeekResult>;
  /** Message structural definition via `ros2 interface show`. */
  abstract getRosMessageSchema(containerId: string, messageType: string): Promise<TopicSchemaResult>;
  /** Copy text via the host clipboard (webview Clipboard API is unavailable). */
  abstract copyToClipboard(text: string): Promise<void>;
  abstract sendNavigationGoal(containerId: string, robotName: string, x: number, y: number): Promise<NavigationGoalResult>;
}
