import type { ExtensionContext } from '@podman-desktop/api';
import * as extensionApi from '@podman-desktop/api';
import type { PhysicalAiApi } from '/@shared/src/PhysicalAiApi';
import type {
  QuayRepository,
  QuayTag,
  PullProgress,
  BuildProgress,
  PushProgress,
} from '/@shared/src/types/ImageCatalog';
import type { SimulationConfig } from '/@shared/src/types/SimulationConfig';
import type { SimLaunchOptions, SimContainerInfo, ExecResult } from '/@shared/src/types/SimulationContainer';
import {
  SIM_CONTAINER_LABEL,
  SIM_CONTAINER_LABEL_VALUE,
  SIM_CONTAINER_PREFIX,
  SIM_STOPPED_BROWSER_HINT,
} from '/@shared/src/types/SimulationContainer';
import {
  formatSimulationConfig,
  resolveSimulationProfile,
  archTagSuffix,
  platformForArch,
} from '/@shared/src/types/SimulationProfiles';
import { resolveSimulationBaseImage } from '/@shared/src/types/SimulationBaseImages';
import type {
  OpenShiftDeployConfig,
  OpenShiftDeployResult,
  OpenShiftContext,
  OpenShiftWorkload,
} from '/@shared/src/types/OpenShiftDeploy';
import {
  buildOpenShiftManifests,
  manifestsToYaml,
  assertNamespace,
  assertK8sName,
  assertCpuCount,
  DEFAULT_SW_RENDER_CPU,
  PART_OF_LABEL,
  PART_OF_VALUE,
} from '/@shared/src/openshift/manifests';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CURATED_ALLOWLIST } from '/@shared/src/types/CatalogCurated';
import type {
  TopicInfo,
  TopicDetailInfo,
  TopicNodeInfo,
  TopicPeekResult,
  TopicSchemaResult,
} from '/@shared/src/types/TopicInfo';
import type { NavigationGoalResult, Nav2WarmStatus } from '/@shared/src/types/NavigationGoalResult';
import {
  assertRobotName,
  assertRosTopicName,
  assertRosDistro,
  NAV2_ENTRYPOINT,
  SPAWN_ENTRYPOINT,
  assertSpawnExecCommand,
  assertLaunchCmd,
  assertLaunchEnv,
  assertLaunchLabels,
  assertPortMappings,
  assertContainerName,
  simulationBrowserUrl,
  ROS_TOPIC_NAME_RE,
  type SupportedRosDistro,
} from '/@shared/src/security/simInput';
import { assertLaunchImageTag } from '/@shared/src/security/simImageTrust';
import { assertQuayName } from '/@shared/src/security/quayNames';
import {
  assertRosMessageType,
  cleanEchoOutput,
  assertPeekTimeoutSeconds,
  PEEK_TIMEOUT_DEFAULT_SEC,
  PEEK_MAX_BYTES,
} from '/@shared/src/ros/topicPeek';
import { appendProgressLog } from './progressLogs';

const QUAY_API_BASE = 'https://quay.io/api/v1';
/** How long completed progress entries stay queryable for the UI. */
const PROGRESS_RETENTION_MS = 30_000;
/**
 * Seconds to poll for the map→base_link TF after launching Nav2. Sized for the
 * software-render cold-start (~40–90 s under llvmpipe); GPU/warm paths return
 * well before this. Pre-warm runs in the background, so a long wait is invisible.
 */
const NAV2_TF_POLL_ATTEMPTS = 120;

/**
 * First non-empty string among the arguments, or '' if none.
 * Preserves the "skip blank" behavior of `a || b` for strings (which `??` does not).
 */
function firstNonEmpty(...values: (string | undefined)[]): string {
  for (const value of values) {
    if (value && value.length > 0) return value;
  }
  return '';
}
/** Cap concurrent in-flight pull/build/push ops. */
const MAX_IN_FLIGHT_OPS = 5;

/**
 * Where an in-container command runs. The same spawn/Nav2/topic logic works
 * against a local Podman container (`podman exec`) or a deployed OpenShift pod
 * (`oc exec`) — only the transport differs.
 */
type ExecTarget =
  | { readonly kind: 'podman'; readonly id: string }
  | { readonly kind: 'oc'; readonly pod: string; readonly namespace: string };

