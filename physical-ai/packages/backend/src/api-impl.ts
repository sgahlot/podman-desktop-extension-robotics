import * as extensionApi from '@podman-desktop/api';
import type { PhysicalAiApi } from '/@shared/src/PhysicalAiApi';
import type { QuayRepository, QuayTag, PullProgress } from '/@shared/src/types/ImageCatalog';

const QUAY_API_BASE = 'https://quay.io/api/v1';

export class PhysicalAiApiImpl implements PhysicalAiApi {
  private activePulls = new Map<string, PullProgress>();
  private layerProgress = new Map<string, Map<string, { current: number; total: number }>>();

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
    }).catch((err: unknown) => {
      this.layerProgress.delete(imageToPull);
      this.activePulls.set(imageToPull, {
        image: imageToPull,
        status: 'Failed',
        done: true,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}
