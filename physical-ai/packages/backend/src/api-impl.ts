import type { ExtensionContext } from '@podman-desktop/api';
import * as extensionApi from '@podman-desktop/api';
import type { PhysicalAiApi } from '/@shared/src/PhysicalAiApi';
import type { QuayRepository, QuayTag, PullProgress, BuildProgress, PushProgress } from '/@shared/src/types/ImageCatalog';
import type { SimulationConfig } from '/@shared/src/types/SimulationConfig';
import type { SimLaunchOptions, SimContainerInfo, ExecResult } from '/@shared/src/types/SimulationContainer';
import { SIM_CONTAINER_LABEL, SIM_CONTAINER_LABEL_VALUE, SIM_CONTAINER_PREFIX } from '/@shared/src/types/SimulationContainer';
import { formatSimulationConfig, resolveSimulationProfile } from '/@shared/src/types/SimulationProfiles';
import { resolveSimulationBaseImage } from '/@shared/src/types/SimulationBaseImages';
import { DEFAULT_CURATED_ALLOWLIST } from '/@shared/src/types/CatalogCurated';
import type { TopicInfo, TopicDetailInfo, TopicNodeInfo, TopicPeekResult } from '/@shared/src/types/TopicInfo';
import type { NavigationGoalResult } from '/@shared/src/types/NavigationGoalResult';
import {
  assertRobotName,
  assertRosTopicName,
  assertRosDistro,
  assertSpawnExecCommand,
  assertLaunchCmd,
  assertLaunchEnv,
  assertLaunchLabels,
  assertPortMappings,
  assertContainerName,
  assertBrowserPort,
  ROS_TOPIC_NAME_RE,
  type SupportedRosDistro,
} from '/@shared/src/security/simInput';
import { assertLaunchImageTag } from '/@shared/src/security/simImageTrust';
import { assertQuayName } from '/@shared/src/security/quayNames';
import { appendProgressLog } from './progressLogs';

