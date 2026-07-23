import type { ExtensionContext } from '@podman-desktop/api';
import * as extensionApi from '@podman-desktop/api';
import type { PhysicalAiApi } from '/@shared/src/PhysicalAiApi';
import type { QuayRepository, QuayTag, PullProgress, BuildProgress, PushProgress } from '/@shared/src/types/ImageCatalog';
import type { SimulationConfig } from '/@shared/src/types/SimulationConfig';
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
  private progressCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

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

  async buildBaseImage(tag: string): Promise<void> {
    this.#startImageBuild(tag, 'ros2-jazzy-base');
  }

  async buildSimulationImage(tag: string, config: SimulationConfig): Promise<void> {
    const profile = resolveSimulationProfile(config);
    if (!profile) {
      throw new Error(
        `No simulation image available for ${formatSimulationConfig(config)}. ` +
          'Supported: humble/turtlebot3/dds/gazebo.',
      );
    }
    const baseImage = resolveSimulationBaseImage(config.baseImage);
    this.#startImageBuild(tag, profile.assetDir, {
      ROS_BASE_IMAGE: baseImage.imageRef,
    });
  }

  async getPushProgress(tag: string): Promise<PushProgress | null> {
    return this.activePushes.get(tag) || null;
  }

  async getDefaultNamespace(): Promise<string> {
    const config = extensionApi.configuration.getConfiguration('physical-ai');
    return config.get<string>('defaultNamespace') ?? 'ecosystem-appeng';
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
              appendProgressLog(progress.logs, msg);
              progress.status = msg;
            }
          } catch {
            appendProgressLog(progress.logs, trimmed);
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
      this.#scheduleProgressCleanup(this.activePushes, tag, 'push');
    }).catch((err: unknown) => {
      const progress = this.activePushes.get(tag);
      if (progress) {
        progress.status = 'Failed';
        progress.done = true;
        progress.error = err instanceof Error ? err.message : String(err);
      }
      this.#scheduleProgressCleanup(this.activePushes, tag, 'push');
    });
  }
}
