import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ExtensionContext } from '@podman-desktop/api';
import { PhysicalAiApiImpl } from './api-impl';
import { SIM_CONTAINER_LABEL, SIM_CONTAINER_LABEL_VALUE } from '/@shared/src/types/SimulationContainer';
import { SPAWN_ENTRYPOINT, GAZEBO_ENTRYPOINT } from '/@shared/src/security/simInput';

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
  },
  process: {
    exec: vi.fn(),
  },
  configuration: {
    getConfiguration: vi.fn(),
  },
  env: {
    openExternal: vi.fn(),
  },
  Uri: {
    joinPath: vi.fn(),
    parse: vi.fn((s: string) => ({ toString: () => s })),
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
    const CONTAINER_ID = 'abc123def456';

    beforeEach(() => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        simContainer(CONTAINER_ID, 'quay.io/sgahlot/ros2-jazzy-sim:noble'),
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
        simContainer(CONTAINER_ID, 'quay.io/ns/ros2-humble-turtlebot3:sloretz'),
      ] as any);
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: '/rosout\n',
        stderr: '',
        command: 'podman',
      } as any);

      await api.listRosTopics(CONTAINER_ID);
      const args = execArgs(0);
      expect(args).toContain(CONTAINER_ID);
      const bashCmd = args.find((arg: string) => arg.includes('source'));
      expect(bashCmd).toContain('/opt/ros/humble/');
    });

    it('skips injectable topic names from ros2 topic list', async () => {
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: '/rosout\n/cmd_vel; id\n',
        stderr: '',
        command: 'podman',
      } as any);

      const result = await api.listRosTopics(CONTAINER_ID);
      expect(result.map(t => t.name)).toEqual(['/rosout']);
    });

    it('rejects non-simulation containers', async () => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        { Id: CONTAINER_ID, Image: 'quay.io/ns/other:latest', Labels: {} },
      ] as any);

      await expect(api.listRosTopics(CONTAINER_ID)).rejects.toThrow(
        'Not a Physical AI simulation container',
      );
    });

    it('passes topic names as bash positional args (not interpolated)', async () => {
      vi.mocked(extensionApi.process.exec)
        .mockResolvedValueOnce({
          stdout: '/robot_1/cmd_vel\n',
          stderr: '',
          command: 'podman',
        } as any)
        .mockResolvedValueOnce({
          stdout: 'Type: geometry_msgs/msg/Twist\nPublisher count: 0\nSubscription count: 1\n',
          stderr: '',
          command: 'podman',
        } as any);

      await api.listRosTopics(CONTAINER_ID);
      const args = execArgs(1);
      const bashCmd = args.find((arg: string) => arg.includes('ros2 topic info'));
      expect(bashCmd).toContain('ros2 topic info "$1"');
      expect(bashCmd).not.toContain('/robot_1/cmd_vel');
      expect(args).toContain('/robot_1/cmd_vel');
    });

    it('calls podman exec without -d flag (attached mode)', async () => {
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: '/rosout\n',
        stderr: '',
        command: 'podman',
      } as any);

      await api.listRosTopics(CONTAINER_ID);
      const args = execArgs(0);
      expect(args[0]).toBe('exec');
      expect(args[1]).toBe(CONTAINER_ID);
      expect(args).not.toContain('-d');
    });
  });

  describe('getRosTopicDetail', () => {
    const CONTAINER_ID = 'abc123def456';

    beforeEach(() => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        simContainer(CONTAINER_ID, 'quay.io/sgahlot/ros2-jazzy-sim:noble'),
      ] as any);
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
      } as any);

      const result = await api.getRosTopicDetail(CONTAINER_ID, '/robot_1/cmd_vel');
      expect(result.topicName).toBe('/robot_1/cmd_vel');
      expect(result.type).toBe('geometry_msgs/msg/Twist');
      expect(result.publishers).toEqual([
        { nodeName: 'teleop_keyboard', nodeNamespace: '/' },
      ]);
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
      } as any);

      const result = await api.getRosTopicDetail(CONTAINER_ID, '/empty_topic');
      expect(result.topicName).toBe('/empty_topic');
      expect(result.type).toBe('std_msgs/msg/String');
      expect(result.publishers).toEqual([]);
      expect(result.subscribers).toEqual([]);
    });

    it('detects humble distro for sourcing', async () => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        simContainer(CONTAINER_ID, 'quay.io/ns/ros2-humble-turtlebot3:sloretz'),
      ] as any);
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: 'Type: std_msgs/msg/String\n\nPublisher count: 0\n\nSubscription count: 0\n',
        stderr: '',
        command: 'podman',
      } as any);

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
      } as any);

      await api.getRosTopicDetail(CONTAINER_ID, '/rosout');
      const args = execArgs(0);
      const bashCmd = args.find((arg: string) => arg.includes('ros2 topic info'));
      expect(bashCmd).toContain('ros2 topic info -v "$1"');
      expect(bashCmd).not.toMatch(/-v \/rosout/);
      expect(args).toContain('/rosout');
    });

    it('rejects injectable topic names', async () => {
      await expect(api.getRosTopicDetail(CONTAINER_ID, '/rosout; id')).rejects.toThrow(
        /Invalid ROS topic/,
      );
    });
  });

  describe('peekRosTopic', () => {
    const CONTAINER_ID = 'abc123def456';

    beforeEach(() => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        simContainer(CONTAINER_ID, 'quay.io/sgahlot/ros2-jazzy-sim:noble'),
      ] as any);
    });

    it('returns message text from ros2 topic echo --once', async () => {
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: 'linear:\n  x: 0.2\n  y: 0.0\n  z: 0.0\n',
        stderr: '',
        command: 'podman',
      } as any);

      const result = await api.peekRosTopic(CONTAINER_ID, '/robot_1/cmd_vel');
      expect(result.timedOut).toBe(false);
      expect(result.message).toContain('linear:');
      expect(result.topicName).toBe('/robot_1/cmd_vel');

      const args = execArgs(0);
      const bashCmd = args.find((arg: string) => arg.includes('topic echo'));
      expect(bashCmd).toContain('timeout "$1" ros2 topic echo --once "$2"');
      expect(args).toContain('5');
      expect(args).toContain('/robot_1/cmd_vel');
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
    });

    it('rejects injectable topic names', async () => {
      await expect(api.peekRosTopic(CONTAINER_ID, '/cmd; id')).rejects.toThrow(/Invalid ROS topic/);
    });

    it('rejects non-simulation containers', async () => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        { Id: CONTAINER_ID, Image: 'docker.io/library/nginx:latest', Labels: {} },
      ] as any);

      await expect(api.peekRosTopic(CONTAINER_ID, '/rosout')).rejects.toThrow(
        'Not a Physical AI simulation container',
      );
    });
  });

  describe('sendNavigationGoal', () => {
    const CONTAINER_ID = 'abc123def456';
    const GZ_POSE_ORIGIN = 'Requesting state for world [tb3_sandbox]...\n\nModel: [42]\n  - Name: robot_1\n  - Pose [ XYZ (m) ] [ RPY (rad) ]:\n    [0.000000 0.000000 0.010000]\n    [0.000000 0.000000 0.000000]';
    const GZ_POSE_AT_TARGET = 'Requesting state for world [tb3_sandbox]...\n\nModel: [42]\n  - Name: robot_1\n  - Pose [ XYZ (m) ] [ RPY (rad) ]:\n    [2.000000 2.000000 0.010000]\n    [0.000000 0.000000 0.000000]';

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
          } as any;
        }
        return { stdout: '', stderr: '', command: 'podman' } as any;
      });
    }

    beforeEach(() => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        simContainer(CONTAINER_ID, 'quay.io/sgahlot/ros2-jazzy-sim:noble'),
      ] as any);
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
      const turnCmds = calls.filter(c => (c[1] as string[] | undefined)?.some((a: string) => typeof a === 'string' && a.includes('angular')));
      expect(turnCmds.length).toBeGreaterThan(0);
      const driveCmds = calls.filter(c => (c[1] as string[] | undefined)?.some((a: string) => typeof a === 'string' && a.includes('linear')));
      expect(driveCmds.length).toBe(1);
    });

    it('returns already-at-target when distance is tiny', async () => {
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: GZ_POSE_AT_TARGET,
        stderr: '',
        command: 'podman',
      } as any);

      const result = await api.sendNavigationGoal(CONTAINER_ID, 'robot_1', 2.0, 2.0);
      expect(result.status).toBe('reached');
      expect(result.message).toContain('Already');
    });

    it('uses robot name as positional arg for cmd_vel topic', async () => {
      mockNavExec();

      await api.sendNavigationGoal(CONTAINER_ID, 'robot_1', 3.5, -1.0);
      const calls = vi.mocked(extensionApi.process.exec).mock.calls;
      const driveCallIndex = calls.findIndex(c => (c[1] as string[] | undefined)?.some((a: string) => typeof a === 'string' && a.includes('linear')));
      expect(driveCallIndex).toBeGreaterThanOrEqual(0);
      const driveArgs = execArgs(driveCallIndex);
      const driveCmd = driveArgs.find((arg: string) => arg.includes('linear'));
      expect(driveCmd).toContain('/$2/cmd_vel');
      expect(driveArgs).toContain('robot_1');
      expect(driveCmd).not.toContain('/robot_1/cmd_vel');
    });

    it('rejects injectable robot names', async () => {
      await expect(api.sendNavigationGoal(CONTAINER_ID, 'robot;id', 2.0, 2.0)).rejects.toThrow(
        /Invalid robot name/,
      );
    });

    it('fails loudly when pose cannot be parsed', async () => {
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: 'no pose here',
        stderr: '',
        command: 'podman',
      } as any);

      await expect(api.sendNavigationGoal(CONTAINER_ID, 'robot_1', 2.0, 2.0)).rejects.toThrow(
        /Could not read pose/,
      );
    });

    it('calls podman exec without -d flag (attached mode)', async () => {
      mockNavExec();

      await api.sendNavigationGoal(CONTAINER_ID, 'robot_1', 2.0, 2.0);
      const args = execArgs(0);
      expect(args[0]).toBe('exec');
      expect(args).not.toContain('-d');
    });
  });

  describe('execInSimulation security', () => {
    const CONTAINER_ID = 'abc123def456';

    beforeEach(() => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        simContainer(CONTAINER_ID, 'quay.io/sgahlot/ros2-jazzy-sim:noble'),
      ] as any);
      vi.mocked(extensionApi.process.exec).mockResolvedValue({
        stdout: '',
        stderr: '',
        command: 'podman',
      } as any);
    });

    it('allows spawn entrypoint with validated args', async () => {
      await api.execInSimulation(CONTAINER_ID, [
        SPAWN_ENTRYPOINT,
        'robot_1',
        '-2.0',
        '0.5',
        '0.0',
      ]);
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

    it('rejects arbitrary commands', async () => {
      await expect(api.execInSimulation(CONTAINER_ID, ['bash', '-c', 'id'])).rejects.toThrow(
        /Only /,
      );
    });

    it('rejects non-simulation containers', async () => {
      vi.mocked(extensionApi.containerEngine.listContainers).mockResolvedValue([
        { Id: CONTAINER_ID, Image: 'docker.io/library/nginx:latest', Labels: {} },
      ] as any);

      await expect(
        api.execInSimulation(CONTAINER_ID, [SPAWN_ENTRYPOINT, 'robot_1', '0', '0', '0']),
      ).rejects.toThrow('Not a Physical AI simulation container');
    });
  });

  describe('launchSimulation security', () => {
    beforeEach(() => {
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue(''),
        update: vi.fn(),
      } as any);
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        { engineId: 'engine-1', RepoTags: ['quay.io/sgahlot/ros2-jazzy-sim:noble'] },
      ] as any);
      vi.mocked(extensionApi.containerEngine.createContainer).mockResolvedValue({
        id: 'created-1',
      } as any);
      vi.mocked(extensionApi.containerEngine.startContainer).mockResolvedValue(undefined as any);
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
      await expect(
        api.launchSimulation('docker.io/library/nginx:latest', 'pai-sim-bad', undefined),
      ).rejects.toThrow(/not allowed/);
      expect(extensionApi.containerEngine.createContainer).not.toHaveBeenCalled();
    });

    it('honors optional digest allowlist preference', async () => {
      const digest =
        'quay.io/sgahlot/ros2-jazzy-sim@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
      vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue(digest),
        update: vi.fn(),
      } as any);
      vi.mocked(extensionApi.containerEngine.listImages).mockResolvedValue([
        { engineId: 'engine-1', RepoTags: [digest] },
      ] as any);

      await expect(
        api.launchSimulation('quay.io/sgahlot/ros2-jazzy-sim:noble', 'pai-sim-pin', undefined),
      ).rejects.toThrow(/not allowed/);

      await api.launchSimulation(digest, 'pai-sim-pinned', undefined);
      expect(extensionApi.containerEngine.createContainer).toHaveBeenCalledWith(
        'engine-1',
        expect.objectContaining({ Image: digest }),
      );
    });
  });

  describe('openSimulationInBrowser security', () => {
    beforeEach(() => {
      vi.mocked(extensionApi.env.openExternal).mockResolvedValue(true as any);
      vi.mocked(extensionApi.Uri.parse).mockImplementation((s: string) => ({ toString: () => s }) as any);
    });

    it('opens allowlisted ports only', async () => {
      await api.openSimulationInBrowser(6080);
      expect(extensionApi.Uri.parse).toHaveBeenCalledWith('http://localhost:6080');
      expect(extensionApi.env.openExternal).toHaveBeenCalled();

      await api.openSimulationInBrowser(8080);
      expect(extensionApi.Uri.parse).toHaveBeenCalledWith('http://localhost:8080');
    });

    it('rejects non-allowlisted ports', async () => {
      await expect(api.openSimulationInBrowser(22)).rejects.toThrow(/not allowed/);
      await expect(api.openSimulationInBrowser(3000)).rejects.toThrow(/not allowed/);
      expect(extensionApi.env.openExternal).not.toHaveBeenCalled();
    });
  });
});