const QUAY_API_BASE = 'https://quay.io/api/v1';
/** How long completed progress entries stay queryable for the UI. */
const PROGRESS_RETENTION_MS = 30_000;
/** Cap concurrent in-flight pull/build/push ops. */
const MAX_IN_FLIGHT_OPS = 5;

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
    const safeNs = assertQuayName(namespace, 'namespace');
    const repos: QuayRepository[] = [];
    let nextPage: string | undefined;

    do {
      const url = new URL(`${QUAY_API_BASE}/repository`);
      url.searchParams.set('namespace', safeNs);
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
    const safeNs = assertQuayName(namespace, 'namespace');
    const safeName = assertQuayName(name, 'repository');
    const url = new URL(
      `${QUAY_API_BASE}/repository/${encodeURIComponent(safeNs)}/${encodeURIComponent(safeName)}/tag/`,
    );
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

  #countInFlight(map: Map<string, { done?: boolean }>): number {
    let n = 0;
    for (const v of map.values()) {
      if (!v.done) n++;
    }
    return n;
  }

  #assertCanStartOp(map: Map<string, { done?: boolean }>, key: string, kind: string): void {
    const existing = map.get(key);
    if (existing && !existing.done) {
      return; // replacing same in-flight key is allowed
    }
    if (this.#countInFlight(map) >= MAX_IN_FLIGHT_OPS) {
      throw new Error(
        `Too many concurrent ${kind} operations (max ${MAX_IN_FLIGHT_OPS}). Wait for one to finish.`,
      );
    }
  }

  #startImageBuild(
    tag: string,
    assetDir: string,
    buildargs?: { [key: string]: string },
  ): void {
    this.#assertCanStartOp(this.activeBuilds, tag, 'build');
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
    this.#assertCanStartOp(this.activePulls, imageToPull, 'pull');
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
    if (mode !== 'all' && mode !== 'curated') {
      throw new Error(`Invalid catalog view mode "${String(mode)}". Use "all" or "curated".`);
    }
    const config = extensionApi.configuration.getConfiguration('physical-ai');
    await config.update('catalogViewMode', mode);
  }

  async getCatalogCuratedAllowlist(): Promise<string> {
    const config = extensionApi.configuration.getConfiguration('physical-ai');
    const stored = config.get<string>('catalogCuratedAllowlist');
    if (!stored || stored === 'ros2-*-base,ros2-*-turtlebot3,ros2-*-sim-*') {
      await config.update('catalogCuratedAllowlist', DEFAULT_CURATED_ALLOWLIST);
      return DEFAULT_CURATED_ALLOWLIST;
    }
    return stored;
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

  async #getEngineId(imageTag?: string): Promise<string> {
    if (imageTag) {
      const images = await extensionApi.containerEngine.listImages();
      const match = images.find(img => img.RepoTags?.includes(imageTag));
      if (match) return match.engineId;
    }
    const containers = await extensionApi.containerEngine.listContainers();
    if (containers.length > 0) return containers[0].engineId;
    throw new Error('no engine matching this container');
  }

  async getSimulationImageAllowlist(): Promise<string> {
    const config = extensionApi.configuration.getConfiguration('physical-ai');
    return config.get<string>('simulationImageAllowlist') ?? '';
  }

  async launchSimulation(imageTag: string, containerName: string, options?: SimLaunchOptions): Promise<string> {
    const allowlist = await this.getSimulationImageAllowlist();
    const safeImageTag = assertLaunchImageTag(imageTag, allowlist || null);
    const engineId = await this.#getEngineId(safeImageTag);
    const name = containerName
      ? assertContainerName(containerName)
      : `${SIM_CONTAINER_PREFIX}${Date.now()}`;

    // Role label always wins — client cannot clear or redefine it.
    const labels: Record<string, string> = {
      ...assertLaunchLabels(options?.labels),
      [SIM_CONTAINER_LABEL]: SIM_CONTAINER_LABEL_VALUE,
    };

    const portMappings = assertPortMappings(options?.portMappings) ?? [
      { hostPort: 6080, containerPort: 6080, protocol: 'tcp' },
      { hostPort: 8080, containerPort: 8080, protocol: 'tcp' },
    ];

    const cmd = assertLaunchCmd(options?.cmd);
    const clientEnv = assertLaunchEnv(options?.env);
    const env: Record<string, string> = {
      LIBGL_ALWAYS_SOFTWARE: '1',
      GALLIUM_DRIVER: 'llvmpipe',
      ...clientEnv,
    };

    const envArray = Object.entries(env).map(([k, v]) => `${k}=${v}`);

    const createResult = await extensionApi.containerEngine.createContainer(
      engineId,
      {
        name,
        Image: safeImageTag,
        Cmd: cmd,
        Env: envArray,
        Labels: labels,
        HostConfig: {
          PortBindings: Object.fromEntries(
            portMappings.map(p => [
              `${p.containerPort}/${p.protocol}`,
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
    const { id, engineId } = await this.#resolveSimulationContainer(containerId);
    await extensionApi.containerEngine.stopContainer(engineId, id);
  }

  async deleteSimulation(containerId: string): Promise<void> {
    const { id, engineId } = await this.#resolveSimulationContainer(containerId);
    try {
      await extensionApi.containerEngine.stopContainer(engineId, id);
    } catch {
      // already stopped
    }
    await extensionApi.containerEngine.deleteContainer(engineId, id);
  }

  async #resolveSimulationContainer(
    containerId: string,
  ): Promise<{ id: string; engineId: string; image: string }> {
    if (!containerId || typeof containerId !== 'string' || containerId.length < 12) {
      throw new Error('Container id must be at least 12 characters.');
    }
    const containers = await extensionApi.containerEngine.listContainers();
    const matches = containers.filter(
      c => c.Id === containerId || c.Id.startsWith(containerId),
    );
    if (matches.length === 0) {
      throw new Error('Not a Physical AI simulation container');
    }
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous container id "${containerId}" matches ${matches.length} containers.`,
      );
    }
    const match = matches[0];
    if (match.Labels?.[SIM_CONTAINER_LABEL] !== SIM_CONTAINER_LABEL_VALUE) {
      throw new Error('Not a Physical AI simulation container');
    }
    return { id: match.Id, engineId: match.engineId, image: match.Image ?? '' };
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
    const { id } = await this.#resolveSimulationContainer(containerId);
    const safeCommand = assertSpawnExecCommand(command);
    try {
      // Detached: entrypoint backgrounds work; exitCode reflects only whether
      // podman accepted the exec, not whether spawn succeeded inside the container.
      const result = await extensionApi.process.exec('podman', [
        'exec',
        '-d',
        id,
        ...safeCommand,
      ]);
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
    const safePort = assertBrowserPort(port);
    await extensionApi.env.openExternal(extensionApi.Uri.parse(`http://localhost:${safePort}`));
  }

  async listRosTopics(containerId: string): Promise<TopicInfo[]> {
    const { id } = await this.#resolveSimulationContainer(containerId);
    const distro = await this.#detectRosDistro(id);

    const listResult = await this.#execRosBash(id, distro, 'ros2 topic list');

    if (listResult.exitCode !== 0 || !listResult.stdout.trim()) {
      return [];
    }

    const topicNames = listResult.stdout
      .trim()
      .split('\n')
      .map(l => l.trim())
      .filter(l => ROS_TOPIC_NAME_RE.test(l));

    const BATCH_SIZE = 5;
    const topics: TopicInfo[] = [];

    for (let i = 0; i < topicNames.length; i += BATCH_SIZE) {
      const batch = topicNames.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (name): Promise<TopicInfo> => {
          const infoResult = await this.#execRosBash(
            id,
            distro,
            'ros2 topic info "$1"',
            [name],
          );

          let type = 'unknown';
          let publishers = 0;
          let subscribers = 0;

          if (infoResult.exitCode === 0 && infoResult.stdout) {
            const typeMatch = infoResult.stdout.match(/Type:\s*(.+)/);
            const pubMatch = infoResult.stdout.match(/Publisher count:\s*(\d+)/);
            const subMatch = infoResult.stdout.match(/Subscription count:\s*(\d+)/);
            if (typeMatch) type = typeMatch[1].trim();
            if (pubMatch) publishers = parseInt(pubMatch[1], 10);
            if (subMatch) subscribers = parseInt(subMatch[1], 10);
          }

          return { name, type, publishers, subscribers };
        }),
      );
      topics.push(...results);
    }

    return topics;
  }

  async getRosTopicDetail(containerId: string, topicName: string): Promise<TopicDetailInfo> {
    const { id } = await this.#resolveSimulationContainer(containerId);
    const safeTopic = assertRosTopicName(topicName);
    const distro = await this.#detectRosDistro(id);

    const result = await this.#execRosBash(
      id,
      distro,
      'ros2 topic info -v "$1"',
      [safeTopic],
    );

    let type = 'unknown';
    const publishers: TopicNodeInfo[] = [];
    const subscribers: TopicNodeInfo[] = [];

    if (result.exitCode === 0 && result.stdout) {
      const typeMatch = result.stdout.match(/Type:\s*(.+)/);
      if (typeMatch) type = typeMatch[1].trim();

      const nodePattern = /Node name:\s*(.+)\s*\n\s*Node namespace:\s*(.+)/g;

      const pubSection = result.stdout.match(/Publisher count:[\s\S]*?(?=Subscription count:|$)/);
      if (pubSection) {
        let match;
        while ((match = nodePattern.exec(pubSection[0])) !== null) {
          publishers.push({ nodeName: match[1].trim(), nodeNamespace: match[2].trim() });
        }
      }

      const subSection = result.stdout.match(/Subscription count:[\s\S]*/);
      if (subSection) {
        const subPattern = /Node name:\s*(.+)\s*\n\s*Node namespace:\s*(.+)/g;
        let match;
        while ((match = subPattern.exec(subSection[0])) !== null) {
          subscribers.push({ nodeName: match[1].trim(), nodeNamespace: match[2].trim() });
        }
      }
    }

    return { topicName: safeTopic, type, publishers, subscribers };
  }

  async peekRosTopic(containerId: string, topicName: string): Promise<TopicPeekResult> {
    const { id } = await this.#resolveSimulationContainer(containerId);
    const safeTopic = assertRosTopicName(topicName);
    const distro = await this.#detectRosDistro(id);

    // Bound wait so idle topics do not hang the UI (timeout exits 124).
    const PEEK_TIMEOUT_SEC = '5';
    const result = await this.#execRosBash(
      id,
      distro,
      'timeout "$1" ros2 topic echo --once "$2"',
      [PEEK_TIMEOUT_SEC, safeTopic],
    );

    const stdout = (result.stdout ?? '').trim();
    const stderr = (result.stderr ?? '').trim();
    const timedOut =
      result.exitCode === 124 ||
      /timeout/i.test(stderr) ||
      (result.exitCode !== 0 && !stdout);

    if (stdout) {
      return { topicName: safeTopic, message: stdout, timedOut: false };
    }

    if (timedOut) {
      return {
        topicName: safeTopic,
        message: '',
        timedOut: true,
        error: `No message on ${safeTopic} within ${PEEK_TIMEOUT_SEC}s`,
      };
    }

    return {
      topicName: safeTopic,
      message: '',
      timedOut: false,
      error: stderr || `Failed to peek ${safeTopic} (exit ${result.exitCode})`,
    };
  }

  async sendNavigationGoal(
    containerId: string,
    robotName: string,
    x: number,
    y: number,
  ): Promise<NavigationGoalResult> {
    const { id } = await this.#resolveSimulationContainer(containerId);
    const safeRobot = assertRobotName(robotName);
    const distro = await this.#detectRosDistro(id);

    const pose = await this.#getRobotPose(id, safeRobot, distro);
    const dx = x - pose.x;
    const dy = y - pose.y;
    const targetAngle = Math.atan2(dy, dx);
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 0.1) {
      return { status: 'reached', message: `Already at (${x}, ${y})` };
    }

    let turnDelta = targetAngle - pose.yaw;
    while (turnDelta > Math.PI) turnDelta -= 2 * Math.PI;
    while (turnDelta < -Math.PI) turnDelta += 2 * Math.PI;

    if (Math.abs(turnDelta) > 0.1) {
      const turnSpeed = 0.5 * Math.sign(turnDelta);
      const turnDuration = Math.min(Math.ceil(Math.abs(turnDelta) / 0.5), 8);
      await this.#execRosBash(
        id,
        distro,
        'timeout "$1" ros2 topic pub --rate 10 "/$2/cmd_vel" geometry_msgs/msg/Twist "{angular: {z: $3}}" || true',
        [String(turnDuration), safeRobot, turnSpeed.toFixed(2)],
      );
      await this.#execRosBash(
        id,
        distro,
        'ros2 topic pub --once "/$1/cmd_vel" geometry_msgs/msg/Twist "{}"',
        [safeRobot],
      );
    }

    const speed = 0.2;
    const durationSec = Math.min(Math.ceil(distance / speed), 30);
    const result = await this.#execRosBash(
      id,
      distro,
      'timeout "$1" ros2 topic pub --rate 10 "/$2/cmd_vel" geometry_msgs/msg/Twist "{linear: {x: $3}}" || true',
      [String(durationSec), safeRobot, String(speed)],
    );

    await this.#execRosBash(
      id,
      distro,
      'ros2 topic pub --once "/$1/cmd_vel" geometry_msgs/msg/Twist "{}"',
      [safeRobot],
    );

    if (result.exitCode !== 0 && !/timeout/i.test(result.stderr)) {
      return { status: 'failed', message: result.stderr || 'Drive command failed' };
    }

    const finalPose = await this.#getRobotPose(id, safeRobot, distro);
    const remaining = Math.hypot(x - finalPose.x, y - finalPose.y);
    if (remaining < 0.35) {
      return {
        status: 'reached',
        message: `Drove to near (${x}, ${y}) (≈${remaining.toFixed(2)}m remaining)`,
      };
    }
    return {
      status: 'failed',
      message: `Drove ${durationSec}s toward (${x}, ${y}) but still ≈${remaining.toFixed(2)}m away`,
    };
  }

  async #getRobotPose(
    containerId: string,
    robotName: string,
    distro: SupportedRosDistro,
  ): Promise<{ x: number; y: number; yaw: number }> {
    const result = await this.#execRosBash(
      containerId,
      distro,
      'gz model -m "$1" -p 2>/dev/null',
      [robotName],
    );
    const nums = result.stdout.match(/-?\d+\.\d+/g)?.map(Number);
    if (nums && nums.length >= 6 && nums.every(n => !isNaN(n))) {
      return { x: nums[0], y: nums[1], yaw: nums[5] };
    }
    throw new Error(
      `Could not read pose for robot "${robotName}". Is it spawned in Gazebo?`,
    );
  }

  /**
   * Run a shell snippet after sourcing ROS setup. Dynamic values must be passed
   * as `args` and referenced as `$1`, `$2`, … inside `script` — never concatenated.
   */
  async #execRosBash(
    containerId: string,
    distro: SupportedRosDistro,
    script: string,
    args: string[] = [],
  ): Promise<ExecResult> {
    const safeDistro = assertRosDistro(distro);
    const setup = `/opt/ros/${safeDistro}/setup.bash`;
    return this.#execAttached(containerId, [
      'bash',
      '-c',
      `source "${setup}" && ${script}`,
      '_',
      ...args,
    ]);
  }

  async #assertSimulationContainer(containerId: string): Promise<string> {
    const { id } = await this.#resolveSimulationContainer(containerId);
    return id;
  }

  async #execAttached(containerId: string, command: string[]): Promise<ExecResult> {
    try {
      const result = await extensionApi.process.exec('podman', ['exec', containerId, ...command]);
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

  async #detectRosDistro(containerId: string): Promise<SupportedRosDistro> {
    const { image } = await this.#resolveSimulationContainer(containerId);
    if (image.includes('humble')) return 'humble';
    if (image.includes('jazzy')) return 'jazzy';
    throw new Error(
      `Unsupported ROS distro for image "${image}". Tag must include "humble" or "jazzy".`,
    );
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

    this.#assertCanStartOp(this.activePushes, tag, 'push');
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
