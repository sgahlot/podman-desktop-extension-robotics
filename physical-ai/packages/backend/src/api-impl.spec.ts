import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ExtensionContext } from '@podman-desktop/api';
import { PhysicalAiApiImpl } from './api-impl';

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
  },
  process: {
    exec: vi.fn(),
  },
  configuration: {
    getConfiguration: vi.fn(),
  },
  Uri: {
    joinPath: vi.fn(),
  },
  Disposable: {
    create: vi.fn(),
  },
}));

import * as extensionApi from '@podman-desktop/api';

const MOCK_CONTEXT = {
  extensionUri: { fsPath: '/fake/extension/path' },
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
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
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
  });

  describe('listLocalImages', () => {
    beforeEach(() => {
      vi.mocked(extensionApi.process.exec).mockResolvedValue({ stdout: '', stderr: '', command: 'podman' } as any);
    });

    it('returns flattened RepoTags from all images', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        { RepoTags: ['quay.io/ns/img1:latest', 'quay.io/ns/img1:v1'] },
        { RepoTags: ['quay.io/ns/img2:latest'] },
      ] as any);

      const result = await api.listLocalImages();
      expect(result).toEqual([
        'quay.io/ns/img1:latest',
        'quay.io/ns/img1:v1',
        'quay.io/ns/img2:latest',
      ]);
    });

    it('handles images with no RepoTags', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        { RepoTags: undefined },
        { RepoTags: ['quay.io/ns/img:latest'] },
      ] as any);

      const result = await api.listLocalImages();
      expect(result).toEqual(['quay.io/ns/img:latest']);
    });

    it('falls back to Names when RepoTags is null (Podman 5)', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        {
          RepoTags: null,
          Names: ['quay.io/sgahlot/ros2-jazzy-base:latest'],
        },
        {
          RepoTags: undefined,
          Names: [
            'quay.io/sgahlot/ros2-humble-turtlebot3:latest',
            'quay.io/ecosystem-appeng/ros2-humble-turtlebot3:latest',
          ],
        },
      ] as any);

      const result = await api.listLocalImages();
      expect(result).toEqual([
        'quay.io/sgahlot/ros2-jazzy-base:latest',
        'quay.io/sgahlot/ros2-humble-turtlebot3:latest',
        'quay.io/ecosystem-appeng/ros2-humble-turtlebot3:latest',
      ]);
    });

    it('merges podman CLI image list when engine tags are empty', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        { RepoTags: null },
        { RepoTags: [] },
      ] as any);
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: 'quay.io/sgahlot/ros2-jazzy-base:latest\nquay.io/sgahlot/ros2-humble-turtlebot3:latest\n',
        stderr: '',
        command: 'podman',
      } as any);

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

  describe('pullImage', () => {
    it('throws when no Podman connection found', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([]);

      await expect(api.pullImage('ns/img', 'latest')).rejects.toThrow('No running Podman connection found');
    });

    it('throws when connection is not started', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection('podman', 'stopped'),
      ] as any);

      await expect(api.pullImage('ns/img', 'latest')).rejects.toThrow('No running Podman connection found');
    });

    it('initiates pull and sets initial progress', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as any);
      vi.mocked(extensionApi.containerEngine.pullImage).mockReturnValue(new Promise(() => {}));

      await api.pullImage('ns/img', 'latest');

      const progress = await api.getPullProgress('quay.io/ns/img:latest');
      expect(progress).toEqual({ image: 'quay.io/ns/img:latest', status: 'Starting...' });
    });

    it('updates progress with layer data from callback', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as any);

      let pullCallback: Function;
      vi.mocked(extensionApi.containerEngine.pullImage).mockImplementation(
        (_conn: any, _img: any, cb: any) => {
          pullCallback = cb;
          return new Promise(() => {});
        },
      );

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
      ] as any);
      vi.mocked(extensionApi.containerEngine.pullImage).mockResolvedValue(undefined as any);

      await api.pullImage('ns/img', 'latest');
      await vi.advanceTimersByTimeAsync(0);

      const progress = await api.getPullProgress('quay.io/ns/img:latest');
      expect(progress!.done).toBe(true);
      expect(progress!.status).toBe('Complete');
    });

    it('sets error on failed pull', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as any);
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
      ] as any);
      vi.mocked(extensionApi.containerEngine.pullImage).mockResolvedValue(undefined as any);

      await api.pullImage('ns/img', 'latest');
      await vi.advanceTimersByTimeAsync(0);

      expect(await api.getPullProgress('quay.io/ns/img:latest')).not.toBeNull();
      await vi.advanceTimersByTimeAsync(30000);
      expect(await api.getPullProgress('quay.io/ns/img:latest')).toBeNull();
    });
  });

  describe('getPullProgress', () => {
    it('returns null for unknown image', async () => {
      expect(await api.getPullProgress('nonexistent')).toBeNull();
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

      await expect(api.buildBaseImage('my-tag:latest', baseConfig)).rejects.toThrow('No running Podman connection found');
    });

    it('rejects unsupported wizard combinations', async () => {
      await expect(
        api.buildBaseImage('my-tag:latest', { ...baseConfig, distro: 'rolling' }),
      ).rejects.toThrow(/No base image profile for rolling\/turtlebot3\/dds\/gazebo/);
      expect(extensionApi.containerEngine.buildImage).not.toHaveBeenCalled();
    });

    it('builds jazzy base image with correct asset dir and build-arg', async () => {
      const mockConnection = createMockConnection();
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([mockConnection] as any);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({ fsPath: '/fake/assets/ros2-jazzy-base' } as any);
      vi.mocked(extensionApi.containerEngine.buildImage).mockReturnValue(new Promise(() => {}));

      await api.buildBaseImage('my-tag:latest', { ...baseConfig, distro: 'jazzy', baseImage: 'jazzy' as any });

      expect(extensionApi.Uri.joinPath).toHaveBeenCalledWith(
        MOCK_CONTEXT.extensionUri,
        'assets',
        'ros2-jazzy-base',
      );
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

    it('initiates build and sets initial progress', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as any);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({ fsPath: '/fake/assets' } as any);
      vi.mocked(extensionApi.containerEngine.buildImage).mockReturnValue(new Promise(() => {}));

      await api.buildBaseImage('my-tag:latest', baseConfig);

      const progress = await api.getBuildProgress('my-tag:latest');
      expect(progress).toEqual({
        tag: 'my-tag:latest',
        status: 'Starting...',
        logs: [],
      });
    });

    it('parses STEP N/M from stream events', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as any);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({ fsPath: '/fake/assets' } as any);

      let buildCallback: Function;
      vi.mocked(extensionApi.containerEngine.buildImage).mockImplementation(
        (_ctx: any, cb: any, _opts: any) => {
          buildCallback = cb;
          return new Promise(() => {});
        },
      );

      await api.buildBaseImage('my-tag:latest', baseConfig);

      buildCallback!('stream', 'STEP 3/8: RUN apt-get update');

      const progress = await api.getBuildProgress('my-tag:latest');
      expect(progress!.currentStep).toBe(3);
      expect(progress!.totalSteps).toBe(8);
      expect(progress!.status).toBe('Building... Step 3/8');
      expect(progress!.logs).toContain('STEP 3/8: RUN apt-get update');
    });

    it('records error events', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as any);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({ fsPath: '/fake/assets' } as any);

      let buildCallback: Function;
      vi.mocked(extensionApi.containerEngine.buildImage).mockImplementation(
        (_ctx: any, cb: any, _opts: any) => {
          buildCallback = cb;
          return new Promise(() => {});
        },
      );

      await api.buildBaseImage('my-tag:latest', baseConfig);
      buildCallback!('error', 'something broke');

      const progress = await api.getBuildProgress('my-tag:latest');
      expect(progress!.error).toBe('something broke');
      expect(progress!.logs).toContain('ERROR: something broke');
    });

    it('sets done on successful build', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as any);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({ fsPath: '/fake/assets' } as any);
      vi.mocked(extensionApi.containerEngine.buildImage).mockResolvedValue(undefined as any);

      await api.buildBaseImage('my-tag:latest', baseConfig);
      await vi.advanceTimersByTimeAsync(0);

      const progress = await api.getBuildProgress('my-tag:latest');
      expect(progress!.done).toBe(true);
      expect(progress!.status).toBe('Complete');
    });

    it('sets error on failed build', async () => {
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([
        createMockConnection(),
      ] as any);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({ fsPath: '/fake/assets' } as any);
      vi.mocked(extensionApi.containerEngine.buildImage).mockRejectedValue(new Error('build failed'));

      await api.buildBaseImage('my-tag:latest', baseConfig);
      await vi.advanceTimersByTimeAsync(0);

      const progress = await api.getBuildProgress('my-tag:latest');
      expect(progress!.done).toBe(true);
      expect(progress!.error).toBe('build failed');
    });

    it('passes correct build options with ROS_BASE_IMAGE build-arg', async () => {
      const mockConnection = createMockConnection();
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([mockConnection] as any);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({ fsPath: '/fake/assets/ros2-humble-base' } as any);
      vi.mocked(extensionApi.containerEngine.buildImage).mockReturnValue(new Promise(() => {}));

      await api.buildBaseImage('my-tag:latest', baseConfig);

      expect(extensionApi.Uri.joinPath).toHaveBeenCalledWith(
        MOCK_CONTEXT.extensionUri,
        'assets',
        'ros2-humble-base',
      );
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
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([mockConnection] as any);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({ fsPath: '/fake/assets' } as any);

      let aborted = false;
      vi.mocked(extensionApi.containerEngine.buildImage).mockImplementation(
        (_ctx: any, _cb: any, opts: any) =>
          new Promise(() => {
            opts.abortController.signal.addEventListener('abort', () => {
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
      ] as any);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({ fsPath: '/fake/assets' } as any);

      let buildCallback: Function;
      vi.mocked(extensionApi.containerEngine.buildImage).mockImplementation(
        (_ctx: any, cb: any, _opts: any) => {
          buildCallback = cb;
          return new Promise(() => {});
        },
      );

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
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([mockConnection] as any);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({ fsPath: '/fake/assets/ros2-humble-turtlebot3' } as any);
      vi.mocked(extensionApi.containerEngine.buildImage).mockReturnValue(new Promise(() => {}));
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue('ecosystem-appeng'),
      } as any);

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
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([mockConnection] as any);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({ fsPath: '/fake/assets/ros2-humble-turtlebot3' } as any);
      vi.mocked(extensionApi.containerEngine.buildImage).mockReturnValue(new Promise(() => {}));
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue('ecosystem-appeng'),
      } as any);

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
      vi.mocked(extensionApi.provider.getContainerConnections).mockReturnValue([mockConnection] as any);
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue('ecosystem-appeng'),
      } as any);
      vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({
        fsPath: '/fake/assets/ros2-jazzy-sim',
      } as any);
      vi.mocked(extensionApi.containerEngine.buildImage).mockReturnValue(new Promise(() => {}));

      await api.buildSimulationImage('sim-tag:noble', {
        ...supportedConfig,
        distro: 'jazzy',
        baseImage: 'jazzy-noble' as any,
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
    it('returns null for unknown tag', async () => {
      expect(await api.getBuildProgress('nonexistent')).toBeNull();
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
      ] as any);
      vi.mocked(extensionApi.containerEngine.pushImage).mockReturnValue(new Promise(() => {}));

      await api.pushImage('my-img:latest');

      const progress = await api.getPushProgress('my-img:latest');
      expect(progress).toEqual({
        tag: 'my-img:latest',
        status: 'Pushing...',
        logs: [],
      });
    });

    it('passes engineId, tag, and AbortController to pushImage', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        { engineId: 'eng1', RepoTags: ['my-img:latest'] },
      ] as any);
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
      ] as any);

      let aborted = false;
      vi.mocked(extensionApi.containerEngine.pushImage).mockImplementation(
        (_eng: any, _tag: any, _cb: any, _auth: any, abortController?: AbortController) =>
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
      ] as any);

      let pushCallback: Function;
      vi.mocked(extensionApi.containerEngine.pushImage).mockImplementation(
        (_eng: any, _tag: any, cb: any) => {
          pushCallback = cb;
          return new Promise(() => {});
        },
      );

      await api.pushImage('my-img:latest');
      pushCallback!('data', '{"status":"Pushing layer abc123"}');

      const progress = await api.getPushProgress('my-img:latest');
      expect(progress!.status).toBe('Pushing layer abc123');
      expect(progress!.logs).toContain('Pushing layer abc123');
    });

    it('handles multi-line callback data', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        { engineId: 'eng1', RepoTags: ['my-img:latest'] },
      ] as any);

      let pushCallback: Function;
      vi.mocked(extensionApi.containerEngine.pushImage).mockImplementation(
        (_eng: any, _tag: any, cb: any) => {
          pushCallback = cb;
          return new Promise(() => {});
        },
      );

      await api.pushImage('my-img:latest');
      pushCallback!('data', '{"status":"line1"}\n{"status":"line2"}');

      const progress = await api.getPushProgress('my-img:latest');
      expect(progress!.logs).toEqual(['line1', 'line2']);
      expect(progress!.status).toBe('line2');
    });

    it('ignores end and first-message events', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        { engineId: 'eng1', RepoTags: ['my-img:latest'] },
      ] as any);

      let pushCallback: Function;
      vi.mocked(extensionApi.containerEngine.pushImage).mockImplementation(
        (_eng: any, _tag: any, cb: any) => {
          pushCallback = cb;
          return new Promise(() => {});
        },
      );

      await api.pushImage('my-img:latest');
      pushCallback!('end', '');
      pushCallback!('first-message', '');

      const progress = await api.getPushProgress('my-img:latest');
      expect(progress!.logs).toHaveLength(0);
    });

    it('sets done on successful push', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        { engineId: 'eng1', RepoTags: ['my-img:latest'] },
      ] as any);
      vi.mocked(extensionApi.containerEngine.pushImage).mockResolvedValue(undefined as any);

      await api.pushImage('my-img:latest');
      await vi.advanceTimersByTimeAsync(0);

      const progress = await api.getPushProgress('my-img:latest');
      expect(progress!.done).toBe(true);
      expect(progress!.status).toBe('Complete');
    });

    it('sets error on failed push', async () => {
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        { engineId: 'eng1', RepoTags: ['my-img:latest'] },
      ] as any);
      vi.mocked(extensionApi.containerEngine.pushImage).mockRejectedValue(new Error('auth failed'));

      await api.pushImage('my-img:latest');
      await vi.advanceTimersByTimeAsync(0);

      const progress = await api.getPushProgress('my-img:latest');
      expect(progress!.done).toBe(true);
      expect(progress!.error).toBe('auth failed');
    });
  });

  describe('getPushProgress', () => {
    it('returns null for unknown tag', async () => {
      expect(await api.getPushProgress('nonexistent')).toBeNull();
    });
  });

  describe('getDefaultNamespace', () => {
    it('returns configured namespace', async () => {
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue('sgahlot'),
      } as any);

      const ns = await api.getDefaultNamespace();
      expect(ns).toBe('sgahlot');
      expect(extensionApi.configuration.getConfiguration).toHaveBeenCalledWith('physical-ai');
    });

    it('falls back to ecosystem-appeng when not configured', async () => {
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      } as any);

      const ns = await api.getDefaultNamespace();
      expect(ns).toBe('ecosystem-appeng');
    });
  });

  describe('listRosTopics', () => {
    const CONTAINER_ID = 'abc123';

    beforeEach(() => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        { Id: CONTAINER_ID, Image: 'quay.io/sgahlot/ros2-jazzy-sim:noble' },
      ] as any);
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
      } as any);

      const result = await api.listRosTopics(CONTAINER_ID);
      expect(result).toEqual([]);
    });

    it('parses topic list and fetches info for each topic', async () => {
      vi.mocked(extensionApi.process.exec)
        .mockResolvedValueOnce({
          stdout: '/rosout\n/robot_1/cmd_vel\n',
          stderr: '',
          command: 'podman',
        } as any)
        .mockResolvedValueOnce({
          stdout: 'Type: rcl_interfaces/msg/Log\nPublisher count: 2\nSubscription count: 0\n',
          stderr: '',
          command: 'podman',
        } as any)
        .mockResolvedValueOnce({
          stdout: 'Type: geometry_msgs/msg/Twist\nPublisher count: 0\nSubscription count: 1\n',
          stderr: '',
          command: 'podman',
        } as any);

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
    });

    it('handles topic info failure gracefully', async () => {
      vi.mocked(extensionApi.process.exec)
        .mockResolvedValueOnce({
          stdout: '/rosout\n',
          stderr: '',
          command: 'podman',
        } as any)
        .mockRejectedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: 'error',
        });

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
        { Id: CONTAINER_ID, Image: 'quay.io/ns/ros2-humble-turtlebot3:sloretz' },
      ] as any);
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: '/rosout\n',
        stderr: '',
        command: 'podman',
      } as any);

      await api.listRosTopics(CONTAINER_ID);
      const firstCall = vi.mocked(extensionApi.process.exec).mock.calls[0];
      expect(firstCall[1]).toContain(CONTAINER_ID);
      const bashCmd = firstCall[1].find((arg: string) => arg.includes('source'));
      expect(bashCmd).toContain('/opt/ros/humble/');
    });

    it('calls podman exec without -d flag (attached mode)', async () => {
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: '/rosout\n',
        stderr: '',
        command: 'podman',
      } as any);

      await api.listRosTopics(CONTAINER_ID);
      const firstCall = vi.mocked(extensionApi.process.exec).mock.calls[0];
      expect(firstCall[1][0]).toBe('exec');
      expect(firstCall[1][1]).toBe(CONTAINER_ID);
      expect(firstCall[1]).not.toContain('-d');
    });
  });
});
