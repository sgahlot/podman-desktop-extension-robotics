import type { ExtensionContext } from '@podman-desktop/api';
import * as extensionApi from '@podman-desktop/api';
import type { PhysicalAiApi } from '/@shared/src/PhysicalAiApi';
import type { QuayRepository, QuayTag, PullProgress, BuildProgress, PushProgress } from '/@shared/src/types/ImageCatalog';

const QUAY_API_BASE = 'https://quay.io/api/v1';

export class PhysicalAiApiImpl implements PhysicalAiApi {
  private extensionContext: ExtensionContext;
  private activePulls = new Map<string, PullProgress>();
  private layerProgress = new Map<string, Map<string, { current: number; total: number }>>();
  private activeBuilds = new Map<string, BuildProgress>();
  private activePushes = new Map<string, PushProgress>();

  constructor(extensionContext: ExtensionContext) {
    this.extensionContext = extensionContext;
  }

  async getStatus(): Promise<string> {
    return 'Physical AI extension is running';
  }

  async listCatalogImages(namespace: string): Promise<QuayRepository[]> {
    const repos: QuayRepository[] = [];
    let nextPage: string | undefined;

    do {
      const url = new URL(`${QUAY_API_BASE}/repository`);
      url.searchParams.set('namespace', namespace);
      url.searchParams.set('public', 'true');
      if (nextPage) {
        url.searchParams.set('next_page', nextPage);
      }

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Quay API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      repos.push(...data.repositories);
      nextPage = data.next_page;
    } while (nextPage);

    return repos;
  }

  async getImageTags(namespace: string, name: string): Promise<QuayTag[]> {
    const url = new URL(`${QUAY_API_BASE}/repository/${namespace}/${name}/tag/`);
    url.searchParams.set('onlyActiveTags', 'true');
    url.searchParams.set('limit', '50');

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Quay API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.tags;
  }

  async getPullProgress(image: string): Promise<PullProgress | null> {
    return this.activePulls.get(image) || null;
  }

  async listLocalImages(): Promise<string[]> {
    const images = await extensionApi.containerEngine.listImages();
    return images.flatMap(img => img.RepoTags ?? []);
  }

  async pullImage(fullImageName: string, tag: string): Promise<void> {
    const connections = extensionApi.provider.getContainerConnections();
    const podmanConnection = connections.find(
      c => c.connection.type === 'podman' && c.connection.status() === 'started',
    );

    if (!podmanConnection) {
      throw new Error('No running Podman connection found');
    }

    const imageToPull = `quay.io/${fullImageName}:${tag}`;
    this.activePulls.set(imageToPull, { image: imageToPull, status: 'Starting...' });
    this.layerProgress.set(imageToPull, new Map());

    extensionApi.containerEngine.pullImage(
      podmanConnection.connection,
      imageToPull,
      event => {
        const layers = this.layerProgress.get(imageToPull)!;

        if (event.id && event.progressDetail?.current !== undefined && event.progressDetail?.total) {
          layers.set(event.id, {
            current: event.progressDetail.current,
            total: event.progressDetail.total,
          });
        }

        let totalCurrent = 0;
        let totalSize = 0;
        for (const layer of layers.values()) {
          totalCurrent += layer.current;
          totalSize += layer.total;
        }

        this.activePulls.set(imageToPull, {
          image: imageToPull,
          status: totalSize > 0 ? 'Downloading' : (event.status || ''),
          currentMB: totalSize > 0
            ? Math.round(totalCurrent / (1024 * 1024) * 10) / 10
            : undefined,
          totalMB: totalSize > 0
            ? Math.round(totalSize / (1024 * 1024) * 10) / 10
            : undefined,
        });
      },
    ).then(() => {
      this.layerProgress.delete(imageToPull);
      this.activePulls.set(imageToPull, { image: imageToPull, status: 'Complete', done: true });
      setTimeout(() => this.activePulls.delete(imageToPull), 30000);
    }).catch((err: unknown) => {
      this.layerProgress.delete(imageToPull);
      this.activePulls.set(imageToPull, {
        image: imageToPull,
        status: 'Failed',
        done: true,
        error: err instanceof Error ? err.message : String(err),
      });
      setTimeout(() => this.activePulls.delete(imageToPull), 30000);
    });
  }

