import type { QuayRepository, QuayTag } from './types/ImageCatalog';

export abstract class PhysicalAiApi {
  abstract getStatus(): Promise<string>;
  abstract listCatalogImages(namespace: string): Promise<QuayRepository[]>;
  abstract getImageTags(namespace: string, name: string): Promise<QuayTag[]>;
  abstract pullImage(fullImageName: string, tag: string): Promise<void>;
}
