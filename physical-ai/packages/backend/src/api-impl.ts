import type { ExtensionContext } from '@podman-desktop/api';
import * as extensionApi from '@podman-desktop/api';
import type { PhysicalAiApi } from '/@shared/src/PhysicalAiApi';
import type { QuayRepository, QuayTag, PullProgress, BuildProgress, PushProgress } from '/@shared/src/types/ImageCatalog';
import type { SimulationConfig } from '/@shared/src/types/SimulationConfig';
import type { SimLaunchOptions, SimContainerInfo, ExecResult } from '/@shared/src/types/SimulationContainer';
import { SIM_CONTAINER_LABEL, SIM_CONTAINER_LABEL_VALUE, SIM_CONTAINER_PREFIX } from '/@shared/src/types/SimulationContainer';
import { formatSimulationConfig, resolveSimulationProfile } from '/@shared/src/types/SimulationProfiles';
import { resolveSimulationBaseImage } from '/@shared/src/types/SimulationBaseImages';
import { appendProgressLog } from './progressLogs';

const QUAY_API_BASE = 'https://quay.io/api/v1';
/** How long completed progress entries stay queryable for the UI. */
const PROGRESS_RETENTION_MS = 30_000;

export class PhysicalAiApiImpl implements PhysicalAiApi {
  private extensionContext: ExtensionContext;
  private activePulls = new Map<string, PullProgress>();
  private layerProgress = new Map<string, Map<string, { current: number; total: number }>>();
  private activeBuilds = new Map<string, BuildProgress>();
  private buildAbortControllers = new Map<string, AbortController>();
  private activePushes = new Map<string, PushProgress>();
  private pushAbortControllers = new Map<string, AbortController>();
  private progressCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Podman Desktop hosts accept an optional AbortController as the 5th pushImage
   * argument (abortSignal on the registry stream). The published API types omit it.
   */
  static readonly #pushImageWithAbort = extensionApi.containerEngine.pushImage as (
    engineId: string,
    imageId: string,
    callback: (name: string, data: string) => void,
    authInfo?: unknown,
    abortController?: AbortController,
  ) => Promise<void>;

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
    const fromEngine = await this.#listLocalImagesFromEngine();
    // Always merge CLI listing. Podman 5 / PD often return ImageInfo with null RepoTags
    // and without Names, so engine-only listing looks empty even when `podman images` is not.
    const fromCli = await this.#listLocalImagesFromPodmanCli();
    return [...new Set([...fromEngine, ...fromCli])];
  }

  async #listLocalImagesFromEngine(): Promise<string[]> {
    try {
      const images = await extensionApi.containerEngine.listImages();
      const tags = images.flatMap(img => {
        const repoTags = img.RepoTags?.filter(Boolean) ?? [];
        if (repoTags.length > 0) return repoTags;
        const names = (img as { Names?: string[] | null }).Names;
        return names?.filter(Boolean) ?? [];
      });
      return [...new Set(tags)];
    } catch {
      return [];
    }
  }

  async #listLocalImagesFromPodmanCli(): Promise<string[]> {
    try {
      const result = await extensionApi.process.exec('podman', [
        'images',
        '--format',
        '{{.Repository}}:{{.Tag}}',
      ]);
      const lines = (result.stdout ?? '')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.includes('<none>'));
      return [...new Set(lines)];
    } catch {
      return [];
    }
  }

  #getRunningPodmanConnection() {
    const connections = extensionApi.provider.getContainerConnections();
    const podmanConnection = connections.find(
      c => c.connection.type === 'podman' && c.connection.status() === 'started',
    );

    if (!podmanConnection) {
      throw new Error('No running Podman connection found');
    }

    return podmanConnection;
  }

  /** Drop completed progress after a short window; clears any prior timer for the same key. */
  #scheduleProgressCleanup<T>(map: Map<string, T>, key: string, scope: string): void {
    const timerKey = `${scope}:${key}`;
    const existing = this.progressCleanupTimers.get(timerKey);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      map.delete(key);
      this.progressCleanupTimers.delete(timerKey);
    }, PROGRESS_RETENTION_MS);
    this.progressCleanupTimers.set(timerKey, timer);
  }

  #startImageBuild(
    tag: string,
    assetDir: string,
    buildargs?: { [key: string]: string },
  ): void {
    const podmanConnection = this.#getRunningPodmanConnection();

    const contextDir = extensionApi.Uri.joinPath(
      this.extensionContext.extensionUri, 'assets', assetDir,
    ).fsPath;

    // Replace any in-flight build for this tag
    const existing = this.buildAbortControllers.get(tag);
    if (existing) {
      existing.abort();
      this.buildAbortControllers.delete(tag);
    }

    const abortController = new AbortController();
    this.buildAbortControllers.set(tag, abortController);

    this.activeBuilds.set(tag, {
      tag,
      status: 'Starting...',
      logs: [],
    });

    extensionApi.containerEngine.buildImage(
      contextDir,
      (eventName: string, data: string) => {
        const progress = this.activeBuilds.get(tag);
        if (!progress || progress.done) return;

        if (eventName === 'stream') {
          const line = data.trim();
          if (line) {
            appendProgressLog(progress.logs, line);
            const stepMatch = line.match(/^STEP\s+(\d+)\/(\d+)/i);
            if (stepMatch) {
              progress.currentStep = parseInt(stepMatch[1], 10);
              progress.totalSteps = parseInt(stepMatch[2], 10);
              progress.status = `Building... Step ${progress.currentStep}/${progress.totalSteps}`;
            }
          }
        } else if (eventName === 'error') {
          appendProgressLog(progress.logs, `ERROR: ${data}`);
          progress.error = data;
        } else if (eventName === 'finish') {
          // Podman Desktop may emit finish before/without the Promise settling promptly.
          // Mark complete here so the UI does not stay stuck on Cancel.
          if (progress.cancelled || abortController.signal.aborted) {
            progress.status = 'Cancelled';
            progress.cancelled = true;
            progress.done = true;
            progress.error = 'Build cancelled';
            appendProgressLog(progress.logs, 'Build cancelled by user');
          } else {
            progress.status = 'Complete';
            progress.done = true;
            if (progress.totalSteps) {
              progress.currentStep = progress.totalSteps;
            }
            appendProgressLog(progress.logs, data?.trim() ? data.trim() : 'Build finished');
          }
          this.buildAbortControllers.delete(tag);
          this.#scheduleProgressCleanup(this.activeBuilds, tag, 'build');
        }
      },
      {
        containerFile: 'Containerfile',
        tag,
        provider: podmanConnection.connection,
        abortController,
        ...(buildargs ? { buildargs } : {}),
      },
    ).then(() => {
      this.buildAbortControllers.delete(tag);
      const progress = this.activeBuilds.get(tag);
      if (progress && !progress.done) {
        if (abortController.signal.aborted || progress.cancelled) {
          progress.status = 'Cancelled';
          progress.cancelled = true;
          progress.done = true;
          progress.error = 'Build cancelled';
          appendProgressLog(progress.logs, 'Build cancelled by user');
        } else {
          progress.status = 'Complete';
          progress.done = true;
        }
      }
      this.#scheduleProgressCleanup(this.activeBuilds, tag, 'build');
    }).catch((err: unknown) => {
      this.buildAbortControllers.delete(tag);
      const progress = this.activeBuilds.get(tag);
      if (progress && !progress.done) {
        if (abortController.signal.aborted || progress.cancelled) {
          progress.status = 'Cancelled';
          progress.cancelled = true;
          progress.done = true;
          progress.error = 'Build cancelled';
          appendProgressLog(progress.logs, 'Build cancelled by user');
        } else {
          progress.status = 'Failed';
          progress.done = true;
          progress.error = err instanceof Error ? err.message : String(err);
        }
      }
      this.#scheduleProgressCleanup(this.activeBuilds, tag, 'build');
    });
  }

  async cancelBuild(tag: string): Promise<void> {
    const abortController = this.buildAbortControllers.get(tag);
    const progress = this.activeBuilds.get(tag);

    if (!progress || progress.done) {
      return;
    }

    // Mark done immediately so the UI can leave "Cancelling..." even if Podman
    // takes a while (or forever) to settle the buildImage promise mid-RUN.
    progress.cancelled = true;
    progress.done = true;
    progress.status = 'Cancelled';
    progress.error = 'Build cancelled';
    appendProgressLog(progress.logs, 'Cancel requested — build aborted');

    if (abortController) {
      this.buildAbortControllers.delete(tag);
      abortController.abort();
    }

    this.#scheduleProgressCleanup(this.activeBuilds, tag, 'build');
  }

  async pullImage(fullImageName: string, tag: string): Promise<void> {
    const podmanConnection = this.#getRunningPodmanConnection();

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
      this.#scheduleProgressCleanup(this.activePulls, imageToPull, 'pull');
    }).catch((err: unknown) => {
      this.layerProgress.delete(imageToPull);
      this.activePulls.set(imageToPull, {
        image: imageToPull,
        status: 'Failed',
        done: true,
        error: err instanceof Error ? err.message : String(err),
      });
      this.#scheduleProgressCleanup(this.activePulls, imageToPull, 'pull');
    });
  }

  async getBuildProgress(tag: string): Promise<BuildProgress | null> {
    return this.activeBuilds.get(tag) || null;
  }

  async buildBaseImage(tag: string, config: SimulationConfig): Promise<void> {
    const profile = resolveSimulationProfile(config);
    if (!profile) {
      throw new Error(
        `No base image profile for ${formatSimulationConfig(config)}. ` +
          'Supported: humble/turtlebot3/dds/gazebo and jazzy/turtlebot3/dds/gazebo.',
      );
    }
    const baseImage = resolveSimulationBaseImage(config.baseImage);
    this.#startImageBuild(tag, profile.baseAssetDir, {
      ROS_BASE_IMAGE: baseImage.imageRef,
    });
  }

  async buildSimulationImage(tag: string, config: SimulationConfig): Promise<void> {
    const profile = resolveSimulationProfile(config);
    if (!profile) {
      throw new Error(
        `No simulation image available for ${formatSimulationConfig(config)}. ` +
          'Supported: humble/turtlebot3/dds/gazebo and jazzy/turtlebot3/dds/gazebo.',
      );
    }
    if (!profile.assetDir) {
      throw new Error(
        `Simulation images are not yet available for ${config.distro}. ` +
          'Only the base image can be built for this distro.',
      );
    }
    const ns = await this.getDefaultNamespace();
    const baseImage = resolveSimulationBaseImage(config.baseImage);
    const localBaseTag = `quay.io/${ns}/${profile.baseImageName}:${baseImage.imageTag}`;
    this.#startImageBuild(tag, profile.assetDir, {
      LOCAL_BASE_IMAGE: localBaseTag,
    });
  }

  async getPushProgress(tag: string): Promise<PushProgress | null> {
    return this.activePushes.get(tag) || null;
  }

  async getHostArch(): Promise<string> {
    return process.arch === 'arm64' ? 'arm64' : 'amd64';
  }

  async getDefaultNamespace(): Promise<string> {
    const config = extensionApi.configuration.getConfiguration('physical-ai');
    return config.get<string>('defaultNamespace') ?? 'ecosystem-appeng';
  }

  async getCatalogViewMode(): Promise<'all' | 'curated'> {
    const config = extensionApi.configuration.getConfiguration('physical-ai');
    const mode = config.get<string>('catalogViewMode');
    return mode === 'curated' ? 'curated' : 'all';
  }

  async setCatalogViewMode(mode: 'all' | 'curated'): Promise<void> {
    const config = extensionApi.configuration.getConfiguration('physical-ai');
    await config.update('catalogViewMode', mode);
  }

  async getCatalogCuratedAllowlist(): Promise<string> {
    const config = extensionApi.configuration.getConfiguration('physical-ai');
    return config.get<string>('catalogCuratedAllowlist') ?? 'ros2-*-base,ros2-*-turtlebot3,ros2-*-sim-*';
  }

  async getSimulationConfig(): Promise<SimulationConfig> {
    const config = extensionApi.configuration.getConfiguration('physical-ai');
    const rawBase = config.get<string>('simulationBaseImage');
    const baseImage = resolveSimulationBaseImage(rawBase).id;
    return {
      robot: config.get<string>('simulationRobot') ?? 'turtlebot3',
      distro: config.get<string>('simulationDistro') ?? 'humble',
      middleware: config.get<string>('simulationMiddleware') ?? 'dds',
      engine: config.get<string>('simulationEngine') ?? 'gazebo',
      baseImage,
    };
  }

  async saveSimulationConfig(config: SimulationConfig): Promise<void> {
    const pdConfig = extensionApi.configuration.getConfiguration('physical-ai');
    await pdConfig.update('simulationRobot', config.robot);
    await pdConfig.update('simulationDistro', config.distro);
    await pdConfig.update('simulationMiddleware', config.middleware);
    await pdConfig.update('simulationEngine', config.engine);
    await pdConfig.update('simulationBaseImage', config.baseImage);
  }

  #getEngineId(): string {
    const podmanConnection = this.#getRunningPodmanConnection();
    return podmanConnection.connection.name;
  }

  async launchSimulation(imageTag: string, containerName: string, options?: SimLaunchOptions): Promise<string> {
    const engineId = this.#getEngineId();
    const name = containerName || `${SIM_CONTAINER_PREFIX}${Date.now()}`;
    const labels: Record<string, string> = {
      [SIM_CONTAINER_LABEL]: SIM_CONTAINER_LABEL_VALUE,
      ...options?.labels,
    };

    const portMappings = options?.portMappings ?? [
      { hostPort: 6080, containerPort: 6080 },
      { hostPort: 8080, containerPort: 8080 },
    ];

    const env: Record<string, string> = {
      LIBGL_ALWAYS_SOFTWARE: '1',
      GALLIUM_DRIVER: 'llvmpipe',
      ...options?.env,
    };

    const envArray = Object.entries(env).map(([k, v]) => `${k}=${v}`);

    const createResult = await extensionApi.containerEngine.createContainer(
      engineId,
      {
        name,
        Image: imageTag,
        Cmd: options?.cmd ?? ['/entrypoint-gazebo.sh'],
        Env: envArray,
        Labels: labels,
        HostConfig: {
          PortBindings: Object.fromEntries(
            portMappings.map(p => [
              `${p.containerPort}/${p.protocol ?? 'tcp'}`,
              [{ HostPort: String(p.hostPort) }],
            ]),
          ),
        },
      },
    );

    await extensionApi.containerEngine.startContainer(engineId, createResult.id);
    return createResult.id;
  }

  async stopSimulation(containerId: string): Promise<void> {
    const engineId = await this.#findEngineIdForContainer(containerId);
    await extensionApi.containerEngine.stopContainer(engineId, containerId);
  }

  async deleteSimulation(containerId: string): Promise<void> {
    const engineId = await this.#findEngineIdForContainer(containerId);
    try {
      await extensionApi.containerEngine.stopContainer(engineId, containerId);
    } catch {
      // already stopped
    }
    await extensionApi.containerEngine.deleteContainer(engineId, containerId);
  }

  async #findEngineIdForContainer(containerId: string): Promise<string> {
    const containers = await extensionApi.containerEngine.listContainers();
    const match = containers.find(c => c.Id === containerId || c.Id.startsWith(containerId));
    if (match) return match.engineId;
    return this.#getEngineId();
  }

  async listSimulationContainers(): Promise<SimContainerInfo[]> {
    const containers = await extensionApi.containerEngine.listContainers();
    return containers
      .filter(c => c.Labels?.[SIM_CONTAINER_LABEL] === SIM_CONTAINER_LABEL_VALUE)
      .map(c => ({
        id: c.Id,
        name: c.Names?.[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12),
        imageTag: c.Image ?? '',
        state: (c.State === 'running' ? 'running'
          : c.State === 'exited' ? 'exited'
          : c.State === 'stopped' ? 'stopped'
          : 'unknown') as SimContainerInfo['state'],
        ports: (c.Ports ?? []).map(
          p => `${p.PublicPort ?? ''}:${p.PrivatePort ?? ''}/${p.Type ?? 'tcp'}`,
        ),
        labels: c.Labels ?? {},
      }));
  }

  async execInSimulation(containerId: string, command: string[]): Promise<ExecResult> {
    try {
      const result = await extensionApi.process.exec('podman', ['exec', '-d', containerId, ...command]);
      return {
        exitCode: 0,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      };
    } catch (err: unknown) {
      const runErr = err as { exitCode?: number; stdout?: string; stderr?: string; message?: string };
      return {
        exitCode: runErr.exitCode ?? 1,
        stdout: runErr.stdout ?? '',
        stderr: runErr.stderr ?? runErr.message ?? String(err),
      };
    }
  }

  async openSimulationInBrowser(port: number): Promise<void> {
    await extensionApi.env.openExternal(extensionApi.Uri.parse(`http://localhost:${port}`));
  }

  async pushImage(tag: string): Promise<void> {
    const images = await extensionApi.containerEngine.listImages();
    const imageInfo = images.find(img => img.RepoTags?.includes(tag));

    if (!imageInfo) {
      throw new Error(`Image not found locally: ${tag}`);
    }

    const existing = this.pushAbortControllers.get(tag);
    if (existing) {
      existing.abort();
      this.pushAbortControllers.delete(tag);
    }

    const abortController = new AbortController();
    this.pushAbortControllers.set(tag, abortController);

    this.activePushes.set(tag, {
      tag,
      status: 'Pushing...',
      logs: [],
    });

    PhysicalAiApiImpl.#pushImageWithAbort(
      imageInfo.engineId,
      tag,
      (name: string, data: string) => {
        const progress = this.activePushes.get(tag);
        if (!progress || progress.done) return;

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
              appendProgressLog(progress.logs, msg);
              progress.status = msg;
            }
          } catch {
            appendProgressLog(progress.logs, trimmed);
            progress.status = trimmed;
          }
        }
      },
      undefined,
      abortController,
    ).then(() => {
      this.pushAbortControllers.delete(tag);
      const progress = this.activePushes.get(tag);
      if (progress && !progress.done) {
        if (abortController.signal.aborted || progress.cancelled) {
          progress.status = 'Cancelled';
          progress.cancelled = true;
          progress.done = true;
          progress.error = 'Push cancelled';
          appendProgressLog(progress.logs, 'Push cancelled by user');
        } else {
          progress.status = 'Complete';
          progress.done = true;
        }
      }
      this.#scheduleProgressCleanup(this.activePushes, tag, 'push');
    }).catch((err: unknown) => {
      this.pushAbortControllers.delete(tag);
      const progress = this.activePushes.get(tag);
      if (progress && !progress.done) {
        if (abortController.signal.aborted || progress.cancelled) {
          progress.status = 'Cancelled';
          progress.cancelled = true;
          progress.done = true;
          progress.error = 'Push cancelled';
          appendProgressLog(progress.logs, 'Push cancelled by user');
        } else {
          progress.status = 'Failed';
          progress.done = true;
          progress.error = err instanceof Error ? err.message : String(err);
        }
      }
      this.#scheduleProgressCleanup(this.activePushes, tag, 'push');
    });
  }

  async cancelPush(tag: string): Promise<void> {
    const abortController = this.pushAbortControllers.get(tag);
    const progress = this.activePushes.get(tag);

    if (!progress || progress.done) {
      return;
    }

    progress.cancelled = true;
    progress.done = true;
    progress.status = 'Cancelled';
    progress.error = 'Push cancelled';
    appendProgressLog(progress.logs, 'Cancel requested — push aborted');

    if (abortController) {
      this.pushAbortControllers.delete(tag);
      abortController.abort();
    }

    this.#scheduleProgressCleanup(this.activePushes, tag, 'push');
  }
}