  async getBuildProgress(tag: string): Promise<BuildProgress | null> {
    return this.activeBuilds.get(tag) || null;
  }

  async buildBaseImage(tag: string): Promise<void> {
    const connections = extensionApi.provider.getContainerConnections();
    const podmanConnection = connections.find(
      c => c.connection.type === 'podman' && c.connection.status() === 'started',
    );

    if (!podmanConnection) {
      throw new Error('No running Podman connection found');
    }

    const contextDir = extensionApi.Uri.joinPath(
      this.extensionContext.extensionUri, 'assets', 'ros2-jazzy-base',
    ).fsPath;

    this.activeBuilds.set(tag, {
      tag,
      status: 'Starting...',
      logs: [],
    });

    extensionApi.containerEngine.buildImage(
      contextDir,
      (eventName: string, data: string) => {
        const progress = this.activeBuilds.get(tag);
        if (!progress) return;

        if (eventName === 'stream') {
          const line = data.trim();
          if (line) {
            progress.logs.push(line);
            const stepMatch = line.match(/^STEP\s+(\d+)\/(\d+)/i);
            if (stepMatch) {
              progress.currentStep = parseInt(stepMatch[1], 10);
              progress.totalSteps = parseInt(stepMatch[2], 10);
              progress.status = `Building... Step ${progress.currentStep}/${progress.totalSteps}`;
            }
          }
        } else if (eventName === 'error') {
          progress.logs.push(`ERROR: ${data}`);
          progress.error = data;
        }
      },
      {
        containerFile: 'Containerfile',
        tag,
        provider: podmanConnection.connection,
      },
    ).then(() => {
      const progress = this.activeBuilds.get(tag);
      if (progress) {
        progress.status = 'Complete';
        progress.done = true;
      }
      setTimeout(() => this.activeBuilds.delete(tag), 30000);
    }).catch((err: unknown) => {
      const progress = this.activeBuilds.get(tag);
      if (progress) {
        progress.status = 'Failed';
        progress.done = true;
        progress.error = err instanceof Error ? err.message : String(err);
      }
      setTimeout(() => this.activeBuilds.delete(tag), 30000);
    });
  }

  async getPushProgress(tag: string): Promise<PushProgress | null> {
    return this.activePushes.get(tag) || null;
  }

  async pushImage(tag: string): Promise<void> {
    const images = await extensionApi.containerEngine.listImages();
    const imageInfo = images.find(img => img.RepoTags?.includes(tag));

    if (!imageInfo) {
      throw new Error(`Image not found locally: ${tag}`);
    }

    this.activePushes.set(tag, {
      tag,
      status: 'Pushing...',
      logs: [],
    });

    extensionApi.containerEngine.pushImage(
      imageInfo.engineId,
      tag,
      (name: string, data: string) => {
        const progress = this.activePushes.get(tag);
        if (!progress) return;

        if (name === 'end' || name === 'first-message') return;

        const rawData = data.trim();
        if (!rawData) return;

        for (const line of rawData.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            const msg = parsed.status || parsed.stream || parsed.error;
            if (msg) {
              progress.logs.push(msg);
              progress.status = msg;
            }
          } catch {
            progress.logs.push(trimmed);
            progress.status = trimmed;
          }
        }
      },
    ).then(() => {
      const progress = this.activePushes.get(tag);
      if (progress) {
        progress.status = 'Complete';
        progress.done = true;
      }
      setTimeout(() => this.activePushes.delete(tag), 30000);
    }).catch((err: unknown) => {
      const progress = this.activePushes.get(tag);
      if (progress) {
        progress.status = 'Failed';
        progress.done = true;
        progress.error = err instanceof Error ? err.message : String(err);
      }
      setTimeout(() => this.activePushes.delete(tag), 30000);
    });
  }
}