/** Single-quote a value for safe interpolation into a remote `bash -c` string. */
function shSingleQuote(value: string): string {
  const escaped = value.replace(/'/g, `'\\''`);
  return `'${escaped}'`;
}

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
   * Nav2 pre-warm state per robot, keyed by a logical scope (see #warmKey): set
   * to 'warming' when #prewarmNav2 starts, 'ready' once the stack is up, 'failed'
   * if pre-warm gives up, and cleared on teardown. Queried by the UI so an early
   * Navigate click can show honest "warming…" progress. Absent key = 'idle'.
   */
  private nav2WarmStatus = new Map<string, Nav2WarmStatus>();

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

  async getPullProgress(image: string): Promise<PullProgress | undefined> {
    return this.activePulls.get(image);
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
      const result = await extensionApi.process.exec('podman', ['images', '--format', '{{.Repository}}:{{.Tag}}']);
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
      throw new Error(`Too many concurrent ${kind} operations (max ${MAX_IN_FLIGHT_OPS}). Wait for one to finish.`);
    }
  }

  #startImageBuild(tag: string, assetDir: string, buildargs?: { [key: string]: string }, platform?: string): void {
    this.#assertCanStartOp(this.activeBuilds, tag, 'build');
    const podmanConnection = this.#getRunningPodmanConnection();

    const contextDir = extensionApi.Uri.joinPath(this.extensionContext.extensionUri, 'assets', assetDir).fsPath;

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

    extensionApi.containerEngine
      .buildImage(
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
          ...(platform ? { platform } : {}),
        },
      )
      .then(() => {
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
      })
      .catch((err: unknown) => {
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

    extensionApi.containerEngine
      .pullImage(podmanConnection.connection, imageToPull, event => {
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
          status: totalSize > 0 ? 'Downloading' : (event.status ?? ''),
          currentMB: totalSize > 0 ? Math.round((totalCurrent / (1024 * 1024)) * 10) / 10 : undefined,
          totalMB: totalSize > 0 ? Math.round((totalSize / (1024 * 1024)) * 10) / 10 : undefined,
        });
      })
      .then(() => {
        this.layerProgress.delete(imageToPull);
        this.activePulls.set(imageToPull, { image: imageToPull, status: 'Complete', done: true });
        this.#scheduleProgressCleanup(this.activePulls, imageToPull, 'pull');
      })
      .catch((err: unknown) => {
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

  async getBuildProgress(tag: string): Promise<BuildProgress | undefined> {
    return this.activeBuilds.get(tag);
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
    this.#startImageBuild(
      tag,
      profile.baseAssetDir,
      { ROS_BASE_IMAGE: baseImage.imageRef },
      platformForArch(config.targetArch),
    );
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
    // The Phase 1 base carries the same arch suffix, so point FROM at it.
    const localBaseTag = `quay.io/${ns}/${profile.baseImageName}:${baseImage.imageTag}${archTagSuffix(config.targetArch)}`;
    this.#startImageBuild(
      tag,
      profile.assetDir,
      { LOCAL_BASE_IMAGE: localBaseTag },
      platformForArch(config.targetArch),
    );
  }

  async getPushProgress(tag: string): Promise<PushProgress | undefined> {
    return this.activePushes.get(tag);
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

  async getTopicPeekTimeoutSeconds(): Promise<number> {
    const config = extensionApi.configuration.getConfiguration('physical-ai');
    const raw = config.get<number>('topicPeekTimeoutSeconds');
    if (raw === undefined) {
      return PEEK_TIMEOUT_DEFAULT_SEC;
    }
    return assertPeekTimeoutSeconds(raw);
  }

  async setTopicPeekTimeoutSeconds(seconds: number): Promise<void> {
    const safe = assertPeekTimeoutSeconds(seconds);
    const config = extensionApi.configuration.getConfiguration('physical-ai');
    await config.update('topicPeekTimeoutSeconds', safe);
  }

  async getDefaultSoftwareRenderCpus(): Promise<number> {
    const config = extensionApi.configuration.getConfiguration('physical-ai');
    const raw = config.get<number>('defaultSoftwareRenderCpus');
    if (raw === undefined) {
      return DEFAULT_SW_RENDER_CPU;
    }
    // Fall back to the built-in default if the setting is somehow out of range,
    // rather than throwing — this only seeds the form (deploy still validates).
    try {
      return assertCpuCount(raw);
    } catch {
      return DEFAULT_SW_RENDER_CPU;
    }
  }

  async launchSimulation(imageTag: string, containerName: string, options?: SimLaunchOptions): Promise<string> {
    const allowlist = await this.getSimulationImageAllowlist();
    const safeImageTag = assertLaunchImageTag(imageTag, allowlist);
    const engineId = await this.#getEngineId(safeImageTag);
    const name = containerName ? assertContainerName(containerName) : `${SIM_CONTAINER_PREFIX}${Date.now()}`;

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
    const useGpu = await this.#simulationGpuPassthroughEnabled();
    const env: Record<string, string> = { ...clientEnv };
    if (useGpu) {
      env.PHYSICAL_AI_USE_GPU = '1';
    } else {
      env.LIBGL_ALWAYS_SOFTWARE = '1';
      env.GALLIUM_DRIVER = 'llvmpipe';
    }

    const envArray = Object.entries(env).map(([k, v]) => `${k}=${v}`);

    const hostConfig: {
      PortBindings: Record<string, Array<{ HostPort: string }>>;
      Devices?: Array<{ PathOnHost: string; PathInContainer: string; CgroupPermissions: string }>;
    } = {
      PortBindings: Object.fromEntries(
        portMappings.map(p => [`${p.containerPort}/${p.protocol}`, [{ HostPort: String(p.hostPort) }]]),
      ),
    };
    if (useGpu) {
      hostConfig.Devices = this.#simulationGpuDeviceMappings();
    }

    const createResult = await extensionApi.containerEngine.createContainer(engineId, {
      name,
      Image: safeImageTag,
      Cmd: cmd,
      Env: envArray,
      Labels: labels,
      HostConfig: hostConfig,
    });

    await extensionApi.containerEngine.startContainer(engineId, createResult.id);
    return createResult.id;
  }

  async #simulationGpuPassthroughEnabled(): Promise<boolean> {
    if (process.arch !== 'arm64') {
      return false;
    }
    const config = extensionApi.configuration.getConfiguration('physical-ai');
    return config.get<boolean>('simulationGpuPassthrough') ?? true;
  }

  #simulationGpuDeviceMappings(): Array<{ PathOnHost: string; PathInContainer: string; CgroupPermissions: string }> {
    return [
      { PathOnHost: '/dev/dri/card0', PathInContainer: '/dev/dri/card0', CgroupPermissions: 'rwm' },
      { PathOnHost: '/dev/dri/renderD128', PathInContainer: '/dev/dri/renderD128', CgroupPermissions: 'rwm' },
    ];
  }

  async stopSimulation(containerId: string): Promise<void> {
    const { id, engineId } = await this.#resolveSimulationContainer(containerId);
    await extensionApi.containerEngine.stopContainer(engineId, id);
  }

  async deleteSimulation(containerId: string): Promise<void> {
    const { id } = await this.#resolveSimulationContainer(containerId);
    // Force-remove via CLI — containerEngine.deleteContainer can leave exited
    // containers listed (stop-only leftovers). `rm -f` stops if needed and deletes.
    try {
      await extensionApi.process.exec('podman', ['rm', '-f', id]);
    } catch (err: unknown) {
      const runErr = err as { stderr?: string; message?: string };
      const detail = firstNonEmpty(runErr.stderr?.trim(), runErr.message, String(err));
      // Already gone is success
      if (!/no such container|not found/i.test(detail)) {
        throw new Error(`Failed to remove simulation container: ${detail}`);
      }
    }
    await extensionApi.window.showInformationMessage(SIM_STOPPED_BROWSER_HINT);
  }

  async #resolveSimulationContainer(containerId: string): Promise<{ id: string; engineId: string; image: string }> {
    if (!containerId || typeof containerId !== 'string' || containerId.length < 12) {
      throw new Error('Container id must be at least 12 characters.');
    }
    const containers = await extensionApi.containerEngine.listContainers();
    const matches = containers.filter(c => c.Id === containerId || c.Id.startsWith(containerId));
    if (matches.length === 0) {
      throw new Error('Not a Physical AI simulation container');
    }
    if (matches.length > 1) {
      throw new Error(`Ambiguous container id "${containerId}" matches ${matches.length} containers.`);
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
        state: (c.State === 'running'
          ? 'running'
          : c.State === 'exited'
            ? 'exited'
            : c.State === 'stopped'
              ? 'stopped'
              : 'unknown') as SimContainerInfo['state'],
        ports: (c.Ports ?? []).map(p => `${p.PublicPort ?? ''}:${p.PrivatePort ?? ''}/${p.Type ?? 'tcp'}`),
        labels: c.Labels ?? {},
      }));
  }

  async execInSimulation(containerId: string, command: string[]): Promise<ExecResult> {
    const { id, image } = await this.#resolveSimulationContainer(containerId);
    const [, safeRobot, safeX, safeY, safeYaw] = assertSpawnExecCommand(command);
    const safeCommand = [SPAWN_ENTRYPOINT, safeRobot, safeX, safeY, safeYaw];
    try {
      // Detached: entrypoint backgrounds work; exitCode reflects only whether
      // podman accepted the exec, not whether spawn succeeded inside the container.
      const result = await extensionApi.process.exec('podman', ['exec', '-d', id, ...safeCommand]);
      // Warm Nav2 in the background so the first Navigate click is instant (Jazzy only).
      if (image.includes('jazzy')) {
        const pose = { x: Number(safeX), y: Number(safeY), yaw: Number(safeYaw) };
        const warmKey = PhysicalAiApiImpl.#warmKey(id, safeRobot);
        void this.#prewarmNav2(warmKey, { kind: 'podman', id }, safeRobot, pose, 'jazzy');
      }
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

  async openSimulationInBrowser(hostPort: number, containerPort?: number): Promise<void> {
    const url = simulationBrowserUrl(hostPort, containerPort);
    await extensionApi.env.openExternal(extensionApi.Uri.parse(url));
  }

  async openUrlInBrowser(url: string): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`Only http(s) URLs can be opened, got: ${parsed.protocol}`);
    }
    await extensionApi.env.openExternal(extensionApi.Uri.parse(url));
  }

  async listRosTopics(containerId: string): Promise<TopicInfo[]> {
    const { id } = await this.#resolveSimulationContainer(containerId);
    const distro = await this.#detectRosDistro(id);
    const target = { kind: 'podman', id } as const;

    const listResult = await this.#execRosBash(target, distro, 'ros2 topic list');

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
          const infoResult = await this.#execRosBash(target, distro, 'ros2 topic info "$1"', [name]);

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
    const target = { kind: 'podman', id } as const;

    const result = await this.#execRosBash(target, distro, 'ros2 topic info -v "$1"', [safeTopic]);

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
        while ((match = nodePattern.exec(pubSection[0]))) {
          publishers.push({ nodeName: match[1].trim(), nodeNamespace: match[2].trim() });
        }
      }

      const subSection = result.stdout.match(/Subscription count:[\s\S]*/);
      if (subSection) {
        const subPattern = /Node name:\s*(.+)\s*\n\s*Node namespace:\s*(.+)/g;
        let match;
        while ((match = subPattern.exec(subSection[0]))) {
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
    const capturedAt = new Date().toISOString();

    let peekTimeoutSec: number;
    try {
      peekTimeoutSec = await this.getTopicPeekTimeoutSeconds();
    } catch (e) {
      return {
        topicName: safeTopic,
        message: '',
        timedOut: false,
        capturedAt,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    const peekTimeoutArg = String(peekTimeoutSec);

    // Bound wait so idle topics do not hang the UI (timeout exits 124).
    // best_effort reduces "message was lost" spam on high-rate sensor topics.
    const target = { kind: 'podman', id } as const;
    const result = await this.#execRosBash(
      target,
      distro,
      'timeout "$1" ros2 topic echo --once --qos-reliability best_effort --qos-durability volatile "$2"',
      [peekTimeoutArg, safeTopic],
    );

    const stdout = (result.stdout ?? '').trim();
    const stderr = (result.stderr ?? '').trim();
    const timedOut = result.exitCode === 124 || /timeout/i.test(stderr) || (result.exitCode !== 0 && !stdout);

    if (stdout) {
      const cleaned = cleanEchoOutput(stdout);
      return {
        topicName: safeTopic,
        message: cleaned.message,
        timedOut: false,
        capturedAt,
        messageStamp: cleaned.messageStamp,
        truncated: cleaned.truncated || undefined,
      };
    }

    if (timedOut) {
      return {
        topicName: safeTopic,
        message: '',
        timedOut: true,
        capturedAt,
        error:
          `No message on ${safeTopic} within ${peekTimeoutSec}s. ` +
          'The topic may be idle or publishing infrequently — try one with active publishers.',
      };
    }

    return {
      topicName: safeTopic,
      message: '',
      timedOut: false,
      capturedAt,
      error: stderr || `Failed to peek ${safeTopic} (exit ${result.exitCode})`,
    };
  }

  async getRosMessageSchema(containerId: string, messageType: string): Promise<TopicSchemaResult> {
    const { id } = await this.#resolveSimulationContainer(containerId);
    const safeType = assertRosMessageType(messageType);
    const distro = await this.#detectRosDistro(id);
    const target = { kind: 'podman', id } as const;

    const result = await this.#execRosBash(target, distro, 'ros2 interface show "$1"', [safeType]);
    const stdout = (result.stdout ?? '').trim();
    const stderr = (result.stderr ?? '').trim();

    if (result.exitCode === 0 && stdout) {
      return { type: safeType, schema: stdout };
    }

    return {
      type: safeType,
      schema: '',
      error: stderr || `Failed to load schema for ${safeType} (exit ${result.exitCode})`,
    };
  }

  async copyToClipboard(text: string): Promise<void> {
    if (typeof text !== 'string') {
      throw new Error('Clipboard text must be a string.');
    }
    // Peek payloads are capped; keep the same bound for clipboard RPC.
    if (text.length > PEEK_MAX_BYTES + 64) {
      throw new Error('Clipboard text exceeds the allowed size.');
    }
    await extensionApi.env.clipboard.writeText(text);
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
    const target = { kind: 'podman', id } as const;

    if (distro === 'jazzy') {
      return this.#sendNav2NavigationGoal(target, safeRobot, x, y, distro);
    }
    return this.#sendCmdVelNavigationGoal(target, safeRobot, x, y, distro);
  }

  async despawnRobot(containerId: string, robotName: string): Promise<void> {
    const { id, image } = await this.#resolveSimulationContainer(containerId);
    const distro = PhysicalAiApiImpl.#distroFromImage(image);
    await this.#teardownRobot({ kind: 'podman', id }, robotName, distro);
    this.nav2WarmStatus.delete(PhysicalAiApiImpl.#warmKey(id, robotName));
  }

  async getRobotWarmStatus(containerId: string, robotName: string): Promise<Nav2WarmStatus> {
    let id: string;
    try {
      ({ id } = await this.#resolveSimulationContainer(containerId));
    } catch {
      return 'idle';
    }
    const safeRobot = assertRobotName(robotName);
    return this.nav2WarmStatus.get(PhysicalAiApiImpl.#warmKey(id, safeRobot)) ?? 'idle';
  }

  async #sendNav2NavigationGoal(
    target: ExecTarget,
    robotName: string,
    x: number,
    y: number,
    distro: SupportedRosDistro,
  ): Promise<NavigationGoalResult> {
    const pose = await this.#getRobotPose(target, robotName, distro);
    const distance = Math.hypot(x - pose.x, y - pose.y);
    if (distance < 0.1) {
      return { status: 'reached', message: `Already at (${x}, ${y})` };
    }

    await this.#ensureNav2Running(target, robotName, pose, distro);

    const targetYaw = Math.atan2(y - pose.y, x - pose.x);
    const qw = Math.cos(targetYaw / 2);
    const qz = Math.sin(targetYaw / 2);

    const result = await this.#execRosBash(
      target,
      distro,
      'timeout "$1" ros2 action send_goal "/$2/navigate_to_pose" nav2_msgs/action/NavigateToPose ' +
        '"{pose: {header: {frame_id: map}, pose: {position: {x: $3, y: $4, z: 0.0}, ' +
        'orientation: {x: 0.0, y: 0.0, z: $5, w: $6}}}}" --feedback 2>&1',
      ['180', robotName, x.toFixed(4), y.toFixed(4), qz.toFixed(6), qw.toFixed(6)],
    );

    const output = `${result.stdout}\n${result.stderr}`;
    if (/Goal finished with status: SUCCEEDED|Succeed/i.test(output)) {
      return { status: 'reached', message: `Navigated to (${x}, ${y}) via Nav2` };
    }
    if (/Goal finished with status:/i.test(output)) {
      const statusLine = output.split('\n').find(line => /Goal finished with status:/i.test(line));
      return { status: 'failed', message: statusLine?.trim() ?? 'Nav2 goal failed' };
    }
    if (result.exitCode !== 0 && !/timeout/i.test(output)) {
      return { status: 'failed', message: result.stderr || 'Nav2 navigation failed' };
    }
    return { status: 'failed', message: 'Nav2 navigation timed out or did not succeed' };
  }

  async #ensureNav2Running(
    target: ExecTarget,
    robotName: string,
    pose: { x: number; y: number; yaw: number },
    distro: SupportedRosDistro,
  ): Promise<void> {
    // Do not trust action list alone — other sim containers on the default ROS domain
    // can expose /robot_N/navigate_to_pose before this container's Nav2 stack is up.
    if (await this.#hasMapBaseLinkTf(target, robotName, distro)) {
      return;
    }

    if (await this.#isNav2BringupRunning(target, robotName, distro)) {
      for (let attempt = 0; attempt < NAV2_TF_POLL_ATTEMPTS; attempt++) {
        await PhysicalAiApiImpl.#sleep(1000);
        if (await this.#hasMapBaseLinkTf(target, robotName, distro)) {
          return;
        }
      }
      throw new Error(`Nav2 bringup for "${robotName}" is running but map→base_link TF never became available.`);
    }

    await this.#execDetached(target, NAV2_ENTRYPOINT, [robotName], {
      PHYSICAL_AI_SPAWN_X: pose.x.toFixed(4),
      PHYSICAL_AI_SPAWN_Y: pose.y.toFixed(4),
    });

    for (let attempt = 0; attempt < NAV2_TF_POLL_ATTEMPTS; attempt++) {
      await PhysicalAiApiImpl.#sleep(1000);
      if (await this.#hasMapBaseLinkTf(target, robotName, distro)) {
        return;
      }
    }

    throw new Error(
      `Nav2 stack for "${robotName}" did not become ready (map→base_link TF missing). ` +
        'Stop other sim containers or use a fresh simulation before Go.',
    );
  }

  /**
   * Warm the Nav2 stack right after a spawn so the first Navigate click fires
   * instantly instead of paying the ~40–90 s software-render cold-start. Waits
   * for the robot to appear in the world (spawn is detached), then launches Nav2
   * via #ensureNav2Running. Fire-and-forget: never throws — a failure just means
   * the later Navigate click pays the cold-start as before. Jazzy (Nav2) only.
   *
   * `warmKey` scopes the status entry (see #warmKey) so the UI can poll it.
   */
  async #prewarmNav2(
    warmKey: string,
    target: ExecTarget,
    robotName: string,
    pose: { x: number; y: number; yaw: number },
    distro: SupportedRosDistro,
  ): Promise<void> {
    this.nav2WarmStatus.set(warmKey, 'warming');
    try {
      let appeared = false;
      for (let attempt = 0; attempt < 30 && !appeared; attempt++) {
        await PhysicalAiApiImpl.#sleep(1000);
        try {
          await this.#getRobotPose(target, robotName, distro);
          appeared = true;
        } catch {
          // Robot not in the world yet — keep polling.
        }
      }
      if (!appeared) {
        this.nav2WarmStatus.set(warmKey, 'failed');
        return;
      }
      await this.#ensureNav2Running(target, robotName, pose, distro);
      this.nav2WarmStatus.set(warmKey, 'ready');
    } catch (err) {
      this.nav2WarmStatus.set(warmKey, 'failed');
      console.error(`[physical-ai] Nav2 pre-warm for "${robotName}" failed (non-fatal):`, err);
    }
  }

  /**
   * Stable per-robot key for the Nav2 warm-status map. The scope must be derivable
   * from what the UI holds so the query methods hit the same key the spawn set:
   * the resolved container id (local) or `${namespace}/${name}` (OpenShift).
   */
  static #warmKey(scope: string, robotName: string): string {
    return `${scope} ${robotName}`;
  }

  async #hasMapBaseLinkTf(target: ExecTarget, robotName: string, distro: SupportedRosDistro): Promise<boolean> {
    const tf = await this.#execRosBash(
      target,
      distro,
      'timeout 5 ros2 run tf2_ros tf2_echo map base_link --ros-args -p use_sim_time:=true ' +
        '-r /tf:=/$1/tf -r /tf_static:=/$1/tf_static 2>&1',
      [robotName],
    );
    return /Translation:/i.test(tf.stdout);
  }

  async #isNav2BringupRunning(target: ExecTarget, robotName: string, distro: SupportedRosDistro): Promise<boolean> {
    const result = await this.#execRosBash(
      target,
      distro,
      'pgrep -f "bringup_launch.py.*namespace:=$1" >/dev/null && echo running || true',
      [robotName],
    );
    return result.stdout.includes('running');
  }

  async #sendCmdVelNavigationGoal(
    target: ExecTarget,
    robotName: string,
    x: number,
    y: number,
    distro: SupportedRosDistro,
  ): Promise<NavigationGoalResult> {
    const pose = await this.#getRobotPose(target, robotName, distro);
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
        target,
        distro,
        'timeout "$1" ros2 topic pub --rate 10 "/$2/cmd_vel" geometry_msgs/msg/Twist "{angular: {z: $3}}" || true',
        [String(turnDuration), robotName, turnSpeed.toFixed(2)],
      );
      await this.#execRosBash(target, distro, 'ros2 topic pub --once "/$1/cmd_vel" geometry_msgs/msg/Twist "{}"', [
        robotName,
      ]);
    }

    const speed = 0.2;
    const durationSec = Math.min(Math.ceil(distance / speed), 30);
    const result = await this.#execRosBash(
      target,
      distro,
      'timeout "$1" ros2 topic pub --rate 10 "/$2/cmd_vel" geometry_msgs/msg/Twist "{linear: {x: $3}}" || true',
      [String(durationSec), robotName, String(speed)],
    );

    await this.#execRosBash(target, distro, 'ros2 topic pub --once "/$1/cmd_vel" geometry_msgs/msg/Twist "{}"', [
      robotName,
    ]);

    if (result.exitCode !== 0 && !/timeout/i.test(result.stderr)) {
      return { status: 'failed', message: result.stderr || 'Drive command failed' };
    }

    const finalPose = await this.#getRobotPose(target, robotName, distro);
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
    target: ExecTarget,
    robotName: string,
    distro: SupportedRosDistro,
  ): Promise<{ x: number; y: number; yaw: number }> {
    const result = await this.#execRosBash(target, distro, 'gz model -m "$1" -p 2>/dev/null', [robotName]);
    const nums = result.stdout.match(/-?\d+\.\d+/g)?.map(Number);
    if (nums && nums.length >= 6 && nums.every(n => !isNaN(n))) {
      return { x: nums[0], y: nums[1], yaw: nums[5] };
    }
    throw new Error(`Could not read pose for robot "${robotName}". Is it spawned in Gazebo?`);
  }

  /**
   * Tear down a spawned robot: kill its namespaced ROS processes (the spawn
   * launch, `robot_state_publisher`, the Nav2 bringup tree, and both entrypoint
   * wrappers) and remove its model from the Gazebo world. Best-effort — a robot
   * may be partially up (spawned, no Nav2) or already gone.
   */
  async #teardownRobot(target: ExecTarget, robotName: string, distro: SupportedRosDistro): Promise<void> {
    const safeRobot = assertRobotName(robotName);
    // Every ROS process for a robot carries its name in a bounded token: the
    // spawn/Nav2 launches (`namespace:=<R>`, `robot_name:=<R>`), the namespaced
    // nodes (`__ns:=/<R>`), or the entrypoint wrappers (positional arg). Match on
    // a right boundary so tearing down `robot_1` never touches `robot_10`. Robot
    // names are [A-Za-z0-9_-], so there are no ERE metacharacters to escape. The
    // pattern intentionally omits a bare `/<R>/` branch so it can't match the
    // pkill shell's own argv (which carries this pattern); the transient
    // initialpose publisher is a child of the Nav2 wrapper and dies with it.
    const pattern = `(namespace:=|robot_name:=|__ns:=/|entrypoint-(spawn-robot|nav2)\\.sh )${safeRobot}([ /:]|$)`;
    // SIGTERM first (the entrypoint scripts trap it and reap their children),
    // then SIGKILL any straggler. pkill exits non-zero when nothing matches —
    // swallow it so a partially-up or already-gone robot isn't an error.
    await this.#execAttached(target, [
      'bash',
      '-c',
      'pkill -TERM -f "$1" || true; sleep 2; pkill -KILL -f "$1" || true',
      '_',
      pattern,
    ]);

    // Remove the model from the world so the GUI drops it too. Discover the world
    // name from the live topic list so a custom WORLD_NAME still works.
    await this.#execRosBash(
      target,
      distro,
      'world=$(gz topic -l 2>/dev/null | sed -n "s#^/world/\\([^/]*\\)/.*#\\1#p" | head -n1); ' +
        'if [ -n "$world" ]; then ' +
        'gz service -s "/world/$world/remove" --reqtype gz.msgs.Entity --reptype gz.msgs.Boolean ' +
        '--timeout 3000 --req "name: \\"$1\\", type: MODEL" >/dev/null 2>&1 || true; fi',
      [safeRobot],
    );
  }

  /**
   * Run a shell snippet after sourcing ROS setup. Dynamic values must be passed
   * as `args` and referenced as `$1`, `$2`, … inside `script` — never concatenated.
   */
  async #execRosBash(
    target: ExecTarget,
    distro: SupportedRosDistro,
    script: string,
    args: string[] = [],
  ): Promise<ExecResult> {
    const safeDistro = assertRosDistro(distro);
    const setup = `/opt/ros/${safeDistro}/setup.bash`;
    // `oc exec` lands in HOME=/ (not writable), so ROS can't create its log dir
    // ('//.ros/log') and every rclcpp-based command aborts with exit 250. Point
    // HOME/ROS_HOME at a writable tmp dir for the cluster path. Local podman
    // containers already have a writable HOME, so leave that path untouched.
    const prefix =
      target.kind === 'oc'
        ? 'export HOME=/tmp/ros-home ROS_HOME=/tmp/ros-home ROS_LOG_DIR=/tmp/ros-home/log && mkdir -p "$ROS_LOG_DIR" && '
        : '';
    return this.#execAttached(target, ['bash', '-c', `${prefix}source "${setup}" && ${script}`, '_', ...args]);
  }

  async #assertSimulationContainer(containerId: string): Promise<string> {
    const { id } = await this.#resolveSimulationContainer(containerId);
    return id;
  }

  async #execAttached(target: ExecTarget, command: string[]): Promise<ExecResult> {
    const [bin, argv] = PhysicalAiApiImpl.#attachedArgv(target, command);
    try {
      const result = await extensionApi.process.exec(bin, argv);
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

  /** [binary, argv] to run `command` attached in the target (podman/oc exec). */
  static #attachedArgv(target: ExecTarget, command: string[]): [string, string[]] {
    if (target.kind === 'podman') {
      return ['podman', ['exec', target.id, ...command]];
    }
    return ['oc', ['exec', '-n', target.namespace, target.pod, '--', ...command]];
  }

  async #execDetached(
    target: ExecTarget,
    entrypoint: string,
    args: string[],
    env: Record<string, string> = {},
  ): Promise<void> {
    if (target.kind === 'podman') {
      const id = await this.#assertSimulationContainer(target.id);
      const argv: string[] = ['exec', '-d'];
      for (const [key, value] of Object.entries(env)) {
        argv.push('-e', `${key}=${value}`);
      }
      argv.push(id, entrypoint, ...args);
      await extensionApi.process.exec('podman', argv);
      return;
    }
    // `oc exec` has no detached flag; background the process inside the pod with
    // nohup so it survives the exec session without touching the pod's PID 1.
    const envPrefix = Object.entries(env)
      .map(([key, value]) => `${key}=${shSingleQuote(value)} `)
      .join('');
    const remoteCmd = [entrypoint, ...args].map(shSingleQuote).join(' ');
    const logName = entrypoint.replace(/[^a-zA-Z0-9._-]/g, '_');
    const remote = `${envPrefix}nohup ${remoteCmd} >"/tmp/pai-${logName}.log" 2>&1 &`;
    await extensionApi.process.exec('oc', ['exec', '-n', target.namespace, target.pod, '--', 'bash', '-c', remote]);
  }

  static #sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async #detectRosDistro(containerId: string): Promise<SupportedRosDistro> {
    const { image } = await this.#resolveSimulationContainer(containerId);
    return PhysicalAiApiImpl.#distroFromImage(image);
  }

  static #distroFromImage(image: string): SupportedRosDistro {
    if (image.includes('humble')) return 'humble';
    if (image.includes('jazzy')) return 'jazzy';
    throw new Error(`Unsupported ROS distro for image "${image}". Tag must include "humble" or "jazzy".`);
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
            const msg = firstNonEmpty(parsed.status, parsed.stream, parsed.error);
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
    )
      .then(() => {
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
      })
      .catch((err: unknown) => {
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

  // --- OpenShift deployment (APPENG-5777) ---

  async getOpenShiftContext(): Promise<OpenShiftContext | undefined> {
    try {
      const uri = extensionApi.kubernetes.getKubeconfig();
      const kubeconfigPath = uri.fsPath;
      const content = await readFile(kubeconfigPath, 'utf-8');
      // `current-context:` is a top-level scalar — read it without a YAML parser.
      const match = content.match(/^current-context:\s*["']?([^"'\s]+)["']?\s*$/m);
      if (!match) return undefined;
      return { context: match[1], kubeconfigPath };
    } catch {
      return undefined;
    }
  }

  async generateOpenShiftManifests(config: OpenShiftDeployConfig): Promise<{ yaml: string }> {
    const manifests = buildOpenShiftManifests(config);
    return { yaml: manifestsToYaml(manifests) };
  }

  async deployToOpenShift(config: OpenShiftDeployConfig): Promise<OpenShiftDeployResult> {
    // Validates name/namespace/image and builds the objects.
    const manifests = buildOpenShiftManifests(config);
    const ctx = await this.getOpenShiftContext();
    if (!ctx) {
      throw new Error('No current Kubernetes/OpenShift context found. Log in first (e.g. `oc login`).');
    }

    await extensionApi.kubernetes.createResources(ctx.context, manifests);

    const routeUrl = await this.#readRouteUrl(config.namespace, config.name);
    const applied = manifests.map(m => String(m.kind));
    return {
      name: config.name,
      namespace: config.namespace,
      routeUrl,
      applied,
      message: routeUrl
        ? `Deployed to ${config.namespace}. Route: ${routeUrl}`
        : `Deployed to ${config.namespace}. Route not admitted yet — refresh in a moment or check the OpenShift console.`,
    };
  }

  async listOpenShiftDeployments(namespace: string): Promise<OpenShiftWorkload[]> {
    const ns = assertNamespace(namespace);
    let stdout: string;
    try {
      const res = await extensionApi.process.exec('oc', [
        'get',
        'deployment',
        '-n',
        ns,
        '-l',
        `${PART_OF_LABEL}=${PART_OF_VALUE}`,
        '-o',
        'json',
      ]);
      stdout = res.stdout ?? '';
    } catch (err: unknown) {
      throw new Error(this.#ocErrorMessage(err, `list deployments in ${ns}`));
    }

    let parsed: { items?: unknown[] };
    try {
      parsed = JSON.parse(stdout || '{"items":[]}');
    } catch {
      return [];
    }
    const items = Array.isArray(parsed.items) ? parsed.items : [];

    const workloads: OpenShiftWorkload[] = [];
    for (const raw of items) {
      const d = raw as {
        metadata?: { name?: string };
        spec?: { replicas?: number; template?: { spec?: { containers?: Array<{ image?: string }> } } };
        status?: { readyReplicas?: number };
      };
      const name = d.metadata?.name;
      if (!name) continue;
      const replicas = d.spec?.replicas ?? 0;
      const readyReplicas = d.status?.readyReplicas ?? 0;
      const image = d.spec?.template?.spec?.containers?.[0]?.image;
      const routeUrl = await this.#readRouteUrl(ns, name);
      workloads.push({
        name,
        namespace: ns,
        replicas,
        readyReplicas,
        ready: replicas > 0 && readyReplicas >= replicas,
        image,
        routeUrl,
      });
    }
    return workloads;
  }

  async deleteOpenShiftDeployment(namespace: string, name: string): Promise<void> {
    const ns = assertNamespace(namespace);
    const safeName = assertK8sName(name, 'name');
    try {
      await extensionApi.process.exec('oc', [
        'delete',
        'deployment,service,route',
        safeName,
        '-n',
        ns,
        '--ignore-not-found',
      ]);
    } catch (err: unknown) {
      throw new Error(this.#ocErrorMessage(err, `delete ${safeName} in ${ns}`));
    }
  }

  async spawnRobotInOpenShift(
    namespace: string,
    name: string,
    robotName: string,
    x: string,
    y: string,
    yaw: string,
  ): Promise<void> {
    const ns = assertNamespace(namespace);
    const safeName = assertK8sName(name, 'name');
    // Reuse the same argv validation as the local spawn path.
    const [, safeRobot, safeX, safeY, safeYaw] = assertSpawnExecCommand([SPAWN_ENTRYPOINT, robotName, x, y, yaw]);
    const pod = await this.#resolveOpenShiftPod(ns, safeName);
    const target = { kind: 'oc', pod, namespace: ns } as const;
    await this.#execDetached(target, SPAWN_ENTRYPOINT, [safeRobot, safeX, safeY, safeYaw]);

    // Warm Nav2 in the background so the first Navigate click is instant (Jazzy only).
    // The spawn already succeeded — never let pre-warm setup surface as an error.
    try {
      const image = await this.#openShiftDeploymentImage(ns, safeName);
      if (image.includes('jazzy')) {
        const pose = { x: Number(safeX), y: Number(safeY), yaw: Number(safeYaw) };
        const warmKey = PhysicalAiApiImpl.#warmKey(`${ns}/${safeName}`, safeRobot);
        void this.#prewarmNav2(warmKey, target, safeRobot, pose, 'jazzy');
      }
    } catch (err) {
      console.error('[physical-ai] Nav2 pre-warm setup failed (non-fatal):', err);
    }
  }

  async sendOpenShiftNavigationGoal(
    namespace: string,
    name: string,
    robotName: string,
    x: number,
    y: number,
  ): Promise<NavigationGoalResult> {
    const ns = assertNamespace(namespace);
    const safeName = assertK8sName(name, 'name');
    const safeRobot = assertRobotName(robotName);
    const image = await this.#openShiftDeploymentImage(ns, safeName);
    const distro = PhysicalAiApiImpl.#distroFromImage(image);
    const pod = await this.#resolveOpenShiftPod(ns, safeName);
    const target = { kind: 'oc', pod, namespace: ns } as const;

    if (distro === 'jazzy') {
      return this.#sendNav2NavigationGoal(target, safeRobot, x, y, distro);
    }
    return this.#sendCmdVelNavigationGoal(target, safeRobot, x, y, distro);
  }

  async despawnRobotInOpenShift(namespace: string, name: string, robotName: string): Promise<void> {
    const ns = assertNamespace(namespace);
    const safeName = assertK8sName(name, 'name');
    const safeRobot = assertRobotName(robotName);
    const image = await this.#openShiftDeploymentImage(ns, safeName);
    const distro = PhysicalAiApiImpl.#distroFromImage(image);
    const pod = await this.#resolveOpenShiftPod(ns, safeName);
    await this.#teardownRobot({ kind: 'oc', pod, namespace: ns }, safeRobot, distro);
    this.nav2WarmStatus.delete(PhysicalAiApiImpl.#warmKey(`${ns}/${safeName}`, safeRobot));
  }

  async getRobotWarmStatusInOpenShift(namespace: string, name: string, robotName: string): Promise<Nav2WarmStatus> {
    const ns = assertNamespace(namespace);
    const safeName = assertK8sName(name, 'name');
    const safeRobot = assertRobotName(robotName);
    return this.nav2WarmStatus.get(PhysicalAiApiImpl.#warmKey(`${ns}/${safeName}`, safeRobot)) ?? 'idle';
  }

  /** Name of a Running pod for the deployment (selected by the `app=<name>` label). */
  async #resolveOpenShiftPod(namespace: string, name: string): Promise<string> {
    let stdout: string;
    try {
      const res = await extensionApi.process.exec('oc', [
        'get',
        'pods',
        '-n',
        namespace,
        '-l',
        `app=${name}`,
        '--field-selector=status.phase=Running',
        '-o',
        'jsonpath={.items[0].metadata.name}',
      ]);
      stdout = res.stdout?.trim() ?? '';
    } catch (err: unknown) {
      throw new Error(this.#ocErrorMessage(err, `find a running pod for ${name} in ${namespace}`));
    }
    if (!stdout) {
      throw new Error(
        `No running pod found for "${name}" in ${namespace}. Deploy it first and wait until it is ready.`,
      );
    }
    return stdout;
  }

  /** The deployment's first container image (used to detect the ROS distro). */
  async #openShiftDeploymentImage(namespace: string, name: string): Promise<string> {
    let stdout: string;
    try {
      const res = await extensionApi.process.exec('oc', [
        'get',
        'deployment',
        name,
        '-n',
        namespace,
        '-o',
        'jsonpath={.spec.template.spec.containers[0].image}',
      ]);
      stdout = res.stdout?.trim() ?? '';
    } catch (err: unknown) {
      throw new Error(this.#ocErrorMessage(err, `read the image for ${name} in ${namespace}`));
    }
    if (!stdout) {
      throw new Error(`Could not read the image for deployment "${name}" in ${namespace}.`);
    }
    return stdout;
  }

  /** Best-effort Route host lookup; returns undefined if not admitted or oc unavailable. */
  async #readRouteUrl(namespace: string, name: string): Promise<string | undefined> {
    try {
      const res = await extensionApi.process.exec('oc', [
        'get',
        'route',
        name,
        '-n',
        namespace,
        '-o',
        'jsonpath={.spec.host}',
      ]);
      const host = res.stdout?.trim();
      return host ? `https://${host}` : undefined;
    } catch {
      return undefined;
    }
  }

  #ocErrorMessage(err: unknown, action: string): string {
    const e = err as { stderr?: string; message?: string; code?: string };
    const detail = firstNonEmpty(e.stderr?.trim(), e.message, String(err));
    if (/ENOENT|not found|command not found/i.test(detail) && /oc\b/.test(detail + (e.code ?? ''))) {
      return `Could not run "oc" to ${action}. Ensure the OpenShift CLI is installed and on PATH.`;
    }
    return `Failed to ${action}: ${detail}`;
  }
}
