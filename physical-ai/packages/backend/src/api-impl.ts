import * as extensionApi from '@podman-desktop/api';
import type { PhysicalAiApi } from '/@shared/src/PhysicalAiApi';
import type { QuayRepository, QuayTag } from '/@shared/src/types/ImageCatalog';

const QUAY_API_BASE = 'https://quay.io/api/v1';

export class PhysicalAiApiImpl implements PhysicalAiApi {
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

  async pullImage(fullImageName: string, tag: string): Promise<void> {
    const connections = extensionApi.provider.getContainerConnections();
    const podmanConnection = connections.find(
      c => c.connection.type === 'podman' && c.connection.status() === 'started',
    );

    if (!podmanConnection) {
      throw new Error('No running Podman connection found');
    }

    const imageToPull = `quay.io/${fullImageName}:${tag}`;
    await extensionApi.containerEngine.pullImage(
      podmanConnection.connection,
      imageToPull,
      () => {},
    );
  }
}
