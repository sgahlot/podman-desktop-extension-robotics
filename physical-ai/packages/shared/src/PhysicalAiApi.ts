import type { QuayRepository, QuayTag, PullProgress, BuildProgress, PushProgress } from './types/ImageCatalog';

export abstract class PhysicalAiApi {
  abstract getStatus(): Promise<string>;
  abstract listCatalogImages(namespace: string): Promise<QuayRepository[]>;
  abstract getImageTags(namespace: string, name: string): Promise<QuayTag[]>;
  abstract pullImage(fullImageName: string, tag: string): Promise<void>;
  abstract getPullProgress(image: string): Promise<PullProgress | null>;
  abstract listLocalImages(): Promise<string[]>;
  abstract buildBaseImage(tag: string): Promise<void>;
  abstract getBuildProgress(tag: string): Promise<BuildProgress | null>;
  abstract pushImage(tag: string): Promise<void>;
  abstract getPushProgress(tag: string): Promise<PushProgress | null>;
  abstract getDefaultNamespace(): Promise<string>;
}
