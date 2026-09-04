import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ExtensionContext } from '@podman-desktop/api';
import { PhysicalAiApiImpl } from './api-impl';
import {
  SIM_CONTAINER_LABEL,
  SIM_CONTAINER_LABEL_VALUE,
  SIM_STOPPED_BROWSER_HINT,
} from '/@shared/src/types/SimulationContainer';
import { SPAWN_ENTRYPOINT, GAZEBO_ENTRYPOINT, NAV2_ENTRYPOINT } from '/@shared/src/security/simInput';
import type { BuildHistoryEntry } from '/@shared/src/types/BuildHistory';

vi.mock('@podman-desktop/api', () => ({
  provider: {
    createProvider: vi.fn(),
    getContainerConnections: vi.fn(),
  },
  window: {
    createWebviewPanel: vi.fn(),
    showInformationMessage: vi.fn(),
  },
  commands: {
    registerCommand: vi.fn(),
  },
  containerEngine: {
    listImages: vi.fn(),
    listContainers: vi.fn(),
    pullImage: vi.fn(),
    buildImage: vi.fn(),
    pushImage: vi.fn(),
    createContainer: vi.fn(),
    startContainer: vi.fn(),
    stopContainer: vi.fn(),
    deleteContainer: vi.fn(),
  },
  process: {
    exec: vi.fn(),
  },
  kubernetes: {
    getKubeconfig: vi.fn(),
    createResources: vi.fn(),
  },
  configuration: {
    getConfiguration: vi.fn(),
  },
  env: {
    openExternal: vi.fn(),
    clipboard: {
      writeText: vi.fn(),
      readText: vi.fn(),
    },
  },
  Uri: {
    joinPath: vi.fn(),
    parse: vi.fn((s: string) => ({ toString: () => s })),
  },
  Disposable: {
    create: vi.fn(),
  },
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdtemp: vi.fn(),
  mkdir: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
}));

import * as extensionApi from '@podman-desktop/api';
import { readFile, writeFile, mkdtemp, mkdir, rename, rm } from 'node:fs/promises';

const MOCK_CONTEXT = {
  extensionUri: { fsPath: '/fake/extension/path' },
  storagePath: '/fake/storage/path',
  subscriptions: [],
} as unknown as ExtensionContext;

function createMockConnection(type = 'podman', status = 'started') {
  return {
    connection: {
      type,
      status: () => status,
    },
  };
}

function simContainer(id: string, image: string) {
  return {
    Id: id,
    Image: image,
    Labels: { [SIM_CONTAINER_LABEL]: SIM_CONTAINER_LABEL_VALUE },
  };
}

function execArgs(callIndex = 0): string[] {
  const call = vi.mocked(extensionApi.process.exec).mock.calls[callIndex];
  expect(call?.[1]).toBeDefined();
  return call![1] as string[];
}

/**
 * Parses the JSON body of the most recent writeFile call for the build-history file.
 * #writeBuildHistory writes to a temp path (build-history.json.tmp-<pid>-<time>), then
 * atomically renames it into place — so this matches on the substring, not an exact
 * filename, and the content is captured from writeFile regardless (rename carries no
 * content of its own).
 */
function lastWrittenBuildHistory(): BuildHistoryEntry[] {
  const calls = vi.mocked(writeFile).mock.calls.filter(c => String(c[0]).includes('build-history.json'));
  expect(calls.length).toBeGreaterThan(0);
  return JSON.parse(calls[calls.length - 1][1] as string) as BuildHistoryEntry[];
}

/**
 * Wires readFile/writeFile/rename as a minimal stateful fake filesystem for
 * build-history.json only — needed for the SBOM two-phase write (record outcome, then
 * patch in the SBOM once ready), where the patch's own read must see the prior write.
 * Mirrors the real temp-file + atomic-rename write: content only becomes "readable" once
 * rename() actually moves it to the final path, not merely once writeFile() lands on the
 * temp path. The real implementation reads/writes an actual file, so this is purely a
 * test-mock gap, not production behavior.
 */
function mockStatefulBuildHistoryFile(): void {
  let stored: string | undefined;
  const pendingByTmpPath = new Map<string, string>();
  vi.mocked(writeFile).mockImplementation(async (path, content) => {
    const p = String(path);
    if (p.includes('build-history.json')) {
      pendingByTmpPath.set(p, content as string);
    }
  });
  vi.mocked(rename).mockImplementation(async (oldPath, newPath) => {
    const op = String(oldPath);
    if (String(newPath).endsWith('build-history.json') && pendingByTmpPath.has(op)) {
      stored = pendingByTmpPath.get(op);
      pendingByTmpPath.delete(op);
    }
  });
  vi.mocked(readFile).mockImplementation(async path => {
    if (String(path).endsWith('build-history.json') && stored !== undefined) {
      return stored as unknown as Awaited<ReturnType<typeof readFile>>;
    }
    throw new Error('ENOENT');
  });
}

function mockConfigWithBuildHistoryLimit(limit: unknown): void {
  vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
    get: vi.fn((key: string) => (key === 'build.historyLimit' ? limit : undefined)),
    update: vi.fn(),
  } as unknown as extensionApi.Configuration);
}

