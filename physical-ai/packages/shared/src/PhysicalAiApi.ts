import type { QuayRepository, QuayTag, PullProgress, BuildProgress, PushProgress } from './types/ImageCatalog';
import type { SimulationConfig } from './types/SimulationConfig';
import type { SimLaunchOptions, SimContainerInfo, ExecResult } from './types/SimulationContainer';
import type { TopicInfo } from './types/TopicInfo';

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
  abstract getSimulationConfig(): Promise<SimulationConfig>;
  abstract saveSimulationConfig(config: SimulationConfig): Promise<void>;
  abstract launchSimulation(imageTag: string, containerName: string, options?: SimLaunchOptions): Promise<string>;
  abstract stopSimulation(containerId: string): Promise<void>;
  abstract deleteSimulation(containerId: string): Promise<void>;
  abstract listSimulationContainers(): Promise<SimContainerInfo[]>;
  abstract execInSimulation(containerId: string, command: string[]): Promise<ExecResult>;
  abstract openSimulationInBrowser(port: number): Promise<void>;
  abstract listRosTopics(containerId: string): Promise<TopicInfo[]>;
}