describe('PhysicalAiApiImpl', () => {
  let api: PhysicalAiApiImpl;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    api = new PhysicalAiApiImpl(MOCK_CONTEXT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getStatus', () => {
    it('returns the running status message', async () => {
      const status = await api.getStatus();
      expect(status).toBe('Physical AI extension is running');
    });
  });

  describe('listCatalogImages', () => {
    it('fetches repositories from Quay API', async () => {
      const mockRepos = [{ name: 'ros2-base' }, { name: 'ros2-sim' }];
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ repositories: mockRepos }),
      } as Response);

      const result = await api.listCatalogImages('ecosystem-appeng');
      expect(result).toEqual(mockRepos);
      expect(fetch).toHaveBeenCalledOnce();
      const url = new URL(vi.mocked(fetch).mock.calls[0][0] as string);
      expect(url.searchParams.get('namespace')).toBe('ecosystem-appeng');
      expect(url.searchParams.get('public')).toBe('true');
    });

    it('paginates through multiple pages', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ repositories: [{ name: 'repo1' }], next_page: 'page2' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ repositories: [{ name: 'repo2' }] }),
        } as Response);

      const result = await api.listCatalogImages('ns');
      expect(result).toHaveLength(2);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const secondUrl = new URL(fetchSpy.mock.calls[1][0] as string);
      expect(secondUrl.searchParams.get('next_page')).toBe('page2');
    });

    it('throws on API error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response);

      await expect(api.listCatalogImages('bad-ns')).rejects.toThrow('Quay API error: 404 Not Found');
    });
  });

  describe('getImageTags', () => {
    it('fetches tags from Quay API', async () => {
      const mockTags = [{ name: 'latest' }, { name: 'v1.0' }];
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tags: mockTags }),
      } as Response);

      const result = await api.getImageTags('ecosystem-appeng', 'ros2-base');
      expect(result).toEqual(mockTags);
      const url = new URL(vi.mocked(fetch).mock.calls[0][0] as string);
      expect(url.pathname).toContain('ecosystem-appeng/ros2-base');
      expect(url.searchParams.get('onlyActiveTags')).toBe('true');
    });

    it('throws on API error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      await expect(api.getImageTags('ns', 'img')).rejects.toThrow('Quay API error: 500');
    });

    it('rejects path-injection in namespace or repository name', async () => {
      await expect(api.getImageTags('../admin', 'ros2-base')).rejects.toThrow(/Invalid Quay/);
      await expect(api.getImageTags('ns', 'img?x=1')).rejects.toThrow(/Invalid Quay/);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('encodes path segments in the Quay URL', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tags: [] }),
      } as Response);

      await api.getImageTags('ecosystem-appeng', 'ros2-jazzy-sim');
      const url = new URL(vi.mocked(fetch).mock.calls[0][0] as string);
      expect(url.pathname).toBe('/api/v1/repository/ecosystem-appeng/ros2-jazzy-sim/tag/');
    });
  });

  describe('listLocalImages', () => {
    beforeEach(() => {
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: '',
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);
    });

    it('returns flattened RepoTags from all images', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        { RepoTags: ['quay.io/ns/img1:latest', 'quay.io/ns/img1:v1'] },
        { RepoTags: ['quay.io/ns/img2:latest'] },
      ] as unknown as extensionApi.ImageInfo[]);

      const result = await api.listLocalImages();
      expect(result).toEqual(['quay.io/ns/img1:latest', 'quay.io/ns/img1:v1', 'quay.io/ns/img2:latest']);
    });

    it('handles images with no RepoTags', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        { RepoTags: undefined },
        { RepoTags: ['quay.io/ns/img:latest'] },
      ] as unknown as extensionApi.ImageInfo[]);

      const result = await api.listLocalImages();
      expect(result).toEqual(['quay.io/ns/img:latest']);
    });

    it('falls back to Names when RepoTags is null (Podman 5)', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        {
          RepoTags: undefined,
          Names: ['quay.io/sgahlot/ros2-jazzy-base:latest'],
        },
        {
          RepoTags: undefined,
          Names: [
            'quay.io/sgahlot/ros2-humble-turtlebot3:latest',
            'quay.io/ecosystem-appeng/ros2-humble-turtlebot3:latest',
          ],
        },
      ] as unknown as extensionApi.ImageInfo[]);

      const result = await api.listLocalImages();
      expect(result).toEqual([
        'quay.io/sgahlot/ros2-jazzy-base:latest',
        'quay.io/sgahlot/ros2-humble-turtlebot3:latest',
        'quay.io/ecosystem-appeng/ros2-humble-turtlebot3:latest',
      ]);
    });

    it('merges podman CLI image list when engine tags are empty', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        { RepoTags: undefined },
        { RepoTags: [] },
      ] as unknown as extensionApi.ImageInfo[]);
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: 'quay.io/sgahlot/ros2-jazzy-base:latest\nquay.io/sgahlot/ros2-humble-turtlebot3:latest\n',
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);

      const result = await api.listLocalImages();
      expect(result).toEqual([
        'quay.io/sgahlot/ros2-jazzy-base:latest',
        'quay.io/sgahlot/ros2-humble-turtlebot3:latest',
      ]);
      expect(extensionApi.process.exec).toHaveBeenCalledWith('podman', [
        'images',
        '--format',
        '{{.Repository}}:{{.Tag}}',
      ]);
    });
  });

  describe('listLocalImagesWithArch (APPENG-6259)', () => {
    beforeEach(() => {
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: '[]',
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);
    });

    it('returns each tag with its reported Arch from the engine listing', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        { RepoTags: ['quay.io/ns/img1:noble-amd64'], Arch: 'amd64' },
        { RepoTags: ['quay.io/ns/img2:noble'], Arch: 'arm64' },
      ] as unknown as extensionApi.ImageInfo[]);

      const result = await api.listLocalImagesWithArch();
      expect(result).toEqual(
        expect.arrayContaining([
          { tag: 'quay.io/ns/img1:noble-amd64', arch: 'amd64' },
          { tag: 'quay.io/ns/img2:noble', arch: 'arm64' },
        ]),
      );
    });

    it('leaves arch undefined when the engine does not report one', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        { RepoTags: ['quay.io/ns/img:latest'] },
      ] as unknown as extensionApi.ImageInfo[]);

      const result = await api.listLocalImagesWithArch();
      expect(result).toEqual([{ tag: 'quay.io/ns/img:latest', arch: undefined }]);
    });

    it('falls back to Names when RepoTags is empty (Podman 5)', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        { RepoTags: undefined, Names: ['quay.io/ns/img:latest'], Arch: 'amd64' },
      ] as unknown as extensionApi.ImageInfo[]);

      const result = await api.listLocalImagesWithArch();
      expect(result).toEqual([{ tag: 'quay.io/ns/img:latest', arch: 'amd64' }]);
    });

    it('merges in the podman CLI JSON listing, filling in arch the engine missed', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        { RepoTags: ['quay.io/ns/img1:latest'] }, // engine has no Arch for this one
      ] as unknown as extensionApi.ImageInfo[]);
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: JSON.stringify([
          { Names: ['quay.io/ns/img1:latest'], Arch: 'amd64' },
          { Names: ['quay.io/ns/img2:latest'], Arch: 'arm64' },
        ]),
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);

      const result = await api.listLocalImagesWithArch();
      expect(result).toEqual(
        expect.arrayContaining([
          { tag: 'quay.io/ns/img1:latest', arch: 'amd64' },
          { tag: 'quay.io/ns/img2:latest', arch: 'arm64' },
        ]),
      );
      expect(result).toHaveLength(2);
      expect(extensionApi.process.exec).toHaveBeenCalledWith('podman', ['images', '--format', 'json']);
    });

    it('drops <none> tags from the CLI JSON listing', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([]);
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: JSON.stringify([{ Names: ['<none>:<none>'], Arch: 'amd64' }]),
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);

      const result = await api.listLocalImagesWithArch();
      expect(result).toEqual([]);
    });

    it('returns [] when both sources fail', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockRejectedValue(new Error('boom'));
      vi.mocked(extensionApi.process.exec).mockRejectedValue(new Error('boom'));

      const result = await api.listLocalImagesWithArch();
      expect(result).toEqual([]);
    });
  });

  describe('pullImage', () => {
    it('throws when no Podman connection found', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([]);

      await expect(api.pullImage('ns/img', 'latest')).rejects.toThrow('No running Podman connection found');
    });

    it('throws when connection is not started', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection('podman', 'stopped'),
      ] as unknown as extensionApi.ProviderContainerConnection[]);

      await expect(api.pullImage('ns/img', 'latest')).rejects.toThrow('No running Podman connection found');
    });

    it('initiates pull and sets initial progress', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.containerEngine.pullImage).mockReturnValue(new Promise(() => {}));

      await api.pullImage('ns/img', 'latest');

      const progress = await api.getPullProgress('quay.io/ns/img:latest');
      expect(progress).toEqual({ image: 'quay.io/ns/img:latest', status: 'Starting...' });
    });

    it('updates progress with layer data from callback', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);

      let pullCallback: Parameters<typeof extensionApi.containerEngine.pullImage>[2];
      vi.mocked(extensionApi.containerEngine.pullImage).mockImplementation((_conn, _img, cb) => {
        pullCallback = cb;
        return new Promise(() => {});
      });

      await api.pullImage('ns/img', 'latest');

      pullCallback!({
        id: 'layer1',
        progressDetail: { current: 512000, total: 1024000 },
        status: 'Downloading',
      });

      const progress = await api.getPullProgress('quay.io/ns/img:latest');
      expect(progress!.status).toBe('Downloading');
      expect(progress!.currentMB).toBeCloseTo(0.5, 1);
      expect(progress!.totalMB).toBeCloseTo(1.0, 1);
    });

    it('sets done on successful pull', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.containerEngine.pullImage).mockResolvedValue(undefined);

      await api.pullImage('ns/img', 'latest');
      await vi.advanceTimersByTimeAsync(0);

      const progress = await api.getPullProgress('quay.io/ns/img:latest');
      expect(progress!.done).toBe(true);
      expect(progress!.status).toBe('Complete');
    });

    it('sets error on failed pull', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.containerEngine.pullImage).mockRejectedValue(new Error('network error'));

      await api.pullImage('ns/img', 'latest');
      await vi.advanceTimersByTimeAsync(0);

      const progress = await api.getPullProgress('quay.io/ns/img:latest');
      expect(progress!.done).toBe(true);
      expect(progress!.error).toBe('network error');
    });

    it('cleans up progress after 30s', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.containerEngine.pullImage).mockResolvedValue(undefined);

      await api.pullImage('ns/img', 'latest');
      await vi.advanceTimersByTimeAsync(0);

      expect(await api.getPullProgress('quay.io/ns/img:latest')).not.toBeUndefined();
      await vi.advanceTimersByTimeAsync(30000);
      expect(await api.getPullProgress('quay.io/ns/img:latest')).toBeUndefined();
    });
  });

  describe('getPullProgress', () => {
    it('returns undefined for unknown image', async () => {
      expect(await api.getPullProgress('nonexistent')).toBeUndefined();
    });
  });

  describe('pullImageByRef', () => {
    it('pulls an arbitrary registry ref verbatim (no quay.io prefix)', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.containerEngine.pullImage).mockReturnValue(new Promise(() => {}));

      await api.pullImageByRef('docker.io/library/ubuntu:24.04');

      expect(extensionApi.containerEngine.pullImage).toHaveBeenCalledWith(
        expect.anything(),
        'docker.io/library/ubuntu:24.04',
        expect.any(Function),
      );
      const progress = await api.getPullProgress('docker.io/library/ubuntu:24.04');
      expect(progress).toEqual({ image: 'docker.io/library/ubuntu:24.04', status: 'Starting...' });
    });

    it('rejects an invalid reference before touching the container engine', async () => {
      await expect(api.pullImageByRef('  ')).rejects.toThrow(/Invalid image reference/);
      await expect(api.pullImageByRef('bad ref with spaces')).rejects.toThrow(/Invalid image reference/);
      expect(extensionApi.containerEngine.pullImage).not.toHaveBeenCalled();
    });

    it('throws when no Podman connection found', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([]);

      await expect(api.pullImageByRef('registry.redhat.io/rhel10/rhel-bootc:latest')).rejects.toThrow(
        'No running Podman connection found',
      );
    });
  });

  describe('buildFromContainerfile', () => {
    it('rejects an empty Containerfile without touching disk or the engine', async () => {
      await expect(api.buildFromContainerfile('my-tag:latest', '   ')).rejects.toThrow(/Containerfile is empty/);
      expect(mkdtemp).not.toHaveBeenCalled();
      expect(extensionApi.containerEngine.buildImage).not.toHaveBeenCalled();
    });

    it('writes the Containerfile to a throwaway context and builds with the containerFile option', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(mkdtemp).mockResolvedValue('/tmp/physical-ai-layer-build-abc');
      vi.mocked(writeFile).mockResolvedValue(undefined);
      vi.mocked(extensionApi.containerEngine.buildImage).mockReturnValue(new Promise(() => {}));

      const containerfile = 'FROM docker.io/library/ubuntu:24.04\n';
      await api.buildFromContainerfile('my-layer:latest', containerfile);

      expect(writeFile).toHaveBeenCalledWith('/tmp/physical-ai-layer-build-abc/Containerfile', containerfile, 'utf8');
      expect(extensionApi.containerEngine.buildImage).toHaveBeenCalledWith(
        '/tmp/physical-ai-layer-build-abc',
        expect.any(Function),
        expect.objectContaining({ containerFile: 'Containerfile', tag: 'my-layer:latest' }),
      );
    });

    it('passes the platform through to the build', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(mkdtemp).mockResolvedValue('/tmp/physical-ai-layer-build-def');
      vi.mocked(writeFile).mockResolvedValue(undefined);
      vi.mocked(extensionApi.containerEngine.buildImage).mockReturnValue(new Promise(() => {}));

      await api.buildFromContainerfile('my-layer:latest', 'FROM scratch\n', 'linux/arm64');

      expect(extensionApi.containerEngine.buildImage).toHaveBeenCalledWith(
        '/tmp/physical-ai-layer-build-def',
        expect.any(Function),
        expect.objectContaining({ platform: 'linux/arm64' }),
      );
    });

    it('removes the throwaway context and rethrows when no Podman connection is available', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([]);
      vi.mocked(mkdtemp).mockResolvedValue('/tmp/physical-ai-layer-build-ghi');
      vi.mocked(writeFile).mockResolvedValue(undefined);
      vi.mocked(rm).mockResolvedValue(undefined);

      await expect(api.buildFromContainerfile('my-layer:latest', 'FROM scratch\n')).rejects.toThrow(
        'No running Podman connection found',
      );
      expect(rm).toHaveBeenCalledWith('/tmp/physical-ai-layer-build-ghi', { recursive: true, force: true });
      expect(extensionApi.containerEngine.buildImage).not.toHaveBeenCalled();
    });

    it('cleans up the throwaway context once the build settles', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(mkdtemp).mockResolvedValue('/tmp/physical-ai-layer-build-jkl');
      vi.mocked(writeFile).mockResolvedValue(undefined);
      vi.mocked(rm).mockResolvedValue(undefined);
      vi.mocked(extensionApi.containerEngine.buildImage).mockResolvedValue(undefined);

      await api.buildFromContainerfile('my-layer:latest', 'FROM scratch\n');
      await vi.advanceTimersByTimeAsync(0);

      expect(rm).toHaveBeenCalledWith('/tmp/physical-ai-layer-build-jkl', { recursive: true, force: true });
    });
  });

  describe('build history (APPENG-6226)', () => {
    beforeEach(() => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(mkdtemp).mockResolvedValue('/tmp/physical-ai-layer-build-hist');
      vi.mocked(rm).mockResolvedValue(undefined);
      mockConfigWithBuildHistoryLimit(undefined);
    });

    it('records a completed base-image build (no sbom — base/sim builds never opt in)', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({ fsPath: '/fake/assets' } as unknown as extensionApi.Uri);
      vi.mocked(extensionApi.containerEngine.buildImage).mockResolvedValue(undefined);

      await api.buildBaseImage('my-tag:latest', {
        robot: 'turtlebot3',
        distro: 'humble',
        middleware: 'dds',
        engine: 'gazebo',
        baseImage: 'sloretz' as const,
        targetArch: 'amd64',
      });
      await vi.runAllTimersAsync();

      const history = lastWrittenBuildHistory();
      expect(history).toHaveLength(1);
      expect(history[0]).toEqual(expect.objectContaining({ tag: 'my-tag:latest', arch: 'amd64', success: true }));
      expect(history[0].sbom).toBeUndefined();
      expect(history[0].errorMessage).toBeUndefined();
      // Base-image builds never invoke syft.
      expect(extensionApi.process.exec).not.toHaveBeenCalledWith('podman', expect.arrayContaining(['syft']));
    });

    it('records a failed build with an error message', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({ fsPath: '/fake/assets' } as unknown as extensionApi.Uri);
      vi.mocked(extensionApi.containerEngine.buildImage).mockRejectedValue(new Error('build failed'));

      await api.buildBaseImage('my-tag:latest', {
        robot: 'turtlebot3',
        distro: 'humble',
        middleware: 'dds',
        engine: 'gazebo',
        baseImage: 'sloretz' as const,
      });
      await vi.runAllTimersAsync();

      const history = lastWrittenBuildHistory();
      expect(history[0]).toEqual(
        expect.objectContaining({ tag: 'my-tag:latest', success: false, errorMessage: 'build failed' }),
      );
      expect(history[0].sbom).toBeUndefined();
    });

    it('does not record a cancelled build', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({ fsPath: '/fake/assets' } as unknown as extensionApi.Uri);
      vi.mocked(extensionApi.containerEngine.buildImage).mockReturnValue(new Promise(() => {}));

      await api.buildBaseImage('my-tag:latest', {
        robot: 'turtlebot3',
        distro: 'humble',
        middleware: 'dds',
        engine: 'gazebo',
        baseImage: 'sloretz' as const,
      });
      await api.cancelBuild('my-tag:latest');
      await vi.runAllTimersAsync();

      expect(writeFile).not.toHaveBeenCalledWith(
        expect.stringContaining('build-history.json'),
        expect.anything(),
        expect.anything(),
      );
    });

    it('buildFromContainerfile with generateSbom:true defaults to cyclonedx-json and records the format', async () => {
      mockStatefulBuildHistoryFile();
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.containerEngine.buildImage).mockResolvedValue(undefined);
      const sbomJson = JSON.stringify({ components: [{ name: 'comp-a' }] });
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: sbomJson,
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);

      await api.buildFromContainerfile('my-layer:latest', 'FROM scratch\n', undefined, { generateSbom: true });
      await vi.runAllTimersAsync();

      expect(extensionApi.process.exec).toHaveBeenCalledWith('podman', [
        'run',
        '--rm',
        'my-layer:latest',
        'syft',
        'dir:/',
        '-o',
        'cyclonedx-json',
        '--select-catalogers',
        '-file',
      ]);
      const history = lastWrittenBuildHistory();
      expect(history[0].sbom).toBe(sbomJson);
      expect(history[0].sbomFormat).toBe('cyclonedx-json');
      expect(history[0].sbomPackageCount).toBe(1);
      expect(history[0].success).toBe(true);
    });

    it('buildFromContainerfile with an explicit sbomFormat:"spdx-json" runs syft with that format', async () => {
      mockStatefulBuildHistoryFile();
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.containerEngine.buildImage).mockResolvedValue(undefined);
      const sbomJson = JSON.stringify({ packages: [{ name: 'pkg-a' }] });
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: sbomJson,
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);

      await api.buildFromContainerfile('my-layer:latest', 'FROM scratch\n', undefined, {
        generateSbom: true,
        sbomFormat: 'spdx-json',
      });
      await vi.runAllTimersAsync();

      expect(extensionApi.process.exec).toHaveBeenCalledWith('podman', [
        'run',
        '--rm',
        'my-layer:latest',
        'syft',
        'dir:/',
        '-o',
        'spdx-json',
        '--select-catalogers',
        '-file',
      ]);
      const history = lastWrittenBuildHistory();
      expect(history[0].sbom).toBe(sbomJson);
      expect(history[0].sbomFormat).toBe('spdx-json');
    });

    it('SBOM generation failure leaves the sbom field absent without failing the build', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.containerEngine.buildImage).mockResolvedValue(undefined);
      vi.mocked(extensionApi.process.exec).mockRejectedValue(new Error('syft: command not found'));

      await api.buildFromContainerfile('my-layer:latest', 'FROM scratch\n', undefined, { generateSbom: true });
      await vi.runAllTimersAsync();

      const history = lastWrittenBuildHistory();
      expect(history[0].success).toBe(true);
      expect(history[0].sbom).toBeUndefined();
    });

    it('buildFromContainerfile without generateSbom never invokes syft and records no sbom', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.containerEngine.buildImage).mockResolvedValue(undefined);

      await api.buildFromContainerfile('my-layer:latest', 'FROM scratch\n');
      await vi.runAllTimersAsync();

      expect(extensionApi.process.exec).not.toHaveBeenCalled();
      const history = lastWrittenBuildHistory();
      expect(history[0].sbom).toBeUndefined();
    });

    it('writes build history via a temp file + atomic rename, not a direct write to the live path', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.containerEngine.buildImage).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);
      vi.mocked(rename).mockResolvedValue(undefined);

      await api.buildFromContainerfile('my-layer:latest', 'FROM scratch\n');
      await vi.runAllTimersAsync();

      const historyWrite = vi.mocked(writeFile).mock.calls.find(c => String(c[0]).includes('build-history.json'));
      expect(historyWrite).toBeDefined();
      const tmpPath = String(historyWrite![0]);
      // The write must NOT land on the live path directly — a concurrent poll reading
      // build-history.json while this write is in flight would otherwise risk a
      // truncated/partial read (observed live as a "No builds recorded yet" flash).
      expect(tmpPath).not.toBe(`${MOCK_CONTEXT.storagePath}/build-history.json`);
      expect(tmpPath).toContain('build-history.json.tmp-');

      expect(rename).toHaveBeenCalledWith(tmpPath, `${MOCK_CONTEXT.storagePath}/build-history.json`);
    });

    it('records the build outcome immediately, without waiting for a slow SBOM scan', async () => {
      mockStatefulBuildHistoryFile();
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.containerEngine.buildImage).mockResolvedValue(undefined);

      let resolveSyft!: (v: extensionApi.RunResult) => void;
      vi.mocked(extensionApi.process.exec).mockReturnValue(
        new Promise(resolve => {
          resolveSyft = resolve;
        }),
      );

      await api.buildFromContainerfile('my-layer:latest', 'FROM scratch\n', undefined, { generateSbom: true });
      await vi.runAllTimersAsync();

      // The build's own outcome (success/duration) is visible right away — the slow SBOM
      // scan (still pending) must not have delayed it.
      const beforeSbom = lastWrittenBuildHistory();
      expect(beforeSbom[0].success).toBe(true);
      expect(beforeSbom[0].sbom).toBeUndefined();

      const sbomJson = JSON.stringify({ components: [{ name: 'comp-a' }] });
      resolveSyft({ stdout: sbomJson, stderr: '', command: 'podman' } as extensionApi.RunResult);
      await vi.runAllTimersAsync();

      // Once the scan finishes, the same entry is patched in place with the SBOM.
      const afterSbom = lastWrittenBuildHistory();
      expect(afterSbom).toHaveLength(1);
      expect(afterSbom[0].sbom).toBe(sbomJson);
      expect(afterSbom[0].success).toBe(true);
    });

    it('resolves arch amd64/arm64 from the platform, defaulting to host arch when unset', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.containerEngine.buildImage).mockResolvedValue(undefined);

      await api.buildFromContainerfile('t1:latest', 'FROM scratch\n', 'linux/amd64');
      await vi.runAllTimersAsync();
      expect(lastWrittenBuildHistory()[0].arch).toBe('amd64');

      vi.mocked(mkdtemp).mockResolvedValue('/tmp/physical-ai-layer-build-hist2');
      await api.buildFromContainerfile('t2:latest', 'FROM scratch\n', 'linux/arm64');
      await vi.runAllTimersAsync();
      expect(lastWrittenBuildHistory()[0].arch).toBe('arm64');

      vi.mocked(mkdtemp).mockResolvedValue('/tmp/physical-ai-layer-build-hist3');
      await api.buildFromContainerfile('t3:latest', 'FROM scratch\n');
      await vi.runAllTimersAsync();
      expect(lastWrittenBuildHistory()[0].arch).toBe(process.arch === 'arm64' ? 'arm64' : 'amd64');
    });

    it('trims history to the configured limit, dropping the oldest entries', async () => {
      mockConfigWithBuildHistoryLimit(2);
      const seeded = JSON.stringify([
        { tag: 'older:1', arch: 'amd64', startedAt: 1, durationMs: 1, success: true },
        { tag: 'older:2', arch: 'amd64', startedAt: 2, durationMs: 1, success: true },
      ]);
      vi.mocked(readFile).mockResolvedValue(seeded as unknown as Awaited<ReturnType<typeof readFile>>);
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.containerEngine.buildImage).mockResolvedValue(undefined);

      await api.buildFromContainerfile('newest:latest', 'FROM scratch\n');
      await vi.runAllTimersAsync();

      const history = lastWrittenBuildHistory();
      expect(history).toHaveLength(2);
      expect(history[0].tag).toBe('newest:latest');
      expect(history.map(h => h.tag)).not.toContain('older:2');
    });
  });

  describe('getBuildHistory', () => {
    it('returns [] when the history file does not exist', async () => {
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
      expect(await api.getBuildHistory()).toEqual([]);
    });

    it('returns [] when the history file is corrupt', async () => {
      vi.mocked(readFile).mockResolvedValue('not json' as unknown as Awaited<ReturnType<typeof readFile>>);
      expect(await api.getBuildHistory()).toEqual([]);
    });

    it('returns the parsed history when the file is valid', async () => {
      const entries = [{ tag: 'a:latest', arch: 'amd64', startedAt: 1, durationMs: 1, success: true }];
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(entries) as unknown as Awaited<ReturnType<typeof readFile>>);
      expect(await api.getBuildHistory()).toEqual(entries);
    });

    it('strips the sbom text from the polled list but keeps sbomPackageCount (APPENG-6265)', async () => {
      mockStatefulBuildHistoryFile();
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(mkdtemp).mockResolvedValue('/tmp/physical-ai-layer-build-6265a');
      vi.mocked(rm).mockResolvedValue(undefined);
      mockConfigWithBuildHistoryLimit(undefined);
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.containerEngine.buildImage).mockResolvedValue(undefined);
      const sbomJson = JSON.stringify({ components: [{ name: 'comp-a' }, { name: 'comp-b' }] });
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: sbomJson,
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);

      await api.buildFromContainerfile('my-layer:latest', 'FROM scratch\n', undefined, { generateSbom: true });
      await vi.runAllTimersAsync();

      const list = await api.getBuildHistory();
      expect(list[0].sbom).toBeUndefined();
      expect(list[0].sbomPackageCount).toBe(2);
      expect(list[0].sbomFormat).toBe('cyclonedx-json');
    });
  });

  describe('getBuildHistorySbom', () => {
    it('returns the full SBOM text for a matching entry, on demand', async () => {
      mockStatefulBuildHistoryFile();
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(mkdtemp).mockResolvedValue('/tmp/physical-ai-layer-build-6265b');
      vi.mocked(rm).mockResolvedValue(undefined);
      mockConfigWithBuildHistoryLimit(undefined);
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.containerEngine.buildImage).mockResolvedValue(undefined);
      const sbomJson = JSON.stringify({ components: [{ name: 'comp-a' }] });
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: sbomJson,
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);

      await api.buildFromContainerfile('my-layer:latest', 'FROM scratch\n', undefined, { generateSbom: true });
      await vi.runAllTimersAsync();

      const [entry] = await api.getBuildHistory();
      expect(await api.getBuildHistorySbom(entry.tag, entry.startedAt)).toBe(sbomJson);
    });

    it('returns undefined when no entry matches', async () => {
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
      expect(await api.getBuildHistorySbom('missing:tag', 123)).toBeUndefined();
    });
  });

  describe('getBuildHistoryLimit / setBuildHistoryLimit', () => {
    it('returns the default (5) when unset', async () => {
      mockConfigWithBuildHistoryLimit(undefined);
      expect(await api.getBuildHistoryLimit()).toBe(5);
    });

    it('falls back to the default when the stored value is out of range', async () => {
      mockConfigWithBuildHistoryLimit(99);
      expect(await api.getBuildHistoryLimit()).toBe(5);
    });

    it('returns a valid configured limit', async () => {
      mockConfigWithBuildHistoryLimit(2);
      expect(await api.getBuildHistoryLimit()).toBe(2);
    });

    it('rejects a set below the minimum', async () => {
      const update = vi.fn();
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn(),
        update,
      } as unknown as extensionApi.Configuration);
      await expect(api.setBuildHistoryLimit(0)).rejects.toThrow(/at least 1/);
      expect(update).not.toHaveBeenCalled();
    });

    it('rejects a set above the maximum', async () => {
      const update = vi.fn();
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn(),
        update,
      } as unknown as extensionApi.Configuration);
      await expect(api.setBuildHistoryLimit(21)).rejects.toThrow(/at most 20/);
      expect(update).not.toHaveBeenCalled();
    });

    it('persists a valid limit', async () => {
      const update = vi.fn().mockResolvedValue(undefined);
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn(),
        update,
      } as unknown as extensionApi.Configuration);
      await api.setBuildHistoryLimit(3);
      expect(update).toHaveBeenCalledWith('build.historyLimit', 3);
    });
  });

  describe('buildBaseImage', () => {
    const baseConfig = {
      robot: 'turtlebot3',
      distro: 'humble',
      middleware: 'dds',
      engine: 'gazebo',
      baseImage: 'sloretz' as const,
    };

    it('throws when no Podman connection found', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([]);

      await expect(api.buildBaseImage('my-tag:latest', baseConfig)).rejects.toThrow(
        'No running Podman connection found',
      );
    });

    it('rejects unsupported wizard combinations', async () => {
      await expect(api.buildBaseImage('my-tag:latest', { ...baseConfig, distro: 'rolling' })).rejects.toThrow(
        /No base image profile for rolling\/turtlebot3\/dds\/gazebo/,
      );
      expect(extensionApi.containerEngine.buildImage).not.toHaveBeenCalled();
    });

    it('builds jazzy base image with correct asset dir and build-arg', async () => {
      const mockConnection = createMockConnection();
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        mockConnection,
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({
        fsPath: '/fake/assets/ros2-jazzy-base',
      } as unknown as extensionApi.Uri);
      vi.mocked(extensionApi.containerEngine.buildImage).mockReturnValue(new Promise(() => {}));

      await api.buildBaseImage('my-tag:latest', { ...baseConfig, distro: 'jazzy', baseImage: 'jazzy' });

      expect(extensionApi.Uri.joinPath).toHaveBeenCalledWith(MOCK_CONTEXT.extensionUri, 'assets', 'ros2-jazzy-base');
      expect(extensionApi.containerEngine.buildImage).toHaveBeenCalledWith(
        '/fake/assets/ros2-jazzy-base',
        expect.any(Function),
        expect.objectContaining({
          buildargs: {
            ROS_BASE_IMAGE:
              'docker.io/library/ros:jazzy-ros-base@sha256:31daab66eef9139933379fb67159449944f4e2dcf2e22c2d12cc715f29873e0f',
          },
        }),
      );
    });

    it('passes linux/amd64 platform when targetArch is amd64 (cross-build)', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({ fsPath: '/fake/assets' } as unknown as extensionApi.Uri);
      vi.mocked(extensionApi.containerEngine.buildImage).mockReturnValue(new Promise(() => {}));

      await api.buildBaseImage('my-tag:noble-amd64', { ...baseConfig, targetArch: 'amd64' });

      expect(extensionApi.containerEngine.buildImage).toHaveBeenCalledWith(
        '/fake/assets',
        expect.any(Function),
        expect.objectContaining({ platform: 'linux/amd64' }),
      );
    });

    it('omits platform for a host-native build (no targetArch)', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({ fsPath: '/fake/assets' } as unknown as extensionApi.Uri);
      vi.mocked(extensionApi.containerEngine.buildImage).mockReturnValue(new Promise(() => {}));

      await api.buildBaseImage('my-tag:latest', baseConfig);

      const opts = vi.mocked(extensionApi.containerEngine.buildImage).mock.calls[0][2] as Record<string, unknown>;
      expect(opts.platform).toBeUndefined();
    });

    it('initiates build and sets initial progress', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({ fsPath: '/fake/assets' } as unknown as extensionApi.Uri);
      vi.mocked(extensionApi.containerEngine.buildImage).mockReturnValue(new Promise(() => {}));

      await api.buildBaseImage('my-tag:latest', baseConfig);

      const progress = await api.getBuildProgress('my-tag:latest');
      expect(progress).toEqual({
        tag: 'my-tag:latest',
        status: 'Starting...',
        logs: [],
        startedAt: expect.any(Number),
      });
    });

    it('parses STEP N/M from stream events', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({ fsPath: '/fake/assets' } as unknown as extensionApi.Uri);

      let buildCallback: Parameters<typeof extensionApi.containerEngine.buildImage>[1];
      vi.mocked(extensionApi.containerEngine.buildImage).mockImplementation((_ctx, cb, _opts) => {
        buildCallback = cb;
        return new Promise(() => {});
      });

      await api.buildBaseImage('my-tag:latest', baseConfig);

      buildCallback!('stream', 'STEP 3/8: RUN apt-get update');

      const progress = await api.getBuildProgress('my-tag:latest');
      expect(progress!.currentStep).toBe(3);
      expect(progress!.totalSteps).toBe(8);
      expect(progress!.status).toBe('Building... Step 3/8');
      expect(progress!.logs.some(l => l.includes('STEP 3/8: RUN apt-get update'))).toBe(true);
    });

    it('records error events', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({ fsPath: '/fake/assets' } as unknown as extensionApi.Uri);

      let buildCallback: Parameters<typeof extensionApi.containerEngine.buildImage>[1];
      vi.mocked(extensionApi.containerEngine.buildImage).mockImplementation((_ctx, cb, _opts) => {
        buildCallback = cb;
        return new Promise(() => {});
      });

      await api.buildBaseImage('my-tag:latest', baseConfig);
      buildCallback!('error', 'something broke');

      const progress = await api.getBuildProgress('my-tag:latest');
      expect(progress!.error).toBe('something broke');
      expect(progress!.logs.some(l => l.includes('ERROR: something broke'))).toBe(true);
    });

    it('sets done on successful build', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({ fsPath: '/fake/assets' } as unknown as extensionApi.Uri);
      vi.mocked(extensionApi.containerEngine.buildImage).mockResolvedValue(undefined);

      await api.buildBaseImage('my-tag:latest', baseConfig);
      await vi.advanceTimersByTimeAsync(0);

      const progress = await api.getBuildProgress('my-tag:latest');
      expect(progress!.done).toBe(true);
      expect(progress!.status).toBe('Complete');
    });

    it('sets error on failed build', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({ fsPath: '/fake/assets' } as unknown as extensionApi.Uri);
      vi.mocked(extensionApi.containerEngine.buildImage).mockRejectedValue(new Error('build failed'));

      await api.buildBaseImage('my-tag:latest', baseConfig);
      await vi.advanceTimersByTimeAsync(0);

      const progress = await api.getBuildProgress('my-tag:latest');
      expect(progress!.done).toBe(true);
      expect(progress!.error).toBe('build failed');
    });

    it('passes correct build options with ROS_BASE_IMAGE build-arg', async () => {
      const mockConnection = createMockConnection();
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        mockConnection,
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({
        fsPath: '/fake/assets/ros2-humble-base',
      } as unknown as extensionApi.Uri);
      vi.mocked(extensionApi.containerEngine.buildImage).mockReturnValue(new Promise(() => {}));

      await api.buildBaseImage('my-tag:latest', baseConfig);

      expect(extensionApi.Uri.joinPath).toHaveBeenCalledWith(MOCK_CONTEXT.extensionUri, 'assets', 'ros2-humble-base');
      expect(extensionApi.containerEngine.buildImage).toHaveBeenCalledWith(
        '/fake/assets/ros2-humble-base',
        expect.any(Function),
        expect.objectContaining({
          containerFile: 'Containerfile',
          tag: 'my-tag:latest',
          provider: mockConnection.connection,
          abortController: expect.any(AbortController),
          buildargs: {
            ROS_BASE_IMAGE:
              'ghcr.io/sloretz/ros:humble-desktop@sha256:970146e40f7aaa818c5783e28ed5302489bc72f61efe92438a1613fcf90b7d5c',
          },
        }),
      );
    });

    it('cancelBuild marks the build cancelled immediately without waiting for Podman', async () => {
      const mockConnection = createMockConnection();
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        mockConnection,
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({ fsPath: '/fake/assets' } as unknown as extensionApi.Uri);

      let aborted = false;
      vi.mocked(extensionApi.containerEngine.buildImage).mockImplementation(
        (_ctx, _cb, opts) =>
          new Promise(() => {
            opts?.abortController?.signal.addEventListener('abort', () => {
              aborted = true;
            });
          }),
      );

      await api.buildBaseImage('my-tag:latest', baseConfig);
      await api.cancelBuild('my-tag:latest');

      const progress = await api.getBuildProgress('my-tag:latest');
      expect(aborted).toBe(true);
      expect(progress!.cancelled).toBe(true);
      expect(progress!.done).toBe(true);
      expect(progress!.status).toBe('Cancelled');
      expect(progress!.error).toBe('Build cancelled');
    });

    it('marks build complete on finish event even if the Promise has not settled', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({ fsPath: '/fake/assets' } as unknown as extensionApi.Uri);

      let buildCallback: Parameters<typeof extensionApi.containerEngine.buildImage>[1];
      vi.mocked(extensionApi.containerEngine.buildImage).mockImplementation((_ctx, cb, _opts) => {
        buildCallback = cb;
        return new Promise(() => {});
      });

      await api.buildBaseImage('my-tag:latest', baseConfig);
      buildCallback!('stream', 'STEP 7/17: RUN apt-get update');
      buildCallback!('finish', '');

      const progress = await api.getBuildProgress('my-tag:latest');
      expect(progress!.done).toBe(true);
      expect(progress!.status).toBe('Complete');
      expect(progress!.currentStep).toBe(17);
      expect(progress!.totalSteps).toBe(17);
    });
  });

  describe('buildSimulationImage', () => {
    const supportedConfig = {
      robot: 'turtlebot3',
      distro: 'humble',
      middleware: 'dds',
      engine: 'gazebo',
      baseImage: 'sloretz' as const,
    };

    it('builds from the turtlebot3 simulation asset directory with LOCAL_BASE_IMAGE build-arg', async () => {
      const mockConnection = createMockConnection();
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        mockConnection,
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({
        fsPath: '/fake/assets/ros2-humble-turtlebot3',
      } as unknown as extensionApi.Uri);
      vi.mocked(extensionApi.containerEngine.buildImage).mockReturnValue(new Promise(() => {}));
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue('ecosystem-appeng'),
      } as unknown as extensionApi.Configuration);

      await api.buildSimulationImage('sim-tag:latest', supportedConfig);

      expect(extensionApi.Uri.joinPath).toHaveBeenCalledWith(
        MOCK_CONTEXT.extensionUri,
        'assets',
        'ros2-humble-turtlebot3',
      );
      expect(extensionApi.containerEngine.buildImage).toHaveBeenCalledWith(
        '/fake/assets/ros2-humble-turtlebot3',
        expect.any(Function),
        expect.objectContaining({
          containerFile: 'Containerfile',
          tag: 'sim-tag:latest',
          provider: mockConnection.connection,
          abortController: expect.any(AbortController),
          buildargs: {
            LOCAL_BASE_IMAGE: 'quay.io/ecosystem-appeng/ros2-humble-base:sloretz',
          },
        }),
      );
    });

    it('computes LOCAL_BASE_IMAGE tag from osrf preset', async () => {
      const mockConnection = createMockConnection();
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        mockConnection,
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({
        fsPath: '/fake/assets/ros2-humble-turtlebot3',
      } as unknown as extensionApi.Uri);
      vi.mocked(extensionApi.containerEngine.buildImage).mockReturnValue(new Promise(() => {}));
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue('ecosystem-appeng'),
      } as unknown as extensionApi.Configuration);

      await api.buildSimulationImage('sim-tag:osrf', {
        ...supportedConfig,
        baseImage: 'osrf',
      });

      expect(extensionApi.containerEngine.buildImage).toHaveBeenCalledWith(
        '/fake/assets/ros2-humble-turtlebot3',
        expect.any(Function),
        expect.objectContaining({
          buildargs: {
            LOCAL_BASE_IMAGE: 'quay.io/ecosystem-appeng/ros2-humble-base:osrf',
          },
        }),
      );
    });

    it('rejects unsupported wizard combinations', async () => {
      await expect(
        api.buildSimulationImage('sim-tag:latest', { ...supportedConfig, distro: 'rolling' }),
      ).rejects.toThrow(/No simulation image available for rolling\/turtlebot3\/dds\/gazebo/);
      expect(extensionApi.containerEngine.buildImage).not.toHaveBeenCalled();
    });

    it('builds jazzy simulation image with LOCAL_BASE_IMAGE :noble', async () => {
      const mockConnection = createMockConnection();
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        mockConnection,
      ] as unknown as extensionApi.ProviderContainerConnection[]);
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue('ecosystem-appeng'),
      } as unknown as extensionApi.Configuration);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({
        fsPath: '/fake/assets/ros2-jazzy-sim',
      } as unknown as extensionApi.Uri);
      vi.mocked(extensionApi.containerEngine.buildImage).mockReturnValue(new Promise(() => {}));

      await api.buildSimulationImage('sim-tag:noble', {
        ...supportedConfig,
        distro: 'jazzy',
        baseImage: 'jazzy-noble',
      });

      expect(extensionApi.containerEngine.buildImage).toHaveBeenCalledWith(
        '/fake/assets/ros2-jazzy-sim',
        expect.any(Function),
        expect.objectContaining({
          buildargs: {
            LOCAL_BASE_IMAGE: 'quay.io/ecosystem-appeng/ros2-jazzy-base:noble',
          },
        }),
      );
    });
  });

  describe('getBuildProgress', () => {
    it('returns undefined for unknown tag', async () => {
      expect(await api.getBuildProgress('nonexistent')).toBeUndefined();
    });
  });

  describe('pushImage', () => {
    it('throws when image not found locally', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([]);

      await expect(api.pushImage('nonexistent:latest')).rejects.toThrow('Image not found locally: nonexistent:latest');
    });

    it('initiates push and sets initial progress', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        { engineId: 'eng1', RepoTags: ['my-img:latest'] },
      ] as unknown as extensionApi.ImageInfo[]);
      vi.mocked(extensionApi.containerEngine.pushImage).mockReturnValue(new Promise(() => {}));

      await api.pushImage('my-img:latest');

      const progress = await api.getPushProgress('my-img:latest');
      expect(progress).toEqual({
        tag: 'my-img:latest',
        status: 'Pushing...',
        logs: [],
        startedAt: expect.any(Number),
      });
    });

    it('passes engineId, tag, and AbortController to pushImage', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        { engineId: 'eng1', RepoTags: ['my-img:latest'] },
      ] as unknown as extensionApi.ImageInfo[]);
      vi.mocked(extensionApi.containerEngine.pushImage).mockReturnValue(new Promise(() => {}));

      await api.pushImage('my-img:latest');

      expect(extensionApi.containerEngine.pushImage).toHaveBeenCalledWith(
        'eng1',
        'my-img:latest',
        expect.any(Function),
        undefined,
        expect.any(AbortController),
      );
    });

    it('cancelPush marks the push cancelled immediately and aborts', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        { engineId: 'eng1', RepoTags: ['my-img:latest'] },
      ] as unknown as extensionApi.ImageInfo[]);

      let aborted = false;
      vi.mocked(extensionApi.containerEngine.pushImage).mockImplementation(
        (
          _eng: string,
          _tag: string,
          _cb: Parameters<typeof extensionApi.containerEngine.pushImage>[2],
          _auth: unknown,
          abortController?: AbortController,
        ) =>
          new Promise(() => {
            abortController?.signal.addEventListener('abort', () => {
              aborted = true;
            });
          }),
      );

      await api.pushImage('my-img:latest');
      await api.cancelPush('my-img:latest');

      const progress = await api.getPushProgress('my-img:latest');
      expect(aborted).toBe(true);
      expect(progress!.cancelled).toBe(true);
      expect(progress!.done).toBe(true);
      expect(progress!.status).toBe('Cancelled');
      expect(progress!.error).toBe('Push cancelled');
    });

    it('parses JSON status from callback data', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        { engineId: 'eng1', RepoTags: ['my-img:latest'] },
      ] as unknown as extensionApi.ImageInfo[]);

      let pushCallback: Parameters<typeof extensionApi.containerEngine.pushImage>[2];
      vi.mocked(extensionApi.containerEngine.pushImage).mockImplementation((_eng, _tag, cb) => {
        pushCallback = cb;
        return new Promise(() => {});
      });

      await api.pushImage('my-img:latest');
      pushCallback!('data', '{"status":"Pushing layer abc123"}');

      const progress = await api.getPushProgress('my-img:latest');
      expect(progress!.status).toBe('Pushing layer abc123');
      expect(progress!.logs.some(l => l.includes('Pushing layer abc123'))).toBe(true);
    });

    it('handles multi-line callback data', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        { engineId: 'eng1', RepoTags: ['my-img:latest'] },
      ] as unknown as extensionApi.ImageInfo[]);

      let pushCallback: Parameters<typeof extensionApi.containerEngine.pushImage>[2];
      vi.mocked(extensionApi.containerEngine.pushImage).mockImplementation((_eng, _tag, cb) => {
        pushCallback = cb;
        return new Promise(() => {});
      });

      await api.pushImage('my-img:latest');
      pushCallback!('data', '{"status":"line1"}\n{"status":"line2"}');

      const progress = await api.getPushProgress('my-img:latest');
      expect(progress!.logs).toHaveLength(2);
      expect(progress!.logs[0]).toMatch(/line1$/);
      expect(progress!.logs[1]).toMatch(/line2$/);
      expect(progress!.status).toBe('line2');
    });

    it('ignores end and first-message events', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        { engineId: 'eng1', RepoTags: ['my-img:latest'] },
      ] as unknown as extensionApi.ImageInfo[]);

      let pushCallback: Parameters<typeof extensionApi.containerEngine.pushImage>[2];
      vi.mocked(extensionApi.containerEngine.pushImage).mockImplementation((_eng, _tag, cb) => {
        pushCallback = cb;
        return new Promise(() => {});
      });

      await api.pushImage('my-img:latest');
      pushCallback!('end', '');
      pushCallback!('first-message', '');

      const progress = await api.getPushProgress('my-img:latest');
      expect(progress!.logs).toHaveLength(0);
    });

    it('sets done on successful push', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        { engineId: 'eng1', RepoTags: ['my-img:latest'] },
      ] as unknown as extensionApi.ImageInfo[]);
      vi.mocked(extensionApi.containerEngine.pushImage).mockResolvedValue(undefined);

      await api.pushImage('my-img:latest');
      await vi.advanceTimersByTimeAsync(0);

      const progress = await api.getPushProgress('my-img:latest');
      expect(progress!.done).toBe(true);
      expect(progress!.status).toBe('Complete');
    });

    it('sets error on failed push', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        { engineId: 'eng1', RepoTags: ['my-img:latest'] },
      ] as unknown as extensionApi.ImageInfo[]);
      vi.mocked(extensionApi.containerEngine.pushImage).mockRejectedValue(new Error('auth failed'));

      await api.pushImage('my-img:latest');
      await vi.advanceTimersByTimeAsync(0);

      const progress = await api.getPushProgress('my-img:latest');
      expect(progress!.done).toBe(true);
      expect(progress!.error).toBe('auth failed');
    });
  });

  describe('getPushProgress', () => {
    it('returns undefined for unknown tag', async () => {
      expect(await api.getPushProgress('nonexistent')).toBeUndefined();
    });
  });

  describe('getDefaultNamespace', () => {
    it('returns configured namespace', async () => {
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue('sgahlot'),
      } as unknown as extensionApi.Configuration);

      const ns = await api.getDefaultNamespace();
      expect(ns).toBe('sgahlot');
      expect(extensionApi.configuration.getConfiguration).toHaveBeenCalledWith('physical-ai');
    });

    it('falls back to ecosystem-appeng when not configured', async () => {
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      } as unknown as extensionApi.Configuration);

      const ns = await api.getDefaultNamespace();
      expect(ns).toBe('ecosystem-appeng');
    });
  });

  describe('getDefaultOpenShiftNamespace', () => {
    it('returns the configured namespace', async () => {
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue('my-team-dev'),
      } as unknown as extensionApi.Configuration);

      const ns = await api.getDefaultOpenShiftNamespace();
      expect(ns).toBe('my-team-dev');
      expect(extensionApi.configuration.getConfiguration).toHaveBeenCalledWith('physical-ai');
    });

    it('falls back to an empty string when not configured (never "default")', async () => {
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      } as unknown as extensionApi.Configuration);

      const ns = await api.getDefaultOpenShiftNamespace();
      expect(ns).toBe('');
    });
  });

  describe('listRosTopics', () => {
    const CONTAINER_ID = 'abc123def456';

    beforeEach(() => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        simContainer(CONTAINER_ID, 'quay.io/sgahlot/ros2-jazzy-sim:noble'),
      ] as unknown as extensionApi.ContainerInfo[]);
    });

    it('returns empty array when ros2 topic list fails', async () => {
      vi.mocked(extensionApi.process.exec).mockRejectedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'command not found',
      });

      const result = await api.listRosTopics(CONTAINER_ID);
      expect(result).toEqual([]);
    });

    it('returns empty array when ros2 topic list returns empty output', async () => {
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: '',
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);

      const result = await api.listRosTopics(CONTAINER_ID);
      expect(result).toEqual([]);
    });

    it('parses topic list and fetches info for each topic', async () => {
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: [
          'T\t/rosout',
          'Type: rcl_interfaces/msg/Log',
          'Publisher count: 2',
          'Subscription count: 0',
          'T\t/robot_1/cmd_vel',
          'Type: geometry_msgs/msg/Twist',
          'Publisher count: 0',
          'Subscription count: 1',
          '',
        ].join('\n'),
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);

      const result = await api.listRosTopics(CONTAINER_ID);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        name: '/rosout',
        type: 'rcl_interfaces/msg/Log',
        publishers: 2,
        subscribers: 0,
      });
      expect(result[1]).toEqual({
        name: '/robot_1/cmd_vel',
        type: 'geometry_msgs/msg/Twist',
        publishers: 0,
        subscribers: 1,
      });
      expect(extensionApi.process.exec).toHaveBeenCalledTimes(1);
    });

    it('handles topic info failure gracefully', async () => {
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: 'T\t/rosout\n',
        stderr: 'error',
        command: 'podman',
      } as extensionApi.RunResult);

      const result = await api.listRosTopics(CONTAINER_ID);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: '/rosout',
        type: 'unknown',
        publishers: 0,
        subscribers: 0,
      });
    });

    it('detects humble distro from image tag', async () => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        simContainer(CONTAINER_ID, 'quay.io/ns/ros2-humble-turtlebot3:sloretz'),
      ] as unknown as extensionApi.ContainerInfo[]);
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: '/rosout\n',
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);

      await api.listRosTopics(CONTAINER_ID);
      const args = execArgs(0);
      expect(args).toContain(CONTAINER_ID);
      const bashCmd = args.find((arg: string) => arg.includes('source'));
      expect(bashCmd).toContain('/opt/ros/humble/');
    });

    it('skips injectable topic names from ros2 topic list', async () => {
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout:
          'T\t/rosout\nType: rcl_interfaces/msg/Log\nPublisher count: 1\nSubscription count: 0\nT\t/cmd_vel; id\n',
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);

      const result = await api.listRosTopics(CONTAINER_ID);
      expect(result.map(t => t.name)).toEqual(['/rosout']);
    });

    it('rejects non-simulation containers', async () => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        { Id: CONTAINER_ID, Image: 'quay.io/ns/other:latest', Labels: {} },
      ] as unknown as extensionApi.ContainerInfo[]);

      await expect(api.listRosTopics(CONTAINER_ID)).rejects.toThrow('Not a Physical AI simulation container');
    });

    it('looks up topic info inside one sourced bash with quoted names', async () => {
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: 'T\t/robot_1/cmd_vel\nType: geometry_msgs/msg/Twist\nPublisher count: 0\nSubscription count: 1\n',
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);

      await api.listRosTopics(CONTAINER_ID);
      expect(extensionApi.process.exec).toHaveBeenCalledTimes(1);
      const args = execArgs(0);
      const bashCmd = args.find((arg: string) => arg.includes('source'));
      expect(bashCmd).toContain('ros2 topic list');
      expect(bashCmd).toContain('ros2 topic info "$name"');
      expect(bashCmd).not.toContain('/robot_1/cmd_vel');
      expect(args).not.toContain('/robot_1/cmd_vel');
    });

    it('calls podman exec without -d flag (attached mode)', async () => {
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: '/rosout\n',
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);

      await api.listRosTopics(CONTAINER_ID);
      const args = execArgs(0);
      expect(args[0]).toBe('exec');
      expect(args[1]).toBe(CONTAINER_ID);
      expect(args).not.toContain('-d');
    });
  });

  describe('listRosTopicSummaries', () => {
    const CONTAINER_ID = 'abc123def456';

    beforeEach(() => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        simContainer(CONTAINER_ID, 'quay.io/sgahlot/ros2-jazzy-sim:noble'),
      ] as unknown as extensionApi.ContainerInfo[]);
    });

    it('parses ros2 topic list -t in a single exec', async () => {
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: '/rosout [rcl_interfaces/msg/Log]\n/robot_1/cmd_vel [geometry_msgs/msg/Twist]\n',
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);

      const result = await api.listRosTopicSummaries(CONTAINER_ID);
      expect(result).toEqual([
        {
          name: '/rosout',
          type: 'rcl_interfaces/msg/Log',
          publishers: 0,
          subscribers: 0,
          countsPending: true,
        },
        {
          name: '/robot_1/cmd_vel',
          type: 'geometry_msgs/msg/Twist',
          publishers: 0,
          subscribers: 0,
          countsPending: true,
        },
      ]);
      expect(extensionApi.process.exec).toHaveBeenCalledTimes(1);
      const bashCmd = execArgs(0).find((arg: string) => arg.includes('source'));
      expect(bashCmd).toContain('ros2 topic list -t');
    });

    it('returns empty array when topic list fails', async () => {
      vi.mocked(extensionApi.process.exec).mockRejectedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'command not found',
      });

      expect(await api.listRosTopicSummaries(CONTAINER_ID)).toEqual([]);
    });
  });

  describe('getRosTopicDetail', () => {
    const CONTAINER_ID = 'abc123def456';

    beforeEach(() => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        simContainer(CONTAINER_ID, 'quay.io/sgahlot/ros2-jazzy-sim:noble'),
      ] as unknown as extensionApi.ContainerInfo[]);
    });

    it('parses verbose output with publishers and subscribers', async () => {
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: [
          'Type: geometry_msgs/msg/Twist',
          '',
          'Publisher count: 1',
          '',
          'Node name: teleop_keyboard',
          'Node namespace: /',
          'Topic type: geometry_msgs/msg/Twist',
          'Endpoint type: PUBLISHER',
          'GID: 01.0f.7e.00.00.00.00.00',
          'QoS profile:',
          '  Reliability: RELIABLE',
          '  History (Depth): UNKNOWN',
          '  Durability: VOLATILE',
          '',
          'Subscription count: 2',
          '',
          'Node name: turtlebot3_diff_drive',
          'Node namespace: /robot_1',
          'Topic type: geometry_msgs/msg/Twist',
          'Endpoint type: SUBSCRIPTION',
          'GID: 01.0f.7e.00.00.00.00.01',
          'QoS profile:',
          '  Reliability: RELIABLE',
          '',
          'Node name: nav2_velocity_smoother',
          'Node namespace: /robot_1',
          'Topic type: geometry_msgs/msg/Twist',
          'Endpoint type: SUBSCRIPTION',
          'GID: 01.0f.7e.00.00.00.00.02',
        ].join('\n'),
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);

      const result = await api.getRosTopicDetail(CONTAINER_ID, '/robot_1/cmd_vel');
      expect(result.topicName).toBe('/robot_1/cmd_vel');
      expect(result.type).toBe('geometry_msgs/msg/Twist');
      expect(result.publishers).toEqual([{ nodeName: 'teleop_keyboard', nodeNamespace: '/' }]);
      expect(result.subscribers).toEqual([
        { nodeName: 'turtlebot3_diff_drive', nodeNamespace: '/robot_1' },
        { nodeName: 'nav2_velocity_smoother', nodeNamespace: '/robot_1' },
      ]);
    });

    it('returns empty arrays when exec fails', async () => {
      vi.mocked(extensionApi.process.exec).mockRejectedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'command not found',
      });

      const result = await api.getRosTopicDetail(CONTAINER_ID, '/rosout');
      expect(result).toEqual({
        topicName: '/rosout',
        type: 'unknown',
        publishers: [],
        subscribers: [],
      });
    });

    it('returns empty arrays for zero publishers and subscribers', async () => {
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: 'Type: std_msgs/msg/String\n\nPublisher count: 0\n\nSubscription count: 0\n',
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);

      const result = await api.getRosTopicDetail(CONTAINER_ID, '/empty_topic');
      expect(result.topicName).toBe('/empty_topic');
      expect(result.type).toBe('std_msgs/msg/String');
      expect(result.publishers).toEqual([]);
      expect(result.subscribers).toEqual([]);
    });

    it('detects humble distro for sourcing', async () => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        simContainer(CONTAINER_ID, 'quay.io/ns/ros2-humble-turtlebot3:sloretz'),
      ] as unknown as extensionApi.ContainerInfo[]);
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: 'Type: std_msgs/msg/String\n\nPublisher count: 0\n\nSubscription count: 0\n',
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);

      await api.getRosTopicDetail(CONTAINER_ID, '/rosout');
      const args = execArgs(0);
      const bashCmd = args.find((arg: string) => arg.includes('source'));
      expect(bashCmd).toContain('/opt/ros/humble/');
    });

    it('passes -v flag and topic as positional arg', async () => {
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: 'Type: std_msgs/msg/String\n\nPublisher count: 0\n\nSubscription count: 0\n',
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);

      await api.getRosTopicDetail(CONTAINER_ID, '/rosout');
      const args = execArgs(0);
      const bashCmd = args.find((arg: string) => arg.includes('ros2 topic info'));
      expect(bashCmd).toContain('ros2 topic info -v "$1"');
      expect(bashCmd).not.toMatch(/-v \/rosout/);
      expect(args).toContain('/rosout');
    });

    it('rejects injectable topic names', async () => {
      await expect(api.getRosTopicDetail(CONTAINER_ID, '/rosout; id')).rejects.toThrow(/Invalid ROS topic/);
    });
  });

  describe('peekRosTopic', () => {
    const CONTAINER_ID = 'abc123def456';

    beforeEach(() => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        simContainer(CONTAINER_ID, 'quay.io/sgahlot/ros2-jazzy-sim:noble'),
      ] as unknown as extensionApi.ContainerInfo[]);
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue(5),
        update: vi.fn(),
      } as unknown as extensionApi.Configuration);
    });

    it('returns cleaned message text from ros2 topic echo --once', async () => {
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: 'A message was lost!!!\nlinear:\n  x: 0.2\n  y: 0.0\n  z: 0.0\n---\n',
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);

      const result = await api.peekRosTopic(CONTAINER_ID, '/robot_1/cmd_vel');
      expect(result.timedOut).toBe(false);
      expect(result.message).toContain('linear:');
      expect(result.message).not.toMatch(/message was lost/i);
      expect(result.topicName).toBe('/robot_1/cmd_vel');
      expect(result.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      const args = execArgs(0);
      const bashCmd = args.find((arg: string) => arg.includes('topic echo'));
      expect(bashCmd).toContain('timeout "$1" ros2 topic echo --once');
      expect(bashCmd).toContain('--qos-reliability best_effort');
      expect(args).toContain('5');
      expect(args).toContain('/robot_1/cmd_vel');
    });

    it('uses configured peek timeout seconds', async () => {
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue(12),
        update: vi.fn(),
      } as unknown as extensionApi.Configuration);
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: 'data: hi\n',
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);

      await api.peekRosTopic(CONTAINER_ID, '/rosout');
      const args = execArgs(0);
      expect(args).toContain('12');
    });

    it('returns a settings error when peek timeout is out of range', async () => {
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue(99),
        update: vi.fn(),
      } as unknown as extensionApi.Configuration);

      const result = await api.peekRosTopic(CONTAINER_ID, '/rosout');
      expect(result.message).toBe('');
      expect(result.error).toMatch(/at most 30/);
      expect(extensionApi.process.exec).not.toHaveBeenCalled();
    });

    it('extracts message stamp from header', async () => {
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: 'header:\n  stamp:\n    sec: 21039\n    nanosec: 900000000\n  frame_id: base\n',
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);

      const result = await api.peekRosTopic(CONTAINER_ID, '/robot_1/joint_states');
      expect(result.messageStamp).toBe('sec=21039 nanosec=900000000');
    });

    it('reports timeout when no message arrives', async () => {
      vi.mocked(extensionApi.process.exec).mockRejectedValue({
        exitCode: 124,
        stdout: '',
        stderr: 'timeout',
        message: 'Command failed',
      });

      const result = await api.peekRosTopic(CONTAINER_ID, '/idle_topic');
      expect(result.timedOut).toBe(true);
      expect(result.message).toBe('');
      expect(result.error).toMatch(/No message/);
      expect(result.error).toMatch(/idle|infrequently/i);
      expect(result.capturedAt).toBeTruthy();
    });

    it('rejects injectable topic names', async () => {
      await expect(api.peekRosTopic(CONTAINER_ID, '/cmd; id')).rejects.toThrow(/Invalid ROS topic/);
    });

    it('rejects non-simulation containers', async () => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        { Id: CONTAINER_ID, Image: 'docker.io/library/nginx:latest', Labels: {} },
      ] as unknown as extensionApi.ContainerInfo[]);

      await expect(api.peekRosTopic(CONTAINER_ID, '/rosout')).rejects.toThrow('Not a Physical AI simulation container');
    });
  });

  describe('getTfTreeStatus', () => {
    const CONTAINER_ID = 'abc123def456';
    const TF_AVAILABLE = `At time 41024.4
- Translation: [-2.085, -0.571, 0.000]
- Rotation: in Quaternion (xyzw) [0.000, 0.000, 0.014, 1.000]
`;
    const TF_UNAVAILABLE = `[INFO] [tf2_echo]: Waiting for transform map ->  odom: Invalid frame ID "map" passed to canTransform argument target_frame - frame does not exist
`;

    beforeEach(() => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        simContainer(CONTAINER_ID, 'quay.io/sgahlot/ros2-jazzy-sim:noble'),
      ] as unknown as extensionApi.ContainerInfo[]);
    });

    it('reports all four curated frame pairs, each independently parsed', async () => {
      vi.mocked(extensionApi.process.exec)
        .mockResolvedValueOnce({ stdout: TF_AVAILABLE, stderr: '', command: 'podman' } as extensionApi.RunResult)
        .mockResolvedValueOnce({ stdout: TF_UNAVAILABLE, stderr: '', command: 'podman' } as extensionApi.RunResult)
        .mockResolvedValueOnce({ stdout: TF_AVAILABLE, stderr: '', command: 'podman' } as extensionApi.RunResult)
        .mockResolvedValueOnce({ stdout: TF_AVAILABLE, stderr: '', command: 'podman' } as extensionApi.RunResult);

      const result = await api.getTfTreeStatus(CONTAINER_ID, 'robot_1');
      expect(result.robotNamespace).toBe('robot_1');
      expect(result.frames).toHaveLength(4);
      expect(result.frames[0]).toMatchObject({ parentFrame: 'map', childFrame: 'odom', available: true });
      expect(result.frames[0].translation).toEqual({ x: -2.085, y: -0.571, z: 0 });
      expect(result.frames[1]).toMatchObject({ parentFrame: 'odom', childFrame: 'base_footprint', available: false });
      expect(result.frames[1].error).toMatch(/invalid frame id/i);
      expect(result.frames[2]).toMatchObject({ parentFrame: 'base_footprint', childFrame: 'base_link' });
      expect(result.frames[3]).toMatchObject({ parentFrame: 'base_link', childFrame: 'base_scan' });
      expect(result.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('passes the timeout, frame names, and robot name as positional bash args, never interpolated into the script', async () => {
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: TF_AVAILABLE,
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);

      await api.getTfTreeStatus(CONTAINER_ID, 'robot_1');
      const args = execArgs(0);
      const script = args.find((arg: string) => arg.includes('tf2_echo'));
      expect(script).toContain('"$2" "$3"');
      expect(script).toContain('/$4/tf');
      expect(script).not.toContain('robot_1');
      expect(args).toContain('5');
      expect(args).toContain('map');
      expect(args).toContain('odom');
      expect(args).toContain('robot_1');
    });

    it('rejects an invalid robot name before exec', async () => {
      await expect(api.getTfTreeStatus(CONTAINER_ID, 'robot; rm -rf /')).rejects.toThrow(/Invalid robot name/);
      expect(extensionApi.process.exec).not.toHaveBeenCalled();
    });

    it('rejects non-simulation containers', async () => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        { Id: CONTAINER_ID, Image: 'docker.io/library/nginx:latest', Labels: {} },
      ] as unknown as extensionApi.ContainerInfo[]);

      await expect(api.getTfTreeStatus(CONTAINER_ID, 'robot_1')).rejects.toThrow(
        'Not a Physical AI simulation container',
      );
    });
  });

  describe('getCostmapSummary', () => {
    const CONTAINER_ID = 'abc123def456';
    const LOCAL_COSTMAP_ECHO = `info:
  resolution: 0.05
  width: 2
  height: 2
  origin:
    position:
      x: 1.0
      y: 2.0
data: [0, 100, -1, 0]
`;

    beforeEach(() => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        simContainer(CONTAINER_ID, 'quay.io/sgahlot/ros2-jazzy-sim:noble'),
      ] as unknown as extensionApi.ContainerInfo[]);
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue(5),
        update: vi.fn(),
      } as unknown as extensionApi.Configuration);
    });

    it('summarizes both local and global costmaps independently', async () => {
      vi.mocked(extensionApi.process.exec)
        .mockResolvedValueOnce({
          stdout: LOCAL_COSTMAP_ECHO,
          stderr: '',
          command: 'podman',
        } as extensionApi.RunResult)
        .mockRejectedValueOnce({ exitCode: 124, stdout: '', stderr: 'timeout' });

      const result = await api.getCostmapSummary(CONTAINER_ID, 'robot_1');
      expect(result.local).toMatchObject({
        topic: '/robot_1/local_costmap/costmap',
        widthCells: 2,
        heightCells: 2,
        occupiedCells: 1,
        freeCells: 2,
        unknownCells: 1,
        totalCells: 4,
      });
      expect(result.global).toMatchObject({
        topic: '/robot_1/global_costmap/costmap',
        timedOut: true,
      });
      expect(result.global?.error).toMatch(/No message/);

      const localArgs = execArgs(0);
      expect(localArgs).toContain('/robot_1/local_costmap/costmap');
      const script = localArgs.find((arg: string) => arg.includes('topic echo'));
      expect(script).toContain('--full-length --flow-style');
      expect(script).not.toContain('--qos-reliability');
    });

    it('treats a topic that has never been published (exit 1, not the timeout wrapper) as "not available yet"', async () => {
      // Verified live: ros2 topic echo against a topic nobody has ever advertised (e.g. right
      // after spawn, before Nav2 exists) fails fast with exit 1 and this message on stdout
      // (merged from the script's own stderr via 2>&1) instead of blocking until timeout (124).
      const NEVER_PUBLISHED = `WARNING: topic [/robot_1/local_costmap/costmap] does not appear to be published yet
Could not determine the type for the passed topic
`;
      vi.mocked(extensionApi.process.exec).mockRejectedValue({
        exitCode: 1,
        stdout: NEVER_PUBLISHED,
        stderr: '',
      });

      const result = await api.getCostmapSummary(CONTAINER_ID, 'robot_1');
      expect(result.local).toMatchObject({ timedOut: true });
      expect(result.local?.error).toMatch(/may not be publishing yet/);
      expect(result.global).toMatchObject({ timedOut: true });
    });

    it('rejects an invalid robot name before exec', async () => {
      await expect(api.getCostmapSummary(CONTAINER_ID, 'robot; rm -rf /')).rejects.toThrow(/Invalid robot name/);
      expect(extensionApi.process.exec).not.toHaveBeenCalled();
    });

    it('rejects non-simulation containers', async () => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        { Id: CONTAINER_ID, Image: 'docker.io/library/nginx:latest', Labels: {} },
      ] as unknown as extensionApi.ContainerInfo[]);

      await expect(api.getCostmapSummary(CONTAINER_ID, 'robot_1')).rejects.toThrow(
        'Not a Physical AI simulation container',
      );
    });
  });

  describe('getLaserScanSummary', () => {
    const CONTAINER_ID = 'abc123def456';
    const SCAN_ECHO = `angle_min: 0.0
angle_max: 6.28
angle_increment: 0.017
range_min: 0.1
range_max: 20.0
ranges: [0.3, 0.5, .inf, .nan]
`;

    beforeEach(() => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        simContainer(CONTAINER_ID, 'quay.io/sgahlot/ros2-jazzy-sim:noble'),
      ] as unknown as extensionApi.ContainerInfo[]);
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue(5),
        update: vi.fn(),
      } as unknown as extensionApi.Configuration);
    });

    it('summarizes ranges, keeping the best_effort/volatile QoS override plus full-length/flow-style', async () => {
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: SCAN_ECHO,
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);

      const result = await api.getLaserScanSummary(CONTAINER_ID, 'robot_1');
      expect(result.topic).toBe('/robot_1/scan');
      expect(result.finiteCount).toBe(2);
      expect(result.infCount).toBe(1);
      expect(result.nanCount).toBe(1);
      expect(result.totalCount).toBe(4);
      expect(result.minRange).toBe(0.3);
      expect(result.maxRange).toBe(0.5);

      const args = execArgs(0);
      const script = args.find((arg: string) => arg.includes('topic echo'));
      expect(script).toContain('--qos-reliability best_effort');
      expect(script).toContain('--full-length --flow-style');
      expect(args).toContain('/robot_1/scan');
    });

    it('reports a timeout when the scan topic is idle', async () => {
      vi.mocked(extensionApi.process.exec).mockRejectedValue({ exitCode: 124, stdout: '', stderr: 'timeout' });

      const result = await api.getLaserScanSummary(CONTAINER_ID, 'robot_1');
      expect(result.timedOut).toBe(true);
      expect(result.error).toMatch(/No message|idle/i);
    });

    it('treats a scan topic that has never been published (exit 1) as "not available yet" too', async () => {
      vi.mocked(extensionApi.process.exec).mockRejectedValue({
        exitCode: 1,
        stdout:
          'WARNING: topic [/robot_1/scan] does not appear to be published yet\nCould not determine the type for the passed topic\n',
        stderr: '',
      });

      const result = await api.getLaserScanSummary(CONTAINER_ID, 'robot_1');
      expect(result.timedOut).toBe(true);
      expect(result.error).toMatch(/No message|idle/i);
    });

    it('rejects an invalid robot name before exec', async () => {
      await expect(api.getLaserScanSummary(CONTAINER_ID, 'robot; rm -rf /')).rejects.toThrow(/Invalid robot name/);
      expect(extensionApi.process.exec).not.toHaveBeenCalled();
    });

    it('rejects non-simulation containers', async () => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        { Id: CONTAINER_ID, Image: 'docker.io/library/nginx:latest', Labels: {} },
      ] as unknown as extensionApi.ContainerInfo[]);

      await expect(api.getLaserScanSummary(CONTAINER_ID, 'robot_1')).rejects.toThrow(
        'Not a Physical AI simulation container',
      );
    });
  });

  describe('getRobotSensorDiagnostics', () => {
    const CONTAINER_ID = 'abc123def456';
    const TOPIC_LIST = `/robot_1/imu [sensor_msgs/msg/Imu]
/robot_1/scan [sensor_msgs/msg/LaserScan]
/robot_1/camera/image_raw [sensor_msgs/msg/Image]
`;
    const SCAN_ECHO = `angle_min: 0.0
angle_max: 6.28
angle_increment: 0.017
range_min: 0.1
range_max: 20.0
ranges: [0.3, 0.5]
`;
    const IMU_ECHO = `orientation:
  x: 0.0
  y: 0.0
  z: 0.0
  w: 1.0
angular_velocity:
  x: 0.0
  y: 0.0
  z: 0.0
linear_acceleration:
  x: 0.0
  y: 0.0
  z: 9.81
`;

    beforeEach(() => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        simContainer(CONTAINER_ID, 'quay.io/sgahlot/ros2-jazzy-sim:noble'),
      ] as unknown as extensionApi.ContainerInfo[]);
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue(5),
        update: vi.fn(),
      } as unknown as extensionApi.Configuration);
    });

    it('discovers sensor topics and peeks supported types', async () => {
      vi.mocked(extensionApi.process.exec).mockImplementation(async (_cmd, args) => {
        const script = (args as string[]).find(a => typeof a === 'string' && a.includes('topic list -t'));
        if (script !== undefined || (args as string[]).some(a => a === 'ros2 topic list -t')) {
          return { stdout: TOPIC_LIST, stderr: '', command: 'podman' } as extensionApi.RunResult;
        }
        const topicArg = (args as string[]).find(a => typeof a === 'string' && a.startsWith('/robot_1/'));
        if (topicArg === '/robot_1/scan') {
          return { stdout: SCAN_ECHO, stderr: '', command: 'podman' } as extensionApi.RunResult;
        }
        if (topicArg === '/robot_1/imu') {
          return { stdout: IMU_ECHO, stderr: '', command: 'podman' } as extensionApi.RunResult;
        }
        return { stdout: '', stderr: '', command: 'podman' } as extensionApi.RunResult;
      });

      const result = await api.getRobotSensorDiagnostics(CONTAINER_ID, 'robot_1');
      expect(result.robotNamespace).toBe('robot_1');
      expect(result.sensors.map(s => s.topic)).toEqual(['/robot_1/camera/image_raw', '/robot_1/imu', '/robot_1/scan']);
      const scan = result.sensors.find(s => s.topic === '/robot_1/scan');
      expect(scan?.laserScan?.finiteCount).toBe(2);
      const imu = result.sensors.find(s => s.topic === '/robot_1/imu');
      expect(imu?.imu?.orientation.w).toBe(1);
      const image = result.sensors.find(s => s.topic === '/robot_1/camera/image_raw');
      expect(image?.peekSupported).toBe(false);
      expect(image?.laserScan).toBeUndefined();
    });

    it('rejects an invalid robot name before exec', async () => {
      await expect(api.getRobotSensorDiagnostics(CONTAINER_ID, 'robot; rm -rf /')).rejects.toThrow(
        /Invalid robot name/,
      );
      expect(extensionApi.process.exec).not.toHaveBeenCalled();
    });
  });

  describe('getTopicPeekTimeoutSeconds / setTopicPeekTimeoutSeconds', () => {
    it('returns default when unset', async () => {
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
        update: vi.fn(),
      } as unknown as extensionApi.Configuration);
      expect(await api.getTopicPeekTimeoutSeconds()).toBe(5);
    });

    it('rejects set below minimum with a clear message', async () => {
      const update = vi.fn();
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn(),
        update,
      } as unknown as extensionApi.Configuration);
      await expect(api.setTopicPeekTimeoutSeconds(0)).rejects.toThrow(/at least 1/);
      expect(update).not.toHaveBeenCalled();
    });

    it('rejects set above maximum with a clear message', async () => {
      const update = vi.fn();
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn(),
        update,
      } as unknown as extensionApi.Configuration);
      await expect(api.setTopicPeekTimeoutSeconds(31)).rejects.toThrow(/at most 30/);
      expect(update).not.toHaveBeenCalled();
    });

    it('persists a valid timeout', async () => {
      const update = vi.fn().mockResolvedValue(undefined);
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn(),
        update,
      } as unknown as extensionApi.Configuration);
      await api.setTopicPeekTimeoutSeconds(15);
      expect(update).toHaveBeenCalledWith('general.topicPeekTimeoutSeconds', 15);
    });
  });

  describe('getNavigationLayout / setNavigationLayout', () => {
    it('returns default "sidebar" when unset', async () => {
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
        update: vi.fn(),
      } as unknown as extensionApi.Configuration);
      expect(await api.getNavigationLayout()).toBe('sidebar');
    });
    it('returns "tabs" when configured', async () => {
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue('tabs'),
        update: vi.fn(),
      } as unknown as extensionApi.Configuration);
      expect(await api.getNavigationLayout()).toBe('tabs');
    });
    it('returns "cards" when configured', async () => {
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue('cards'),
        update: vi.fn(),
      } as unknown as extensionApi.Configuration);
      expect(await api.getNavigationLayout()).toBe('cards');
    });
    it('falls back to "sidebar" for an unexpected stored value', async () => {
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue('bogus'),
        update: vi.fn(),
      } as unknown as extensionApi.Configuration);
      expect(await api.getNavigationLayout()).toBe('sidebar');
    });
    it('rejects an invalid layout with a clear message', async () => {
      const update = vi.fn();
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn(),
        update,
      } as unknown as extensionApi.Configuration);
      await expect(api.setNavigationLayout('bogus' as 'sidebar')).rejects.toThrow(/Invalid navigation layout/);
      expect(update).not.toHaveBeenCalled();
    });
    it('persists a valid layout', async () => {
      const update = vi.fn().mockResolvedValue(undefined);
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn(),
        update,
      } as unknown as extensionApi.Configuration);
      await api.setNavigationLayout('tabs');
      expect(update).toHaveBeenCalledWith('general.navigationLayout', 'tabs');
    });
  });

  describe('getDefaultSoftwareRenderCpus', () => {
    it('returns the built-in default when unset', async () => {
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      } as unknown as extensionApi.Configuration);
      expect(await api.getDefaultSoftwareRenderCpus()).toBe(8);
    });

    it('returns a valid configured value', async () => {
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue(5),
      } as unknown as extensionApi.Configuration);
      expect(await api.getDefaultSoftwareRenderCpus()).toBe(5);
    });

    it('falls back to the default when the setting is out of range', async () => {
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue(0),
      } as unknown as extensionApi.Configuration);
      expect(await api.getDefaultSoftwareRenderCpus()).toBe(8);
    });
  });

  describe('getRosMessageSchema', () => {
    const CONTAINER_ID = 'abc123def456';

    beforeEach(() => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        simContainer(CONTAINER_ID, 'quay.io/sgahlot/ros2-jazzy-sim:noble'),
      ] as unknown as extensionApi.ContainerInfo[]);
    });

    it('returns interface definition text', async () => {
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: 'float64 x\nfloat64 y\nfloat64 z\n',
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);

      const result = await api.getRosMessageSchema(CONTAINER_ID, 'geometry_msgs/msg/Vector3');
      expect(result.type).toBe('geometry_msgs/msg/Vector3');
      expect(result.schema).toContain('float64 x');
      expect(result.error).toBeUndefined();

      const args = execArgs(0);
      const bashCmd = args.find((arg: string) => arg.includes('interface show'));
      expect(bashCmd).toContain('ros2 interface show "$1"');
      expect(args).toContain('geometry_msgs/msg/Vector3');
    });

    it('rejects injectable message types', async () => {
      await expect(api.getRosMessageSchema(CONTAINER_ID, 'std_msgs/msg/String; id')).rejects.toThrow(
        /Invalid ROS message/,
      );
    });
  });

  describe('copyToClipboard', () => {
    it('writes text via extension clipboard API', async () => {
      vi.mocked(extensionApi.env.clipboard.writeText).mockResolvedValue(undefined);
      await api.copyToClipboard('linear:\n  x: 0.2\n');
      expect(extensionApi.env.clipboard.writeText).toHaveBeenCalledWith('linear:\n  x: 0.2\n');
    });

    it('rejects oversized payloads, reporting both sizes so a size mismatch is diagnosable', async () => {
      await expect(api.copyToClipboard('x'.repeat(32 * 1024 * 1024 + 1))).rejects.toThrow(
        /exceeds the allowed size \(32\.0MB > 32\.0MB limit\)/,
      );
      expect(extensionApi.env.clipboard.writeText).not.toHaveBeenCalled();
    });

    it('accepts a multi-megabyte SBOM-sized payload', async () => {
      vi.mocked(extensionApi.env.clipboard.writeText).mockResolvedValue(undefined);
      const bigSbom = 'x'.repeat(10 * 1024 * 1024);
      await api.copyToClipboard(bigSbom);
      expect(extensionApi.env.clipboard.writeText).toHaveBeenCalledWith(bigSbom);
    });
  });

  describe('sendNavigationGoal (humble cmd_vel)', () => {
    const CONTAINER_ID = 'abc123def456';
    const GZ_POSE_ORIGIN =
      'Requesting state for world [tb3_sandbox]...\n\nModel: [42]\n  - Name: robot_1\n  - Pose [ XYZ (m) ] [ RPY (rad) ]:\n    [0.000000 0.000000 0.010000]\n    [0.000000 0.000000 0.000000]';
    const GZ_POSE_AT_TARGET =
      'Requesting state for world [tb3_sandbox]...\n\nModel: [42]\n  - Name: robot_1\n  - Pose [ XYZ (m) ] [ RPY (rad) ]:\n    [2.000000 2.000000 0.010000]\n    [0.000000 0.000000 0.000000]';

    function mockNavExec(finalPose: string = GZ_POSE_AT_TARGET) {
      let poseCalls = 0;
      vi.mocked(extensionApi.process.exec).mockImplementation(async (_cmd, args) => {
        const argv = args as string[];
        if (argv.some(a => typeof a === 'string' && a.includes('gz model'))) {
          poseCalls++;
          return {
            stdout: poseCalls === 1 ? GZ_POSE_ORIGIN : finalPose,
            stderr: '',
            command: 'podman',
          } as extensionApi.RunResult;
        }
        return { stdout: '', stderr: '', command: 'podman' } as extensionApi.RunResult;
      });
    }

    beforeEach(() => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        simContainer(CONTAINER_ID, 'quay.io/ns/ros2-humble-turtlebot3:sloretz'),
      ] as unknown as extensionApi.ContainerInfo[]);
    });

    it('returns reached after driving toward target', async () => {
      mockNavExec(GZ_POSE_AT_TARGET);

      const result = await api.sendNavigationGoal(CONTAINER_ID, 'robot_1', 2.0, 2.0);
      expect(result.status).toBe('reached');
      expect(result.message).toContain('2');
    });

    it('returns failed when final pose is still far from target', async () => {
      mockNavExec(GZ_POSE_ORIGIN);

      const result = await api.sendNavigationGoal(CONTAINER_ID, 'robot_1', 2.0, 2.0);
      expect(result.status).toBe('failed');
      expect(result.message).toMatch(/still/);
    });

    it('queries pose then publishes turn, drive, and stop commands', async () => {
      mockNavExec();

      await api.sendNavigationGoal(CONTAINER_ID, 'robot_1', 2.0, 2.0);
      const poseArgs = execArgs(0);
      const poseCmd = poseArgs.find((arg: string) => arg.includes('gz model'));
      expect(poseCmd).toContain('gz model -m "$1"');
      expect(poseArgs).toContain('robot_1');
      const calls = vi.mocked(extensionApi.process.exec).mock.calls;
      const turnCmds = calls.filter(c =>
        (c[1] as string[] | undefined)?.some((a: string) => typeof a === 'string' && a.includes('angular')),
      );
      expect(turnCmds.length).toBeGreaterThan(0);
      const driveCmds = calls.filter(c =>
        (c[1] as string[] | undefined)?.some((a: string) => typeof a === 'string' && a.includes('linear')),
      );
      expect(driveCmds.length).toBe(1);
    });

    it('returns already-at-target when distance is tiny', async () => {
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: GZ_POSE_AT_TARGET,
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);

      const result = await api.sendNavigationGoal(CONTAINER_ID, 'robot_1', 2.0, 2.0);
      expect(result.status).toBe('reached');
      expect(result.message).toContain('Already');
    });

    it('uses robot name as positional arg for cmd_vel topic', async () => {
      mockNavExec();

      await api.sendNavigationGoal(CONTAINER_ID, 'robot_1', 3.5, -1.0);
      const calls = vi.mocked(extensionApi.process.exec).mock.calls;
      const driveCallIndex = calls.findIndex(c =>
        (c[1] as string[] | undefined)?.some((a: string) => typeof a === 'string' && a.includes('linear')),
      );
      expect(driveCallIndex).toBeGreaterThanOrEqual(0);
      const driveArgs = execArgs(driveCallIndex);
      const driveCmd = driveArgs.find((arg: string) => arg.includes('linear'));
      expect(driveCmd).toContain('/$2/cmd_vel');
      expect(driveArgs).toContain('robot_1');
      expect(driveCmd).not.toContain('/robot_1/cmd_vel');
    });

    it('rejects injectable robot names', async () => {
      await expect(api.sendNavigationGoal(CONTAINER_ID, 'robot;id', 2.0, 2.0)).rejects.toThrow(/Invalid robot name/);
    });

    it('fails loudly when pose cannot be parsed', async () => {
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: 'no pose here',
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);

      await expect(api.sendNavigationGoal(CONTAINER_ID, 'robot_1', 2.0, 2.0)).rejects.toThrow(/Could not read pose/);
    });

    it('calls podman exec without -d flag (attached mode)', async () => {
      mockNavExec();

      await api.sendNavigationGoal(CONTAINER_ID, 'robot_1', 2.0, 2.0);
      const args = execArgs(0);
      expect(args[0]).toBe('exec');
      expect(args).not.toContain('-d');
    });
  });

  describe('sendNavigationGoal (jazzy Nav2)', () => {
    const CONTAINER_ID = 'abc123def456';
    const GZ_POSE_ORIGIN =
      'Requesting state for world [tb3_sandbox]...\n\nModel: [42]\n  - Name: robot_1\n  - Pose [ XYZ (m) ] [ RPY (rad) ]:\n    [0.000000 0.000000 0.010000]\n    [0.000000 0.000000 0.000000]';

    function mockNav2Exec(options?: { tfReadyInitially?: boolean; goalOutput?: string }) {
      const tfReadyInitially = options?.tfReadyInitially ?? true;
      const goalOutput = options?.goalOutput ?? 'Goal finished with status: SUCCEEDED\n';
      let tfChecks = 0;
      vi.mocked(extensionApi.process.exec).mockImplementation(async (_cmd, args) => {
        const argv = args as string[];
        if (argv.some(a => typeof a === 'string' && a.includes('gz model'))) {
          return { stdout: GZ_POSE_ORIGIN, stderr: '', command: 'podman' } as extensionApi.RunResult;
        }
        if (argv.includes('-d')) {
          return { stdout: '', stderr: '', command: 'podman' } as extensionApi.RunResult;
        }
        const bashScript = argv.find((a): a is string => typeof a === 'string' && a.includes('source'));
        if (bashScript?.includes('send_goal')) {
          return { stdout: goalOutput, stderr: '', command: 'podman' } as extensionApi.RunResult;
        }
        if (bashScript?.includes('tf2_echo map base_link')) {
          tfChecks++;
          if (tfReadyInitially || tfChecks > 1) {
            return {
              stdout: 'At time 1.0\n- Translation: [-1.972, -0.517, 0.010]\n',
              stderr: '',
              command: 'podman',
            } as extensionApi.RunResult;
          }
          return {
            stdout: 'Waiting for transform map -> base_link\n',
            stderr: '',
            command: 'podman',
          } as extensionApi.RunResult;
        }
        return { stdout: '', stderr: '', command: 'podman' } as extensionApi.RunResult;
      });
    }

    beforeEach(() => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        simContainer(CONTAINER_ID, 'quay.io/sgahlot/ros2-jazzy-sim:noble'),
      ] as unknown as extensionApi.ContainerInfo[]);
    });

    it('returns reached when Nav2 goal succeeds', async () => {
      mockNav2Exec();

      const result = await api.sendNavigationGoal(CONTAINER_ID, 'robot_1', 2.0, 2.0);
      expect(result.status).toBe('reached');
      expect(result.message).toContain('Nav2');
    });

    it('returns failed when Nav2 goal reports non-success status', async () => {
      mockNav2Exec({ goalOutput: 'Goal finished with status: ABORTED\n' });

      const result = await api.sendNavigationGoal(CONTAINER_ID, 'robot_1', 2.0, 2.0);
      expect(result.status).toBe('failed');
      expect(result.message).toContain('ABORTED');
    });

    it('sends navigate_to_pose with robot name as positional arg', async () => {
      mockNav2Exec();

      await api.sendNavigationGoal(CONTAINER_ID, 'robot_1', 3.5, -1.0);
      const goalCall = vi
        .mocked(extensionApi.process.exec)
        .mock.calls.find(c =>
          (c[1] as string[] | undefined)?.some(a => typeof a === 'string' && a.includes('send_goal')),
        );
      expect(goalCall).toBeDefined();
      const goalArgs = goalCall![1] as string[];
      const goalCmd = goalArgs.find(arg => arg.includes('send_goal'));
      expect(goalCmd).toContain('/$2/navigate_to_pose');
      expect(goalArgs).toContain('robot_1');
      expect(goalCmd).not.toContain('/robot_1/navigate_to_pose');
      // Local podman containers have a writable HOME; the oc-only workaround must not leak here.
      expect(goalCmd).not.toContain('HOME=/tmp/ros-home');
    });

    it('launches Nav2 detached with spawn pose env when map TF is missing', async () => {
      mockNav2Exec({ tfReadyInitially: false });

      const promise = api.sendNavigationGoal(CONTAINER_ID, 'robot_1', 2.0, 2.0);
      await vi.advanceTimersByTimeAsync(1000); // TF poll → becomes ready
      await vi.advanceTimersByTimeAsync(2000); // cold-start costmap-clear refill settle
      const result = await promise;

      expect(result.status).toBe('reached');
      const detachedCall = vi
        .mocked(extensionApi.process.exec)
        .mock.calls.find(c => (c[1] as string[] | undefined)?.includes('-d'));
      expect(detachedCall).toBeDefined();
      const detachedArgs = detachedCall![1] as string[];
      expect(detachedArgs).toContain(NAV2_ENTRYPOINT);
      expect(detachedArgs).toContain('robot_1');
      const dIdx = detachedArgs.indexOf('-d');
      expect(detachedArgs.indexOf(CONTAINER_ID)).toBeGreaterThan(dIdx);
      expect(detachedArgs.indexOf(NAV2_ENTRYPOINT)).toBeGreaterThan(detachedArgs.indexOf(CONTAINER_ID));
      expect(detachedArgs.some(a => a === 'PHYSICAL_AI_SPAWN_X=0.0000' || a.startsWith('PHYSICAL_AI_SPAWN_X='))).toBe(
        true,
      );
      expect(detachedArgs.some(a => a.startsWith('PHYSICAL_AI_SPAWN_Y='))).toBe(true);
    });

    it('clears both costmaps once on a cold start, before sending the goal', async () => {
      mockNav2Exec({ tfReadyInitially: false });

      const promise = api.sendNavigationGoal(CONTAINER_ID, 'robot_1', 2.0, 2.0);
      await vi.advanceTimersByTimeAsync(1000); // TF poll → becomes ready
      await vi.advanceTimersByTimeAsync(2000); // costmap-clear refill settle
      const result = await promise;
      expect(result.status).toBe('reached');

      const calls = vi.mocked(extensionApi.process.exec).mock.calls;
      const clearCall = calls.find(c =>
        (c[1] as string[] | undefined)?.some(a => typeof a === 'string' && a.includes('clear_entirely_local_costmap')),
      );
      expect(clearCall).toBeDefined();
      const clearCmd = (clearCall![1] as string[]).find(a => a.includes('clear_entirely_local_costmap'))!;
      expect(clearCmd).toContain('clear_entirely_global_costmap');
      expect(clearCmd).toContain('/$1/'); // robot name passed positionally, not interpolated
      expect(clearCall![1]).toContain('robot_1');

      // The clear must precede the navigation goal.
      const clearIdx = calls.indexOf(clearCall!);
      const goalIdx = calls.findIndex(c =>
        (c[1] as string[] | undefined)?.some(a => typeof a === 'string' && a.includes('send_goal')),
      );
      expect(goalIdx).toBeGreaterThan(clearIdx);
    });

    it('does not clear costmaps on the warm path (TF already present)', async () => {
      mockNav2Exec({ tfReadyInitially: true });

      const result = await api.sendNavigationGoal(CONTAINER_ID, 'robot_1', 2.0, 2.0);
      expect(result.status).toBe('reached');

      const clearCall = vi
        .mocked(extensionApi.process.exec)
        .mock.calls.find(c =>
          (c[1] as string[] | undefined)?.some(a => typeof a === 'string' && a.includes('clear_entirely')),
        );
      expect(clearCall).toBeUndefined();
    });

    it('clears only once per bringup — a second goal does not clear again', async () => {
      mockNav2Exec({ tfReadyInitially: false });
      const countClears = () =>
        vi
          .mocked(extensionApi.process.exec)
          .mock.calls.filter(c =>
            (c[1] as string[] | undefined)?.some(
              a => typeof a === 'string' && a.includes('clear_entirely_local_costmap'),
            ),
          ).length;

      // First goal on the fresh (cold) bringup → clears once.
      const first = api.sendNavigationGoal(CONTAINER_ID, 'robot_1', 2.0, 2.0);
      await vi.advanceTimersByTimeAsync(1000); // TF poll → ready
      await vi.advanceTimersByTimeAsync(2000); // costmap-clear refill settle
      expect((await first).status).toBe('reached');
      expect(countClears()).toBe(1);

      // Second goal → TF already present (warm), pending already consumed → no re-clear.
      const second = await api.sendNavigationGoal(CONTAINER_ID, 'robot_1', 3.0, 3.0);
      expect(second.status).toBe('reached');
      expect(countClears()).toBe(1);
    });

    it('returns already-at-target when distance is tiny', async () => {
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout:
          'Requesting state for world [tb3_sandbox]...\n\nModel: [42]\n  - Name: robot_1\n  - Pose [ XYZ (m) ] [ RPY (rad) ]:\n    [2.000000 2.000000 0.010000]\n    [0.000000 0.000000 0.000000]',
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);

      const result = await api.sendNavigationGoal(CONTAINER_ID, 'robot_1', 2.0, 2.0);
      expect(result.status).toBe('reached');
      expect(result.message).toContain('Already');
    });
  });

  describe('despawnRobot (local)', () => {
    const CONTAINER_ID = 'abc123def456';

    beforeEach(() => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        simContainer(CONTAINER_ID, 'quay.io/sgahlot/ros2-jazzy-sim:noble'),
      ] as unknown as extensionApi.ContainerInfo[]);
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: '',
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);
    });

    it('kills the robot processes (TERM then KILL) with a boundary-anchored pattern and removes the model', async () => {
      await api.despawnRobot(CONTAINER_ID, 'robot_1');

      const calls = vi.mocked(extensionApi.process.exec).mock.calls;
      const pkillCall = calls.find(c => (c[1] as string[]).some(a => typeof a === 'string' && a.includes('pkill')));
      expect(pkillCall).toBeDefined();
      const pkillA = pkillCall![1] as string[];
      expect(pkillA[0]).toBe('exec');
      const script = pkillA.find(a => typeof a === 'string' && a.includes('pkill'))!;
      expect(script).toContain('pkill -TERM -f "$1"');
      expect(script).toContain('pkill -KILL -f "$1"');
      const pattern = pkillA[pkillA.length - 1];
      // Right boundary so robot_1 never matches robot_10, and no bare `/robot/`
      // branch so the pattern can't match the pkill shell's own argv.
      expect(pattern).toContain('robot_1([ /:]|$)');
      expect(pattern).toContain('__ns:=/');
      expect(pattern).toContain('entrypoint-(spawn-robot|nav2)');
      expect(pattern).not.toContain('/robot_1/');

      const gzCall = calls.find(c => (c[1] as string[]).some(a => typeof a === 'string' && a.includes('gz service')));
      expect(gzCall).toBeDefined();
      const gzScript = (gzCall![1] as string[]).find(a => typeof a === 'string' && a.includes('gz service'))!;
      expect(gzScript).toContain('/world/$world/remove');
      expect(gzScript).toContain('type: MODEL');
    });

    it('rejects an injectable robot name', async () => {
      await expect(api.despawnRobot(CONTAINER_ID, 'robot;id')).rejects.toThrow(/robot name/i);
    });
  });

  describe('getRobotWarmStatus (local)', () => {
    const CONTAINER_ID = 'abc123def456';

    beforeEach(() => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        simContainer(CONTAINER_ID, 'quay.io/sgahlot/ros2-jazzy-sim:noble'),
      ] as unknown as extensionApi.ContainerInfo[]);
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: '',
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);
    });

    it("returns 'idle' for a robot that was never spawned", async () => {
      expect(await api.getRobotWarmStatus(CONTAINER_ID, 'robot_9')).toBe('idle');
    });

    it("reports 'warming' after a jazzy spawn, then 'idle' once despawned", async () => {
      await api.execInSimulation(CONTAINER_ID, [SPAWN_ENTRYPOINT, 'robot_1', '-2.0', '-0.5', '0.0']);
      // Pre-warm sets 'warming' synchronously and parks on its first poll sleep.
      expect(await api.getRobotWarmStatus(CONTAINER_ID, 'robot_1')).toBe('warming');

      await api.despawnRobot(CONTAINER_ID, 'robot_1');
      expect(await api.getRobotWarmStatus(CONTAINER_ID, 'robot_1')).toBe('idle');
    });

    it('rejects an injectable robot name', async () => {
      await expect(api.getRobotWarmStatus(CONTAINER_ID, 'robot;id')).rejects.toThrow(/robot name/i);
    });
  });

  describe('execInSimulation security', () => {
    const CONTAINER_ID = 'abc123def456';

    beforeEach(() => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        simContainer(CONTAINER_ID, 'quay.io/sgahlot/ros2-jazzy-sim:noble'),
      ] as unknown as extensionApi.ContainerInfo[]);
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: '',
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);
    });

    it('allows spawn entrypoint with validated args', async () => {
      await api.execInSimulation(CONTAINER_ID, [SPAWN_ENTRYPOINT, 'robot_1', '-2.0', '0.5', '0.0']);
      expect(extensionApi.process.exec).toHaveBeenCalledWith('podman', [
        'exec',
        '-d',
        CONTAINER_ID,
        SPAWN_ENTRYPOINT,
        'robot_1',
        '-2.0',
        '0.5',
        '0.0',
      ]);
    });

    it('warms Nav2 in the background after a jazzy spawn', async () => {
      const GZ_POSE =
        'Requesting state for world [tb3_sandbox]...\n\nModel: [42]\n  - Name: robot_1\n  - Pose [ XYZ (m) ] [ RPY (rad) ]:\n    [0.000000 0.000000 0.010000]\n    [0.000000 0.000000 0.000000]';
      vi.mocked(extensionApi.process.exec).mockImplementation(async (_cmd, args) => {
        const argv = args as string[];
        if (argv.some(a => typeof a === 'string' && a.includes('gz model'))) {
          return { stdout: GZ_POSE, stderr: '', command: 'podman' } as extensionApi.RunResult;
        }
        // TF never ready + pgrep empty → forces a Nav2 launch.
        return { stdout: '', stderr: '', command: 'podman' } as extensionApi.RunResult;
      });

      await api.execInSimulation(CONTAINER_ID, [SPAWN_ENTRYPOINT, 'robot_1', '-2.0', '-0.5', '0.0']);
      // Pre-warm is fire-and-forget, parked on its first poll sleep; drive it.
      await vi.advanceTimersByTimeAsync(1500);

      const launched = vi
        .mocked(extensionApi.process.exec)
        .mock.calls.some(c => (c[1] as string[]).some(a => typeof a === 'string' && a.includes(NAV2_ENTRYPOINT)));
      expect(launched).toBe(true);
    });

    it('rejects arbitrary commands', async () => {
      await expect(api.execInSimulation(CONTAINER_ID, ['bash', '-c', 'id'])).rejects.toThrow(/Only /);
    });

    it('rejects non-simulation containers', async () => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        { Id: CONTAINER_ID, Image: 'docker.io/library/nginx:latest', Labels: {} },
      ] as unknown as extensionApi.ContainerInfo[]);

      await expect(api.execInSimulation(CONTAINER_ID, [SPAWN_ENTRYPOINT, 'robot_1', '0', '0', '0'])).rejects.toThrow(
        'Not a Physical AI simulation container',
      );
    });
  });

  describe('launchSimulation security', () => {
    beforeEach(() => {
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockImplementation((key: string) => {
          if (key === 'simulation.gpuPassthrough') return false;
          return '';
        }),
        update: vi.fn(),
      } as unknown as extensionApi.Configuration);
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        { engineId: 'engine-1', RepoTags: ['quay.io/sgahlot/ros2-jazzy-sim:noble'] },
      ] as unknown as extensionApi.ImageInfo[]);
      vi.mocked(extensionApi.containerEngine.createContainer).mockResolvedValue({
        id: 'created-1',
      } as unknown as extensionApi.ContainerCreateResult);
      vi.mocked(extensionApi.containerEngine.startContainer).mockResolvedValue(undefined);
    });

    it('forces gazebo entrypoint and rejects custom Cmd', async () => {
      await expect(
        api.launchSimulation('quay.io/sgahlot/ros2-jazzy-sim:noble', 'pai-sim-test', {
          cmd: ['/bin/bash', '-c', 'id'],
        }),
      ).rejects.toThrow(/only allows Cmd/);

      await api.launchSimulation('quay.io/sgahlot/ros2-jazzy-sim:noble', 'pai-sim-ok', undefined);
      expect(extensionApi.containerEngine.createContainer).toHaveBeenCalledWith(
        'engine-1',
        expect.objectContaining({
          Cmd: [GAZEBO_ENTRYPOINT],
          Labels: expect.objectContaining({
            [SIM_CONTAINER_LABEL]: SIM_CONTAINER_LABEL_VALUE,
          }),
        }),
      );
    });

    it('rejects dangerous env keys and keeps role label forced', async () => {
      await expect(
        api.launchSimulation('quay.io/sgahlot/ros2-jazzy-sim:noble', 'pai-sim-env', {
          env: { PATH: '/evil', LD_PRELOAD: 'x.so' },
        }),
      ).rejects.toThrow(/not allowed/);

      await api.launchSimulation('quay.io/sgahlot/ros2-jazzy-sim:noble', 'pai-sim-labels', {
        labels: {
          'io.physical-ai.role': 'attacker',
          'app.kubernetes.io/name': 'sim',
        },
        env: { WORLD_NAME: 'empty', ROBOTS: 'robot_1:0:0:0' },
      });

      const createArg = vi.mocked(extensionApi.containerEngine.createContainer).mock.calls[0][1] as {
        Labels: Record<string, string>;
        Env: string[];
      };
      expect(createArg.Labels[SIM_CONTAINER_LABEL]).toBe(SIM_CONTAINER_LABEL_VALUE);
      expect(createArg.Env).toEqual(
        expect.arrayContaining([
          'LIBGL_ALWAYS_SOFTWARE=1',
          'GALLIUM_DRIVER=llvmpipe',
          'WORLD_NAME=empty',
          'ROBOTS=robot_1:0:0:0',
        ]),
      );
      expect(createArg.Env.some(e => e.startsWith('PATH='))).toBe(false);
    });

    it('rejects non-sim image tags', async () => {
      await expect(api.launchSimulation('docker.io/library/nginx:latest', 'pai-sim-bad', undefined)).rejects.toThrow(
        /not allowed/,
      );
      expect(extensionApi.containerEngine.createContainer).not.toHaveBeenCalled();
    });

    it('honors optional digest allowlist preference', async () => {
      const digest =
        'quay.io/sgahlot/ros2-jazzy-sim@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue(digest),
        update: vi.fn(),
      } as unknown as extensionApi.Configuration);
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        { engineId: 'engine-1', RepoTags: [digest] },
      ] as unknown as extensionApi.ImageInfo[]);

      await expect(
        api.launchSimulation('quay.io/sgahlot/ros2-jazzy-sim:noble', 'pai-sim-pin', undefined),
      ).rejects.toThrow(/not allowed/);

      await api.launchSimulation(digest, 'pai-sim-pinned', undefined);
      expect(extensionApi.containerEngine.createContainer).toHaveBeenCalledWith(
        'engine-1',
        expect.objectContaining({ Image: digest }),
      );
    });

    it('passes /dev/dri and PHYSICAL_AI_USE_GPU on arm64 when GPU passthrough is enabled', async () => {
      const archSpy = vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64');
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockImplementation((key: string) => {
          if (key === 'simulation.gpuPassthrough') return true;
          return '';
        }),
        update: vi.fn(),
      } as unknown as extensionApi.Configuration);

      await api.launchSimulation('quay.io/sgahlot/ros2-jazzy-sim:noble', 'pai-sim-gpu', undefined);

      const createArg = vi.mocked(extensionApi.containerEngine.createContainer).mock.calls[0][1] as {
        Env: string[];
        HostConfig: { Devices?: Array<{ PathOnHost: string }> };
      };
      expect(createArg.Env).toContain('PHYSICAL_AI_USE_GPU=1');
      expect(createArg.Env.some(e => e.startsWith('LIBGL_ALWAYS_SOFTWARE='))).toBe(false);
      expect(createArg.HostConfig.Devices?.map(d => d.PathOnHost)).toEqual(['/dev/dri/card0', '/dev/dri/renderD128']);
      archSpy.mockRestore();
    });
  });

  describe('openSimulationInBrowser security', () => {
    beforeEach(() => {
      vi.mocked(extensionApi.env.openExternal).mockResolvedValue(true);
      vi.mocked(extensionApi.Uri.parse).mockImplementation(
        (s: string) => ({ toString: () => s }) as unknown as extensionApi.Uri,
      );
    });

    it('opens allowlisted ports only', async () => {
      await api.openSimulationInBrowser(6080);
      expect(extensionApi.Uri.parse).toHaveBeenCalledWith(
        'http://localhost:6080/vnc.html?autoconnect=true&reconnect=true&reconnect_delay=2000&resize=scale',
      );
      expect(extensionApi.env.openExternal).toHaveBeenCalled();

      await api.openSimulationInBrowser(8080);
      expect(extensionApi.Uri.parse).toHaveBeenCalledWith('http://localhost:8080');
    });

    it('opens noVNC path when host port is remapped', async () => {
      await api.openSimulationInBrowser(16080, 6080);
      expect(extensionApi.Uri.parse).toHaveBeenCalledWith(
        'http://localhost:16080/vnc.html?autoconnect=true&reconnect=true&reconnect_delay=2000&resize=scale',
      );
    });

    it('rejects non-allowlisted ports', async () => {
      await expect(api.openSimulationInBrowser(22)).rejects.toThrow(/not allowed/);
      await expect(api.openSimulationInBrowser(3000)).rejects.toThrow(/not allowed/);
      expect(extensionApi.env.openExternal).not.toHaveBeenCalled();
    });
  });

  describe('openUrlInBrowser', () => {
    beforeEach(() => {
      vi.mocked(extensionApi.env.openExternal).mockResolvedValue(true);
      vi.mocked(extensionApi.Uri.parse).mockImplementation(
        (s: string) => ({ toString: () => s }) as unknown as extensionApi.Uri,
      );
    });

    it('opens an https Route URL in the host browser', async () => {
      await api.openUrlInBrowser('https://host.apps.example.com');
      expect(extensionApi.Uri.parse).toHaveBeenCalledWith('https://host.apps.example.com');
      expect(extensionApi.env.openExternal).toHaveBeenCalled();
    });

    it('rejects non-http(s) URLs', async () => {
      await expect(api.openUrlInBrowser('file:///etc/passwd')).rejects.toThrow(/http/);
      await expect(api.openUrlInBrowser('not a url')).rejects.toThrow(/Invalid URL/);
      expect(extensionApi.env.openExternal).not.toHaveBeenCalled();
    });
  });

  describe('deleteSimulation', () => {
    const CONTAINER_ID = 'abc123def456';

    it('force-removes the container with podman rm -f and shows a noVNC tab hint', async () => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        { ...simContainer(CONTAINER_ID, 'quay.io/ns/ros2-jazzy-sim:noble'), engineId: 'podman' },
      ] as unknown as extensionApi.ContainerInfo[]);
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: '',
        stderr: '',
        command: 'podman',
      } as extensionApi.RunResult);
      vi.mocked(extensionApi.window.showInformationMessage).mockResolvedValue(undefined);

      await api.deleteSimulation(CONTAINER_ID);

      expect(extensionApi.process.exec).toHaveBeenCalledWith('podman', ['rm', '-f', CONTAINER_ID]);
      expect(extensionApi.window.showInformationMessage).toHaveBeenCalledWith(SIM_STOPPED_BROWSER_HINT);
    });
  });

  describe('OpenShift deployment', () => {
    const KUBECONFIG_PATH = '/home/user/.kube/config';
    const CONTEXT = 'sgahlot-pd-extn/api-ai-dev01:6443/sgahlot';
    const CONFIG = {
      name: 'ros2-jazzy-sim',
      namespace: 'sgahlot-pd-extn',
      image: 'quay.io/ecosystem-appeng/ros2-jazzy-sim:noble-amd64',
    };

    function mockKubeconfig(context?: string, namespace?: string, clusterServer?: string): void {
      vi.mocked(extensionApi.kubernetes.getKubeconfig).mockReturnValue({
        fsPath: KUBECONFIG_PATH,
      } as unknown as extensionApi.Uri);
      let content: string;
      if (!context) {
        content = 'apiVersion: v1\nkind: Config\n';
      } else {
        // A realistic two-entry contexts list: the current context (optionally with a
        // namespace) plus a decoy whose namespace must NOT be picked up. `clusters:` is
        // only included when a server URL is requested, so tests that don't care about
        // it keep an exact-equality-friendly context object (no stray clusterUrl).
        const nsLine = namespace ? `\n    namespace: ${namespace}` : '';
        const clustersBlock = clusterServer
          ? 'clusters:\n' +
            '- cluster:\n' +
            `    server: ${clusterServer}\n` +
            '  name: some-cluster\n' +
            '- cluster:\n' +
            '    server: https://decoy.example.com:6443\n' +
            '  name: other-cluster\n'
          : '';
        content =
          'apiVersion: v1\n' +
          `current-context: ${context}\n` +
          clustersBlock +
          'contexts:\n' +
          '- context:\n' +
          '    cluster: some-cluster\n' +
          `    user: some-user${nsLine}\n` +
          `  name: ${context}\n` +
          '- context:\n' +
          '    cluster: other-cluster\n' +
          '    namespace: decoy-ns\n' +
          '    user: other-user\n' +
          '  name: other-context\n' +
          'kind: Config\n';
      }
      vi.mocked(readFile).mockResolvedValue(content as unknown as Awaited<ReturnType<typeof readFile>>);
    }

    describe('getOpenShiftContext', () => {
      it('parses current-context from the kubeconfig', async () => {
        mockKubeconfig(CONTEXT);
        const ctx = await api.getOpenShiftContext();
        expect(ctx).toEqual({ context: CONTEXT, kubeconfigPath: KUBECONFIG_PATH });
      });

      it('seeds the namespace from the current context', async () => {
        mockKubeconfig(CONTEXT, 'my-project');
        const ctx = await api.getOpenShiftContext();
        expect(ctx).toEqual({ context: CONTEXT, kubeconfigPath: KUBECONFIG_PATH, namespace: 'my-project' });
      });

      it('leaves the namespace undefined when the current context sets none', async () => {
        // Must not pick up the decoy context's namespace.
        mockKubeconfig(CONTEXT);
        const ctx = await api.getOpenShiftContext();
        expect(ctx?.context).toBe(CONTEXT);
        expect(ctx?.namespace).toBeUndefined();
      });

      it('returns undefined when no current-context is set', async () => {
        mockKubeconfig();
        expect(await api.getOpenShiftContext()).toBeUndefined();
      });

      it("seeds clusterUrl from the current context's cluster server", async () => {
        mockKubeconfig(CONTEXT, 'my-project', 'https://api.cluster.example.com:6443');
        const ctx = await api.getOpenShiftContext();
        expect(ctx?.clusterUrl).toBe('https://api.cluster.example.com:6443');
      });

      it('leaves clusterUrl undefined when no clusters: block is present', async () => {
        mockKubeconfig(CONTEXT, 'my-project');
        const ctx = await api.getOpenShiftContext();
        expect(ctx?.clusterUrl).toBeUndefined();
      });

      it('returns undefined when the kubeconfig cannot be read', async () => {
        vi.mocked(extensionApi.kubernetes.getKubeconfig).mockReturnValue({
          fsPath: KUBECONFIG_PATH,
        } as unknown as extensionApi.Uri);
        vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
        expect(await api.getOpenShiftContext()).toBeUndefined();
      });
    });

    describe('listKubeContexts', () => {
      it('lists every context in the kubeconfig with its namespace and cluster URL', async () => {
        mockKubeconfig(CONTEXT, 'my-project', 'https://api.cluster.example.com:6443');
        const contexts = await api.listKubeContexts();
        expect(contexts).toEqual([
          { name: CONTEXT, clusterUrl: 'https://api.cluster.example.com:6443', namespace: 'my-project' },
          { name: 'other-context', clusterUrl: 'https://decoy.example.com:6443', namespace: 'decoy-ns' },
        ]);
      });

      it('leaves clusterUrl undefined for a context whose cluster cannot be resolved', async () => {
        mockKubeconfig(CONTEXT, 'my-project');
        const contexts = await api.listKubeContexts();
        expect(contexts.find(c => c.name === CONTEXT)?.clusterUrl).toBeUndefined();
      });

      it('returns [] when there is no contexts: block', async () => {
        mockKubeconfig();
        expect(await api.listKubeContexts()).toEqual([]);
      });

      it('returns [] when the kubeconfig cannot be read', async () => {
        vi.mocked(extensionApi.kubernetes.getKubeconfig).mockReturnValue({
          fsPath: KUBECONFIG_PATH,
        } as unknown as extensionApi.Uri);
        vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
        expect(await api.listKubeContexts()).toEqual([]);
      });
    });

    describe('checkOpenShiftLogin', () => {
      it('reports logged in when oc whoami resolves with a user', async () => {
        vi.mocked(extensionApi.process.exec).mockResolvedValue({
          stdout: 'sgahlot\n',
          stderr: '',
          command: 'oc',
        } as extensionApi.RunResult);
        expect(await api.checkOpenShiftLogin()).toEqual({ loggedIn: true });
      });

      it('reports not logged in on an Unauthorized error', async () => {
        vi.mocked(extensionApi.process.exec).mockRejectedValue({
          exitCode: 1,
          stderr: 'error: You must be logged in to the server (Unauthorized)',
        });
        const result = await api.checkOpenShiftLogin();
        expect(result.loggedIn).toBe(false);
        expect(result.message).toMatch(/oc login/);
      });

      it('reports not logged in when the kubeconfig is missing/incomplete', async () => {
        vi.mocked(extensionApi.process.exec).mockRejectedValue({
          exitCode: 1,
          stderr: 'error: Missing or incomplete configuration info',
        });
        const result = await api.checkOpenShiftLogin();
        expect(result.loggedIn).toBe(false);
        expect(result.message).toMatch(/oc login/);
      });

      it('falls back to the generic oc-error message for other failures', async () => {
        vi.mocked(extensionApi.process.exec).mockRejectedValue({
          exitCode: 127,
          stderr: '',
          message: 'command not found: oc',
        });
        const result = await api.checkOpenShiftLogin();
        expect(result.loggedIn).toBe(false);
        expect(result.message).toMatch(/OpenShift CLI/);
      });

      it('passes --context when a context is provided (S8-10)', async () => {
        vi.mocked(extensionApi.process.exec).mockResolvedValue({
          stdout: 'sgahlot\n',
          stderr: '',
          command: 'oc',
        } as extensionApi.RunResult);
        await api.checkOpenShiftLogin('other-context');
        expect(extensionApi.process.exec).toHaveBeenCalledWith('oc', ['--context', 'other-context', 'whoami']);
      });

      it('omits --context when none is provided', async () => {
        vi.mocked(extensionApi.process.exec).mockResolvedValue({
          stdout: 'sgahlot\n',
          stderr: '',
          command: 'oc',
        } as extensionApi.RunResult);
        await api.checkOpenShiftLogin();
        expect(extensionApi.process.exec).toHaveBeenCalledWith('oc', ['whoami']);
      });
    });

    describe('listOpenShiftProjects', () => {
      it('parses project names, stripping the resource-type prefix', async () => {
        vi.mocked(extensionApi.process.exec).mockResolvedValue({
          stdout: 'project.project.openshift.io/my-project\nproject.project.openshift.io/other-ns\n',
          stderr: '',
          command: 'oc',
        } as extensionApi.RunResult);
        expect(await api.listOpenShiftProjects()).toEqual(['my-project', 'other-ns']);
      });

      it('returns [] when oc fails (not logged in, oc missing, etc.)', async () => {
        vi.mocked(extensionApi.process.exec).mockRejectedValue({
          exitCode: 1,
          stderr: 'error: You must be logged in to the server (Unauthorized)',
        });
        expect(await api.listOpenShiftProjects()).toEqual([]);
      });

      it('returns [] when stdout is empty', async () => {
        vi.mocked(extensionApi.process.exec).mockResolvedValue({
          stdout: '',
          stderr: '',
          command: 'oc',
        } as extensionApi.RunResult);
        expect(await api.listOpenShiftProjects()).toEqual([]);
      });

      it('passes --context when a context is provided (S8-10)', async () => {
        vi.mocked(extensionApi.process.exec).mockResolvedValue({
          stdout: 'project.project.openshift.io/my-project\n',
          stderr: '',
          command: 'oc',
        } as extensionApi.RunResult);
        await api.listOpenShiftProjects('other-context');
        expect(extensionApi.process.exec).toHaveBeenCalledWith('oc', [
          '--context',
          'other-context',
          'get',
          'projects',
          '-o',
          'name',
        ]);
      });

      it('omits --context when none is provided', async () => {
        vi.mocked(extensionApi.process.exec).mockResolvedValue({
          stdout: 'project.project.openshift.io/my-project\n',
          stderr: '',
          command: 'oc',
        } as extensionApi.RunResult);
        await api.listOpenShiftProjects();
        expect(extensionApi.process.exec).toHaveBeenCalledWith('oc', ['get', 'projects', '-o', 'name']);
      });
    });

    describe('generateOpenShiftManifests', () => {
      it('renders a three-document YAML preview', async () => {
        const { yaml } = await api.generateOpenShiftManifests(CONFIG);
        expect(yaml).toContain('kind: "Deployment"');
        expect(yaml).toContain('kind: "Service"');
        expect(yaml).toContain('kind: "Route"');
        expect(yaml).toContain(CONFIG.image);
      });

      it('rejects an invalid image reference', async () => {
        await expect(api.generateOpenShiftManifests({ ...CONFIG, image: 'evil; rm -rf /' })).rejects.toThrow(
          /Invalid image/,
        );
      });
    });

    describe('deployToOpenShift', () => {
      it('applies the manifests to the current context and returns the route URL', async () => {
        mockKubeconfig(CONTEXT);
        vi.mocked(extensionApi.kubernetes.createResources).mockResolvedValue(undefined);
        vi.mocked(extensionApi.process.exec).mockResolvedValue({
          stdout: 'ros2-jazzy-sim-sgahlot-pd-extn.apps.ai-dev01.example.com',
          stderr: '',
          command: 'oc',
        } as extensionApi.RunResult);

        const result = await api.deployToOpenShift(CONFIG);

        const createCall = vi.mocked(extensionApi.kubernetes.createResources).mock.calls[0];
        expect(createCall[0]).toBe(CONTEXT);
        expect((createCall[1] as Array<{ kind: string }>).map(m => m.kind)).toEqual(['Deployment', 'Service', 'Route']);
        expect(result.applied).toEqual(['Deployment', 'Service', 'Route']);
        expect(result.routeUrl).toBe('https://ros2-jazzy-sim-sgahlot-pd-extn.apps.ai-dev01.example.com');
      });

      it('still succeeds (no route URL) when the route host is not readable yet', async () => {
        mockKubeconfig(CONTEXT);
        vi.mocked(extensionApi.kubernetes.createResources).mockResolvedValue(undefined);
        vi.mocked(extensionApi.process.exec).mockRejectedValue(new Error('not admitted'));

        const result = await api.deployToOpenShift(CONFIG);
        expect(result.routeUrl).toBeUndefined();
        expect(result.message).toMatch(/not admitted/i);
      });

      it('surfaces createResources failures with namespace context', async () => {
        mockKubeconfig(CONTEXT);
        vi.mocked(extensionApi.kubernetes.createResources).mockRejectedValue(
          new Error('admission webhook "quota.openshift.io/ValidateQuota" denied the request'),
        );

        await expect(api.deployToOpenShift(CONFIG)).rejects.toThrow(
          /Failed to apply manifests to namespace sgahlot-pd-extn.*admission webhook/i,
        );
      });

      it('throws when there is no current context', async () => {
        mockKubeconfig();
        await expect(api.deployToOpenShift(CONFIG)).rejects.toThrow(/context/i);
        expect(extensionApi.kubernetes.createResources).not.toHaveBeenCalled();
      });

      it('validates the config before touching the cluster', async () => {
        mockKubeconfig(CONTEXT);
        await expect(api.deployToOpenShift({ ...CONFIG, name: 'BAD_NAME' })).rejects.toThrow();
        expect(extensionApi.kubernetes.createResources).not.toHaveBeenCalled();
      });

      it("targets config.context over the kubeconfig's current-context when set (S8-10)", async () => {
        mockKubeconfig(CONTEXT);
        vi.mocked(extensionApi.kubernetes.createResources).mockResolvedValue(undefined);
        vi.mocked(extensionApi.process.exec).mockResolvedValue({
          stdout: '',
          stderr: '',
          command: 'oc',
        } as extensionApi.RunResult);

        await api.deployToOpenShift({ ...CONFIG, context: 'other-context' });

        const createCall = vi.mocked(extensionApi.kubernetes.createResources).mock.calls[0];
        expect(createCall[0]).toBe('other-context');
        const routeArgs = vi.mocked(extensionApi.process.exec).mock.calls[0][1] as string[];
        expect(routeArgs.slice(0, 2)).toEqual(['--context', 'other-context']);
      });

      it('deletes any prior Hummingbird nginx ConfigMap before creating resources (APPENG-6227)', async () => {
        // extensionApi.kubernetes.createResources() re-applies an existing Deployment/Service
        // correctly but leaves an already-existing ConfigMap untouched (confirmed live against
        // a real cluster), so a redeploy must delete it first to avoid serving a stale proxy config.
        mockKubeconfig(CONTEXT);
        vi.mocked(extensionApi.kubernetes.createResources).mockResolvedValue(undefined);
        vi.mocked(extensionApi.process.exec).mockResolvedValue({
          stdout: 'route-host.example.com',
          stderr: '',
          command: 'oc',
        } as extensionApi.RunResult);

        await api.deployToOpenShift({ ...CONFIG, useHummingbirdSidecar: true });

        const deleteArgs = vi.mocked(extensionApi.process.exec).mock.calls[0][1] as string[];
        expect(deleteArgs).toEqual([
          'delete',
          'configmap',
          'ros2-jazzy-sim-hummingbird-nginx-conf',
          '-n',
          'sgahlot-pd-extn',
          '--ignore-not-found',
        ]);
        // The delete must happen before createResources, not after.
        const deleteOrder = vi.mocked(extensionApi.process.exec).mock.invocationCallOrder[0];
        const createOrder = vi.mocked(extensionApi.kubernetes.createResources).mock.invocationCallOrder[0];
        expect(deleteOrder).toBeLessThan(createOrder);
      });

      it('does not attempt a ConfigMap delete when the sidecar is disabled', async () => {
        mockKubeconfig(CONTEXT);
        vi.mocked(extensionApi.kubernetes.createResources).mockResolvedValue(undefined);
        vi.mocked(extensionApi.process.exec).mockResolvedValue({
          stdout: 'route-host.example.com',
          stderr: '',
          command: 'oc',
        } as extensionApi.RunResult);

        await api.deployToOpenShift(CONFIG);

        const calls = vi.mocked(extensionApi.process.exec).mock.calls as unknown as string[][];
        expect(calls.some(call => call[1]?.includes('configmap'))).toBe(false);
      });
    });

    describe('listOpenShiftDeployments', () => {
      it('maps oc output to workloads with readiness and route URL', async () => {
        vi.mocked(extensionApi.process.exec).mockImplementation(async (_cmd, args) => {
          const a = args as string[];
          if (a[0] === 'get' && a[1] === 'deployment') {
            return {
              stdout: JSON.stringify({
                items: [
                  {
                    metadata: { name: 'ros2-jazzy-sim' },
                    spec: {
                      replicas: 1,
                      template: { spec: { containers: [{ image: CONFIG.image }] } },
                    },
                    status: { readyReplicas: 1 },
                  },
                ],
              }),
              stderr: '',
              command: 'oc',
            } as extensionApi.RunResult;
          }
          // oc get route
          return { stdout: 'host.apps.example.com', stderr: '', command: 'oc' } as extensionApi.RunResult;
        });

        const workloads = await api.listOpenShiftDeployments('sgahlot-pd-extn');
        expect(workloads).toHaveLength(1);
        expect(workloads[0]).toMatchObject({
          name: 'ros2-jazzy-sim',
          namespace: 'sgahlot-pd-extn',
          replicas: 1,
          readyReplicas: 1,
          ready: true,
          image: CONFIG.image,
          routeUrl: 'https://host.apps.example.com',
          hasHummingbirdSidecar: false,
        });
        const listArgs = vi.mocked(extensionApi.process.exec).mock.calls[0][1] as string[];
        expect(listArgs).toContain('app.kubernetes.io/part-of=physical-ai');
      });

      it('detects the Hummingbird nginx sidecar from the live Deployment container list (APPENG-6227)', async () => {
        // Read live from the cluster's own Deployment spec rather than remembered client
        // state, so it's correct regardless of when/how the workload was deployed.
        vi.mocked(extensionApi.process.exec).mockImplementation(async (_cmd, args) => {
          const a = args as string[];
          if (a[0] === 'get' && a[1] === 'deployment') {
            return {
              stdout: JSON.stringify({
                items: [
                  {
                    metadata: { name: 'ros2-jazzy-sim' },
                    spec: {
                      replicas: 1,
                      template: {
                        spec: {
                          containers: [{ name: 'sim', image: CONFIG.image }, { name: 'hummingbird-nginx' }],
                        },
                      },
                    },
                    status: { readyReplicas: 1 },
                  },
                ],
              }),
              stderr: '',
              command: 'oc',
            } as extensionApi.RunResult;
          }
          return { stdout: 'host.apps.example.com', stderr: '', command: 'oc' } as extensionApi.RunResult;
        });

        const [w] = await api.listOpenShiftDeployments('sgahlot-pd-extn');
        expect(w.hasHummingbirdSidecar).toBe(true);
      });

      it('reports not-ready when readyReplicas is below replicas', async () => {
        vi.mocked(extensionApi.process.exec).mockImplementation(async (_cmd, args) => {
          const a = args as string[];
          if (a[0] === 'get' && a[1] === 'deployment') {
            return {
              stdout: JSON.stringify({
                items: [{ metadata: { name: 'sim' }, spec: { replicas: 1 }, status: {} }],
              }),
              stderr: '',
              command: 'oc',
            } as extensionApi.RunResult;
          }
          return { stdout: '', stderr: '', command: 'oc' } as extensionApi.RunResult;
        });

        const [w] = await api.listOpenShiftDeployments('sgahlot-pd-extn');
        expect(w.ready).toBe(false);
        expect(w.routeUrl).toBeUndefined();
      });

      it('surfaces a helpful error when oc is missing', async () => {
        vi.mocked(extensionApi.process.exec).mockRejectedValue({ stderr: 'oc: command not found' });
        await expect(api.listOpenShiftDeployments('sgahlot-pd-extn')).rejects.toThrow(/oc/i);
      });

      it('rejects an invalid namespace', async () => {
        await expect(api.listOpenShiftDeployments('BAD NS')).rejects.toThrow(/namespace/i);
      });

      it('passes --context when a context is provided (S8-10)', async () => {
        vi.mocked(extensionApi.process.exec).mockResolvedValue({
          stdout: JSON.stringify({ items: [] }),
          stderr: '',
          command: 'oc',
        } as extensionApi.RunResult);
        await api.listOpenShiftDeployments('sgahlot-pd-extn', 'other-context');
        const listArgs = vi.mocked(extensionApi.process.exec).mock.calls[0][1] as string[];
        expect(listArgs.slice(0, 2)).toEqual(['--context', 'other-context']);
      });
    });

    describe('deleteOpenShiftDeployment', () => {
      it('deletes the deployment, service and route', async () => {
        vi.mocked(extensionApi.process.exec).mockResolvedValue({
          stdout: '',
          stderr: '',
          command: 'oc',
        } as extensionApi.RunResult);
        await api.deleteOpenShiftDeployment('sgahlot-pd-extn', 'ros2-jazzy-sim');
        expect(extensionApi.process.exec).toHaveBeenCalledWith('oc', [
          'delete',
          'deployment,service,route,configmap',
          '-l',
          'app=ros2-jazzy-sim',
          '-n',
          'sgahlot-pd-extn',
          '--ignore-not-found',
        ]);
      });

      it('rejects an invalid name before running oc', async () => {
        await expect(api.deleteOpenShiftDeployment('sgahlot-pd-extn', 'BAD NAME')).rejects.toThrow();
        expect(extensionApi.process.exec).not.toHaveBeenCalled();
      });

      it('passes --context when a context is provided (S8-10)', async () => {
        vi.mocked(extensionApi.process.exec).mockResolvedValue({
          stdout: '',
          stderr: '',
          command: 'oc',
        } as extensionApi.RunResult);
        await api.deleteOpenShiftDeployment('sgahlot-pd-extn', 'ros2-jazzy-sim', 'other-context');
        expect(extensionApi.process.exec).toHaveBeenCalledWith('oc', [
          '--context',
          'other-context',
          'delete',
          'deployment,service,route,configmap',
          '-l',
          'app=ros2-jazzy-sim',
          '-n',
          'sgahlot-pd-extn',
          '--ignore-not-found',
        ]);
      });
    });

    describe('spawnRobotInOpenShift', () => {
      const NS = 'sgahlot-pd-extn';
      const NAME = 'ros2-jazzy-sim';
      const POD = 'ros2-jazzy-sim-abc-123';

      function mockPodLookup(pod: string = POD, image = 'quay.io/ns/ros2-jazzy-sim:noble-amd64') {
        vi.mocked(extensionApi.process.exec).mockImplementation(async (_cmd, args) => {
          const a = args as string[];
          if (a[0] === 'get' && a[1] === 'pods') {
            return { stdout: pod, stderr: '', command: 'oc' } as extensionApi.RunResult;
          }
          if (a[0] === 'get' && a[1] === 'deployment') {
            return { stdout: image, stderr: '', command: 'oc' } as extensionApi.RunResult;
          }
          return { stdout: '', stderr: '', command: 'oc' } as extensionApi.RunResult;
        });
      }

      it('resolves a running pod then backgrounds the spawn entrypoint with nohup', async () => {
        mockPodLookup();

        await api.spawnRobotInOpenShift(NS, NAME, 'robot_1', '-2.0', '-0.5', '0.0');

        const podCall = vi
          .mocked(extensionApi.process.exec)
          .mock.calls.find(c => (c[1] as string[])[0] === 'get' && (c[1] as string[])[1] === 'pods');
        expect(podCall![1]).toContain(`app=${NAME}`);
        expect(podCall![1]).toContain('--field-selector=status.phase=Running');

        const execCall = vi.mocked(extensionApi.process.exec).mock.calls.find(c => (c[1] as string[])[0] === 'exec');
        expect(execCall).toBeDefined();
        const execA = execCall![1] as string[];
        expect(execA.slice(0, 5)).toEqual(['exec', '-n', NS, POD, '--']);
        expect(execA).not.toContain('-d');
        const remote = execA[execA.length - 1];
        expect(remote).toContain('nohup');
        expect(remote).toContain(SPAWN_ENTRYPOINT);
        expect(remote).toContain(`'robot_1'`);
        expect(remote).toContain(`'-2.0'`);
        expect(remote).toMatch(/>"\/tmp\/pai-.*\.log" 2>&1 &$/);
      });

      it('rejects an injectable robot name before touching the cluster', async () => {
        await expect(api.spawnRobotInOpenShift(NS, NAME, 'robot;id', '0', '0', '0')).rejects.toThrow();
        expect(extensionApi.process.exec).not.toHaveBeenCalled();
      });

      it('rejects an invalid namespace before touching the cluster', async () => {
        await expect(api.spawnRobotInOpenShift('BAD NS', NAME, 'robot_1', '0', '0', '0')).rejects.toThrow(/namespace/i);
        expect(extensionApi.process.exec).not.toHaveBeenCalled();
      });

      it('throws when no running pod is found', async () => {
        mockPodLookup('');
        await expect(api.spawnRobotInOpenShift(NS, NAME, 'robot_1', '0', '0', '0')).rejects.toThrow(/No running pod/);
      });

      it('warms Nav2 in the background after a jazzy spawn', async () => {
        const GZ_POSE =
          'Requesting state for world [tb3_sandbox]...\n\nModel: [42]\n  - Name: robot_1\n  - Pose [ XYZ (m) ] [ RPY (rad) ]:\n    [0.000000 0.000000 0.010000]\n    [0.000000 0.000000 0.000000]';
        vi.mocked(extensionApi.process.exec).mockImplementation(async (_cmd, args) => {
          const a = args as string[];
          if (a[0] === 'get' && a[1] === 'pods')
            return { stdout: POD, stderr: '', command: 'oc' } as extensionApi.RunResult;
          if (a[0] === 'get' && a[1] === 'deployment')
            return {
              stdout: 'quay.io/ns/ros2-jazzy-sim:noble-amd64',
              stderr: '',
              command: 'oc',
            } as extensionApi.RunResult;
          const script = a.find((s): s is string => typeof s === 'string' && s.includes('source'));
          if (script?.includes('gz model'))
            return { stdout: GZ_POSE, stderr: '', command: 'oc' } as extensionApi.RunResult;
          // TF never ready + pgrep empty → forces a Nav2 launch.
          return { stdout: '', stderr: '', command: 'oc' } as extensionApi.RunResult;
        });

        await api.spawnRobotInOpenShift(NS, NAME, 'robot_1', '-2.0', '-0.5', '0.0');
        // Pre-warm is fire-and-forget, parked on its first poll sleep; drive it.
        await vi.advanceTimersByTimeAsync(1500);

        const launched = vi
          .mocked(extensionApi.process.exec)
          .mock.calls.some(c => (c[1] as string[]).some(a => typeof a === 'string' && a.includes(NAV2_ENTRYPOINT)));
        expect(launched).toBe(true);
      });

      it('does not warm Nav2 for a humble spawn', async () => {
        mockPodLookup(POD, 'quay.io/ns/ros2-humble-turtlebot3:sloretz-amd64');
        await api.spawnRobotInOpenShift(NS, NAME, 'robot_1', '-2.0', '-0.5', '0.0');
        await vi.advanceTimersByTimeAsync(5000);

        const launched = vi
          .mocked(extensionApi.process.exec)
          .mock.calls.some(c => (c[1] as string[]).some(a => typeof a === 'string' && a.includes(NAV2_ENTRYPOINT)));
        expect(launched).toBe(false);
      });
    });

    describe('despawnRobotInOpenShift', () => {
      const NS = 'sgahlot-pd-extn';
      const NAME = 'ros2-jazzy-sim';
      const POD = 'ros2-jazzy-sim-abc-123';

      function mockOc(image = 'quay.io/ns/ros2-jazzy-sim:noble-amd64') {
        vi.mocked(extensionApi.process.exec).mockImplementation(async (_cmd, args) => {
          const a = args as string[];
          if (a[0] === 'get' && a[1] === 'deployment') {
            return { stdout: image, stderr: '', command: 'oc' } as extensionApi.RunResult;
          }
          if (a[0] === 'get' && a[1] === 'pods') {
            return { stdout: POD, stderr: '', command: 'oc' } as extensionApi.RunResult;
          }
          return { stdout: '', stderr: '', command: 'oc' } as extensionApi.RunResult;
        });
      }

      it('resolves the pod then kills processes and removes the model over oc exec', async () => {
        mockOc();
        await api.despawnRobotInOpenShift(NS, NAME, 'robot_1');

        const calls = vi.mocked(extensionApi.process.exec).mock.calls;
        const pkillCall = calls.find(c => (c[1] as string[]).some(a => typeof a === 'string' && a.includes('pkill')));
        expect(pkillCall).toBeDefined();
        expect((pkillCall![1] as string[]).slice(0, 5)).toEqual(['exec', '-n', NS, POD, '--']);

        const gzCall = calls.find(c => (c[1] as string[]).some(a => typeof a === 'string' && a.includes('gz service')));
        expect(gzCall).toBeDefined();
        const gzScript = (gzCall![1] as string[]).find(a => typeof a === 'string' && a.includes('gz service'))!;
        // oc path gets the writable HOME prefix so `gz` can source ROS under HOME=/.
        expect(gzScript).toContain('export HOME=/tmp/ros-home');
      });

      it('rejects an injectable robot name before touching the cluster', async () => {
        await expect(api.despawnRobotInOpenShift(NS, NAME, 'robot;id')).rejects.toThrow(/robot name/i);
        expect(extensionApi.process.exec).not.toHaveBeenCalled();
      });

      it('clears the warm status for the robot', async () => {
        mockOc();
        await api.despawnRobotInOpenShift(NS, NAME, 'robot_1');
        expect(await api.getRobotWarmStatusInOpenShift(NS, NAME, 'robot_1')).toBe('idle');
      });
    });

    describe('listSpawnedRobotsInOpenShift', () => {
      const NS = 'sgahlot-pd-extn';
      const NAME = 'ros2-jazzy-sim';
      const POD = 'ros2-jazzy-sim-abc-123';

      function mockOc(nodeListStdout: string, options?: { image?: string; exitCode?: number }) {
        const image = options?.image ?? 'quay.io/ns/ros2-jazzy-sim:noble-amd64';
        vi.mocked(extensionApi.process.exec).mockImplementation(async (_cmd, args) => {
          // Skip an optional leading `--context <name>` pair (S8-10) before checking the subcommand.
          const a = ((args as string[])[0] === '--context' ? (args as string[]).slice(2) : args) as string[];
          if (a[0] === 'get' && a[1] === 'deployment') {
            return { stdout: image, stderr: '', command: 'oc' } as extensionApi.RunResult;
          }
          if (a[0] === 'get' && a[1] === 'pods') {
            return { stdout: POD, stderr: '', command: 'oc' } as extensionApi.RunResult;
          }
          const script = a.find((s): s is string => typeof s === 'string' && s.includes('source'));
          if (script?.includes('ros2 node list')) {
            if (options?.exitCode) {
              throw { exitCode: options.exitCode, stdout: '', stderr: 'boom' };
            }
            return { stdout: nodeListStdout, stderr: '', command: 'oc' } as extensionApi.RunResult;
          }
          return { stdout: '', stderr: '', command: 'oc' } as extensionApi.RunResult;
        });
      }

      it('extracts unique robot names from namespaced nodes', async () => {
        mockOc('/robot_1/robot_state_publisher\n/robot_1/amcl\n/robot_2/robot_state_publisher\n/some_top_level_node\n');
        const robots = await api.listSpawnedRobotsInOpenShift(NS, NAME);
        expect(robots).toEqual(['robot_1', 'robot_2']);
      });

      it('returns an empty array when no robots are running', async () => {
        mockOc('/some_top_level_node\n/another_node\n');
        expect(await api.listSpawnedRobotsInOpenShift(NS, NAME)).toEqual([]);
      });

      it('returns an empty array for blank output', async () => {
        mockOc('');
        expect(await api.listSpawnedRobotsInOpenShift(NS, NAME)).toEqual([]);
      });

      it('returns an empty array (never throws) on exec failure', async () => {
        mockOc('', { exitCode: 1 });
        await expect(api.listSpawnedRobotsInOpenShift(NS, NAME)).resolves.toEqual([]);
      });

      it('dedupes multiple nodes under the same robot namespace', async () => {
        mockOc('/robot_1/a\n/robot_1/b\n/robot_1/c\n');
        expect(await api.listSpawnedRobotsInOpenShift(NS, NAME)).toEqual(['robot_1']);
      });

      it('passes --context to every oc invocation (image lookup, pod lookup, exec) when provided (S8-10)', async () => {
        mockOc('/robot_1/a\n');
        await api.listSpawnedRobotsInOpenShift(NS, NAME, 'other-context');
        const calls = vi.mocked(extensionApi.process.exec).mock.calls;
        expect(calls).toHaveLength(3); // get deployment, get pods, exec
        for (const call of calls) {
          expect((call[1] as string[]).slice(0, 2)).toEqual(['--context', 'other-context']);
        }
      });
    });

    describe('getTfTreeStatusInOpenShift', () => {
      const NS = 'sgahlot-pd-extn';
      const NAME = 'ros2-jazzy-sim';
      const POD = 'ros2-jazzy-sim-abc-123';
      const TF_AVAILABLE = `At time 41024.4
- Translation: [-2.085, -0.571, 0.000]
- Rotation: in Quaternion (xyzw) [0.000, 0.000, 0.014, 1.000]
`;

      function mockOc(image = 'quay.io/ns/ros2-jazzy-sim:noble-amd64') {
        vi.mocked(extensionApi.process.exec).mockImplementation(async (_cmd, args) => {
          const raw = args as string[];
          const a = raw[0] === '--context' ? raw.slice(2) : raw;
          if (a[0] === 'get' && a[1] === 'deployment') {
            return { stdout: image, stderr: '', command: 'oc' } as extensionApi.RunResult;
          }
          if (a[0] === 'get' && a[1] === 'pods') {
            return { stdout: POD, stderr: '', command: 'oc' } as extensionApi.RunResult;
          }
          return { stdout: TF_AVAILABLE, stderr: '', command: 'oc' } as extensionApi.RunResult;
        });
      }

      it('resolves image+pod then runs the curated TF chain sequentially over oc exec', async () => {
        mockOc();
        const result = await api.getTfTreeStatusInOpenShift(NS, NAME, 'robot_1');
        expect(result.robotNamespace).toBe('robot_1');
        expect(result.frames).toHaveLength(4);
        expect(result.frames.every(f => f.available)).toBe(true);

        const calls = vi.mocked(extensionApi.process.exec).mock.calls;
        const tfCall = calls.find(c => (c[1] as string[]).some(a => typeof a === 'string' && a.includes('tf2_echo')));
        expect(tfCall).toBeDefined();
        expect((tfCall![1] as string[]).slice(0, 5)).toEqual(['exec', '-n', NS, POD, '--']);
      });

      it('passes --context to every oc invocation when provided', async () => {
        mockOc();
        await api.getTfTreeStatusInOpenShift(NS, NAME, 'robot_1', 'other-context');
        const calls = vi.mocked(extensionApi.process.exec).mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        for (const call of calls) {
          expect((call[1] as string[]).slice(0, 2)).toEqual(['--context', 'other-context']);
        }
      });

      it('rejects an injectable robot name before touching the cluster', async () => {
        await expect(api.getTfTreeStatusInOpenShift(NS, NAME, 'robot;id')).rejects.toThrow(/Invalid robot name/);
        expect(extensionApi.process.exec).not.toHaveBeenCalled();
      });

      it('propagates a pod-resolution failure', async () => {
        vi.mocked(extensionApi.process.exec).mockImplementation(async (_cmd, args) => {
          const a = args as string[];
          if (a[0] === 'get' && a[1] === 'deployment') {
            return {
              stdout: 'quay.io/ns/ros2-jazzy-sim:noble-amd64',
              stderr: '',
              command: 'oc',
            } as extensionApi.RunResult;
          }
          if (a[0] === 'get' && a[1] === 'pods') {
            return { stdout: '', stderr: '', command: 'oc' } as extensionApi.RunResult;
          }
          return { stdout: '', stderr: '', command: 'oc' } as extensionApi.RunResult;
        });
        await expect(api.getTfTreeStatusInOpenShift(NS, NAME, 'robot_1')).rejects.toThrow(/No running pod/);
      });
    });

    describe('getCostmapSummaryInOpenShift', () => {
      const NS = 'sgahlot-pd-extn';
      const NAME = 'ros2-jazzy-sim';
      const POD = 'ros2-jazzy-sim-abc-123';
      const LOCAL_COSTMAP_ECHO = `info:
  resolution: 0.05
  width: 2
  height: 2
  origin:
    position:
      x: 1.0
      y: 2.0
data: [0, 100, -1, 0]
`;

      function mockOc(image = 'quay.io/ns/ros2-jazzy-sim:noble-amd64') {
        vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
          get: vi.fn().mockReturnValue(5),
          update: vi.fn(),
        } as unknown as extensionApi.Configuration);
        vi.mocked(extensionApi.process.exec).mockImplementation(async (_cmd, args) => {
          const raw = args as string[];
          const a = raw[0] === '--context' ? raw.slice(2) : raw;
          if (a[0] === 'get' && a[1] === 'deployment') {
            return { stdout: image, stderr: '', command: 'oc' } as extensionApi.RunResult;
          }
          if (a[0] === 'get' && a[1] === 'pods') {
            return { stdout: POD, stderr: '', command: 'oc' } as extensionApi.RunResult;
          }
          const joined = raw.join(' ');
          if (joined.includes('local_costmap')) {
            return { stdout: LOCAL_COSTMAP_ECHO, stderr: '', command: 'oc' } as extensionApi.RunResult;
          }
          throw { exitCode: 124, stdout: '', stderr: 'timeout' };
        });
      }

      it('summarizes local+global costmaps sequentially over oc exec', async () => {
        mockOc();
        const result = await api.getCostmapSummaryInOpenShift(NS, NAME, 'robot_1');
        expect(result.local).toMatchObject({
          topic: '/robot_1/local_costmap/costmap',
          widthCells: 2,
          heightCells: 2,
        });
        expect(result.global).toMatchObject({ topic: '/robot_1/global_costmap/costmap', timedOut: true });

        const calls = vi.mocked(extensionApi.process.exec).mock.calls;
        const localCall = calls.find(c =>
          (c[1] as string[]).some(a => typeof a === 'string' && a.includes('/robot_1/local_costmap/costmap')),
        );
        expect((localCall![1] as string[]).slice(0, 5)).toEqual(['exec', '-n', NS, POD, '--']);
      });

      it('passes --context to every oc invocation when provided', async () => {
        mockOc();
        await api.getCostmapSummaryInOpenShift(NS, NAME, 'robot_1', 'other-context');
        const calls = vi.mocked(extensionApi.process.exec).mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        for (const call of calls) {
          expect((call[1] as string[]).slice(0, 2)).toEqual(['--context', 'other-context']);
        }
      });

      it('rejects an injectable robot name before touching the cluster', async () => {
        await expect(api.getCostmapSummaryInOpenShift(NS, NAME, 'robot;id')).rejects.toThrow(/Invalid robot name/);
        expect(extensionApi.process.exec).not.toHaveBeenCalled();
      });

      it('propagates a pod-resolution failure', async () => {
        vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
          get: vi.fn().mockReturnValue(5),
          update: vi.fn(),
        } as unknown as extensionApi.Configuration);
        vi.mocked(extensionApi.process.exec).mockImplementation(async (_cmd, args) => {
          const a = args as string[];
          if (a[0] === 'get' && a[1] === 'deployment') {
            return {
              stdout: 'quay.io/ns/ros2-jazzy-sim:noble-amd64',
              stderr: '',
              command: 'oc',
            } as extensionApi.RunResult;
          }
          if (a[0] === 'get' && a[1] === 'pods') {
            return { stdout: '', stderr: '', command: 'oc' } as extensionApi.RunResult;
          }
          return { stdout: '', stderr: '', command: 'oc' } as extensionApi.RunResult;
        });
        await expect(api.getCostmapSummaryInOpenShift(NS, NAME, 'robot_1')).rejects.toThrow(/No running pod/);
      });
    });

    describe('getLaserScanSummaryInOpenShift', () => {
      const NS = 'sgahlot-pd-extn';
      const NAME = 'ros2-jazzy-sim';
      const POD = 'ros2-jazzy-sim-abc-123';
      const SCAN_ECHO = `angle_min: 0.0
angle_max: 6.28
angle_increment: 0.017
range_min: 0.1
range_max: 20.0
ranges: [0.3, 0.5, .inf, .nan]
`;

      function mockOc(image = 'quay.io/ns/ros2-jazzy-sim:noble-amd64') {
        vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
          get: vi.fn().mockReturnValue(5),
          update: vi.fn(),
        } as unknown as extensionApi.Configuration);
        vi.mocked(extensionApi.process.exec).mockImplementation(async (_cmd, args) => {
          const raw = args as string[];
          const a = raw[0] === '--context' ? raw.slice(2) : raw;
          if (a[0] === 'get' && a[1] === 'deployment') {
            return { stdout: image, stderr: '', command: 'oc' } as extensionApi.RunResult;
          }
          if (a[0] === 'get' && a[1] === 'pods') {
            return { stdout: POD, stderr: '', command: 'oc' } as extensionApi.RunResult;
          }
          return { stdout: SCAN_ECHO, stderr: '', command: 'oc' } as extensionApi.RunResult;
        });
      }

      it('summarizes ranges over oc exec', async () => {
        mockOc();
        const result = await api.getLaserScanSummaryInOpenShift(NS, NAME, 'robot_1');
        expect(result.topic).toBe('/robot_1/scan');
        expect(result.finiteCount).toBe(2);
        expect(result.infCount).toBe(1);
        expect(result.nanCount).toBe(1);

        const calls = vi.mocked(extensionApi.process.exec).mock.calls;
        const scanCall = calls.find(c =>
          (c[1] as string[]).some(a => typeof a === 'string' && a.includes('/robot_1/scan')),
        );
        expect((scanCall![1] as string[]).slice(0, 5)).toEqual(['exec', '-n', NS, POD, '--']);
      });

      it('passes --context to every oc invocation when provided', async () => {
        mockOc();
        await api.getLaserScanSummaryInOpenShift(NS, NAME, 'robot_1', 'other-context');
        const calls = vi.mocked(extensionApi.process.exec).mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        for (const call of calls) {
          expect((call[1] as string[]).slice(0, 2)).toEqual(['--context', 'other-context']);
        }
      });

      it('rejects an injectable robot name before touching the cluster', async () => {
        await expect(api.getLaserScanSummaryInOpenShift(NS, NAME, 'robot;id')).rejects.toThrow(/Invalid robot name/);
        expect(extensionApi.process.exec).not.toHaveBeenCalled();
      });

      it('propagates a pod-resolution failure', async () => {
        vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
          get: vi.fn().mockReturnValue(5),
          update: vi.fn(),
        } as unknown as extensionApi.Configuration);
        vi.mocked(extensionApi.process.exec).mockImplementation(async (_cmd, args) => {
          const a = args as string[];
          if (a[0] === 'get' && a[1] === 'deployment') {
            return {
              stdout: 'quay.io/ns/ros2-jazzy-sim:noble-amd64',
              stderr: '',
              command: 'oc',
            } as extensionApi.RunResult;
          }
          if (a[0] === 'get' && a[1] === 'pods') {
            return { stdout: '', stderr: '', command: 'oc' } as extensionApi.RunResult;
          }
          return { stdout: '', stderr: '', command: 'oc' } as extensionApi.RunResult;
        });
        await expect(api.getLaserScanSummaryInOpenShift(NS, NAME, 'robot_1')).rejects.toThrow(/No running pod/);
      });
    });

    describe('listSpawnedRobotsInSimulation', () => {
      const CONTAINER_ID = 'abc123def456';

      beforeEach(() => {
        vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
          simContainer(CONTAINER_ID, 'quay.io/sgahlot/ros2-jazzy-sim:noble'),
        ] as unknown as extensionApi.ContainerInfo[]);
      });

      it('extracts unique robot names from namespaced nodes', async () => {
        vi.mocked(extensionApi.process.exec).mockResolvedValue({
          stdout:
            '/robot_1/robot_state_publisher\n/robot_1/amcl\n/robot_2/robot_state_publisher\n/some_top_level_node\n',
          stderr: '',
          command: 'podman',
        } as extensionApi.RunResult);
        expect(await api.listSpawnedRobotsInSimulation(CONTAINER_ID)).toEqual(['robot_1', 'robot_2']);
      });

      it('returns an empty array when no robots are running', async () => {
        vi.mocked(extensionApi.process.exec).mockResolvedValue({
          stdout: '/some_top_level_node\n/another_node\n',
          stderr: '',
          command: 'podman',
        } as extensionApi.RunResult);
        expect(await api.listSpawnedRobotsInSimulation(CONTAINER_ID)).toEqual([]);
      });

      it('returns an empty array for blank output', async () => {
        vi.mocked(extensionApi.process.exec).mockResolvedValue({
          stdout: '',
          stderr: '',
          command: 'podman',
        } as extensionApi.RunResult);
        expect(await api.listSpawnedRobotsInSimulation(CONTAINER_ID)).toEqual([]);
      });

      it('returns an empty array (never throws) on exec failure', async () => {
        vi.mocked(extensionApi.process.exec).mockRejectedValue({ exitCode: 1, stdout: '', stderr: 'boom' });
        await expect(api.listSpawnedRobotsInSimulation(CONTAINER_ID)).resolves.toEqual([]);
      });

      it('dedupes multiple nodes under the same robot namespace', async () => {
        vi.mocked(extensionApi.process.exec).mockResolvedValue({
          stdout: '/robot_1/a\n/robot_1/b\n/robot_1/c\n',
          stderr: '',
          command: 'podman',
        } as extensionApi.RunResult);
        expect(await api.listSpawnedRobotsInSimulation(CONTAINER_ID)).toEqual(['robot_1']);
      });

      it('execs `ros2 node list` attached in the container via podman exec', async () => {
        vi.mocked(extensionApi.process.exec).mockResolvedValue({
          stdout: '/robot_1/a\n',
          stderr: '',
          command: 'podman',
        } as extensionApi.RunResult);
        await api.listSpawnedRobotsInSimulation(CONTAINER_ID);
        const args = execArgs();
        expect(args[0]).toBe('exec');
        expect(args[1]).toBe(CONTAINER_ID);
        expect(args.join(' ')).toContain('ros2 node list');
      });
    });

    describe('getRobotWarmStatusInOpenShift', () => {
      const NS = 'sgahlot-pd-extn';
      const NAME = 'ros2-jazzy-sim';

      it("returns 'idle' for a robot that was never spawned", async () => {
        expect(await api.getRobotWarmStatusInOpenShift(NS, NAME, 'robot_9')).toBe('idle');
      });

      it('rejects an injectable robot name', async () => {
        await expect(api.getRobotWarmStatusInOpenShift(NS, NAME, 'robot;id')).rejects.toThrow(/robot name/i);
      });
    });

    describe('sendOpenShiftNavigationGoal', () => {
      const NS = 'sgahlot-pd-extn';
      const NAME = 'ros2-jazzy-sim';
      const POD = 'ros2-jazzy-sim-abc-123';
      const GZ_POSE_ORIGIN =
        'Requesting state for world [tb3_sandbox]...\n\nModel: [42]\n  - Name: robot_1\n  - Pose [ XYZ (m) ] [ RPY (rad) ]:\n    [0.000000 0.000000 0.010000]\n    [0.000000 0.000000 0.000000]';
      const GZ_POSE_AT_TARGET =
        'Requesting state for world [tb3_sandbox]...\n\nModel: [42]\n  - Name: robot_1\n  - Pose [ XYZ (m) ] [ RPY (rad) ]:\n    [2.000000 2.000000 0.010000]\n    [0.000000 0.000000 0.000000]';

      function mockOc(image: string, options?: { goalOutput?: string }) {
        const goalOutput = options?.goalOutput ?? 'Goal finished with status: SUCCEEDED\n';
        // Origin first, then at-target so the humble cmd_vel path drives and reaches.
        let poseCalls = 0;
        vi.mocked(extensionApi.process.exec).mockImplementation(async (_cmd, args) => {
          const a = args as string[];
          if (a[0] === 'get' && a[1] === 'deployment') {
            return { stdout: image, stderr: '', command: 'oc' } as extensionApi.RunResult;
          }
          if (a[0] === 'get' && a[1] === 'pods') {
            return { stdout: POD, stderr: '', command: 'oc' } as extensionApi.RunResult;
          }
          // oc exec -- bash -c <script>
          const script = a.find((s): s is string => typeof s === 'string' && s.includes('source'));
          if (script?.includes('gz model')) {
            poseCalls++;
            return {
              stdout: poseCalls === 1 ? GZ_POSE_ORIGIN : GZ_POSE_AT_TARGET,
              stderr: '',
              command: 'oc',
            } as extensionApi.RunResult;
          }
          if (script?.includes('send_goal')) {
            return { stdout: goalOutput, stderr: '', command: 'oc' } as extensionApi.RunResult;
          }
          if (script?.includes('tf2_echo map base_link')) {
            return {
              stdout: 'At time 1.0\n- Translation: [2.0, 2.0, 0.010]\n',
              stderr: '',
              command: 'oc',
            } as extensionApi.RunResult;
          }
          return { stdout: '', stderr: '', command: 'oc' } as extensionApi.RunResult;
        });
      }

      it('routes a jazzy image through Nav2 over oc exec', async () => {
        mockOc('quay.io/ns/ros2-jazzy-sim:noble-amd64');

        const result = await api.sendOpenShiftNavigationGoal(NS, NAME, 'robot_1', 2.0, 2.0);
        expect(result.status).toBe('reached');

        const goalCall = vi
          .mocked(extensionApi.process.exec)
          .mock.calls.find(c => (c[1] as string[]).some(a => typeof a === 'string' && a.includes('send_goal')));
        expect(goalCall).toBeDefined();
        const goalA = goalCall![1] as string[];
        expect(goalA.slice(0, 5)).toEqual(['exec', '-n', NS, POD, '--']);
        expect(goalA).not.toContain('-d');
      });

      it('sets a writable HOME/ROS_HOME on the oc exec path so rclcpp can create its log dir', async () => {
        mockOc('quay.io/ns/ros2-jazzy-sim:noble-amd64');

        await api.sendOpenShiftNavigationGoal(NS, NAME, 'robot_1', 2.0, 2.0);

        const rosCall = vi
          .mocked(extensionApi.process.exec)
          .mock.calls.find(c => (c[1] as string[]).some(a => typeof a === 'string' && a.includes('send_goal')));
        const script = (rosCall![1] as string[]).find(a => typeof a === 'string' && a.includes('send_goal'))!;
        expect(script).toContain('export HOME=/tmp/ros-home');
        expect(script).toContain('ROS_LOG_DIR=/tmp/ros-home/log');
        expect(script).toMatch(/mkdir -p "\$ROS_LOG_DIR"/);
        // prefix must come before the ROS setup source
        expect(script.indexOf('HOME=/tmp/ros-home')).toBeLessThan(script.indexOf('source'));
      });

      it('routes a humble image through the cmd_vel path over oc exec', async () => {
        mockOc('quay.io/ns/ros2-humble-turtlebot3:sloretz');

        const result = await api.sendOpenShiftNavigationGoal(NS, NAME, 'robot_1', 2.0, 2.0);
        expect(result.status).toBe('reached');

        const driveCall = vi
          .mocked(extensionApi.process.exec)
          .mock.calls.find(c => (c[1] as string[]).some(a => typeof a === 'string' && a.includes('linear')));
        expect(driveCall).toBeDefined();
        expect((driveCall![1] as string[]).slice(0, 5)).toEqual(['exec', '-n', NS, POD, '--']);
      });

      it('rejects an injectable robot name before touching the cluster', async () => {
        await expect(api.sendOpenShiftNavigationGoal(NS, NAME, 'robot;id', 2.0, 2.0)).rejects.toThrow(
          /Invalid robot name/,
        );
        expect(extensionApi.process.exec).not.toHaveBeenCalled();
      });

      it('throws for an unsupported distro image', async () => {
        vi.mocked(extensionApi.process.exec).mockImplementation(async (_cmd, args) => {
          const a = args as string[];
          if (a[0] === 'get' && a[1] === 'deployment') {
            return { stdout: 'quay.io/ns/ros2-foxy-sim:latest', stderr: '', command: 'oc' } as extensionApi.RunResult;
          }
          return { stdout: POD, stderr: '', command: 'oc' } as extensionApi.RunResult;
        });
        await expect(api.sendOpenShiftNavigationGoal(NS, NAME, 'robot_1', 2.0, 2.0)).rejects.toThrow(
          /Unsupported ROS distro/,
        );
      });
    });
  });
});
