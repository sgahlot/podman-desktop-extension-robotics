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
  HUMMINGBIRD_NGINX_CONTAINER_NAME,
} from '/@shared/src/openshift/manifests';
import { readFile, writeFile, mkdtemp, mkdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { DEFAULT_CURATED_ALLOWLIST } from '/@shared/src/types/CatalogCurated';
import type { BuildHistoryEntry, SbomFormat } from '/@shared/src/types/BuildHistory';
import {
  BUILD_HISTORY_LIMIT_DEFAULT,
  assertBuildHistoryLimit,
  SBOM_FORMAT_DEFAULT,
  parseSbomPackageCount,
} from '/@shared/src/types/BuildHistory';
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
} from '/@shared/src/ros/topicPeek';
import {
  TF_FRAME_PAIRS,
  parseTfEchoOutput,
  parseOccupancyGridEcho,
  parseLaserScanEcho,
} from '/@shared/src/ros/robotDiagnostics';
import type {
  TfTreeResult,
  CostmapSummaryResult,
  OccupancyGridSummary,
  LaserScanSummary,
} from '/@shared/src/types/RobotDiagnostics';
import { parseSpawnedRobotNames } from '/@shared/src/ros/robotNodeList';
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
 * Fixed per-pair timeout for the curated TF chain (getTfTreeStatus), NOT the user-configurable
 * peek timeout (topicPeekTimeoutSeconds) — TF_FRAME_PAIRS.length pairs run sequentially per
 * refresh (see #tfTreeStatusFor). Matches #hasMapBaseLinkTf's existing 5s precedent exactly:
 * a shorter window (previously 3s) produced false "missing" reports for static-only pairs
 * (e.g. base_link->base_scan, published once via /tf_static with transient-local QoS) when
 * DDS discovery between the fresh tf2_echo listener and robot_state_publisher took longer
 * than the window under load — verified live, the transform was fine when retried in
 * isolation. A false "missing" is worse than a slower refresh for a diagnostics tool.
 */
const TF_DIAGNOSTIC_TIMEOUT_SEC = 5;

/**
 * Settle after clearing the Nav2 costmaps on a cold start, so they refill from
 * live (good-TF) scans before navigation plans on them. The local costmap updates
 * at 5 Hz and the global at 1 Hz, so ~2 s covers at least one good global refill.
 * Only paid once per fresh Nav2 bringup (the warm path skips the clear entirely).
 */
const NAV2_COSTMAP_REFILL_MS = 2000;

/** Build history JSON file name, written under ExtensionContext.storagePath. */
const BUILD_HISTORY_FILE_NAME = 'build-history.json';

/**
 * Max clipboard payload size. Deliberately much larger than PEEK_MAX_BYTES (64KB, tuned
 * for a single ROS topic message) — this RPC is also used to copy a full SBOM. A real
 * ~2,600-package SPDX-JSON SBOM (verbose externalRefs/CPE entries per package) already
 * exceeded an earlier 8MB guess, so this is set generously rather than re-guessed per
 * image size — SBOMs only grow as an image gains packages.
 */
const CLIPBOARD_MAX_BYTES = 32 * 1024 * 1024;

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
  | { readonly kind: 'oc'; readonly pod: string; readonly namespace: string; readonly context?: string };

/** Single-quote a value for safe interpolation into a remote `bash -c` string. */
function shSingleQuote(value: string): string {
  const escaped = value.replace(/'/g, `'\\''`);
  return `'${escaped}'`;
}

/**
 * Extracts the raw text block for a top-level kubeconfig list key (e.g. `contexts` or
 * `clusters`), without a YAML parser (the project has no YAML dependency). The block
 * runs until the next top-level key (a line starting flush-left with a letter, e.g.
 * `current-context:` / `users:`). Returns undefined when the list key isn't present.
 */
function kubeconfigListBlock(kubeconfig: string, listKey: string): string | undefined {
  const start = kubeconfig.search(new RegExp(`^${listKey}:[ \\t]*$`, 'm'));
  if (start < 0) return undefined;
  const body = kubeconfig.slice(start).replace(new RegExp(`^${listKey}:[ \\t]*\\n?`), '');
  const nextKey = body.match(/^[A-Za-z]/m);
  return nextKey?.index ? body.slice(0, nextKey.index) : body;
}

/** Splits a kubeconfig list block into per-entry raw text chunks (see kubeconfigListBlock). */
function kubeconfigListEntries(block: string): string[] {
  // Each list entry begins with a `- ` marker (possibly indented under the list key).
  return block.split(/^[ \t]*-[ \t]+/m).filter(entry => entry.trim());
}

/**
 * Locates the kubeconfig entry (as raw text) whose `name:` matches `entryName` within a
 * top-level list keyed by `listKey` (e.g. `contexts` or `clusters`). Tolerates field
 * order within an entry and both flush and indented list markers; returns undefined
 * when the list or a matching entry isn't found.
 */
function kubeconfigFindEntry(kubeconfig: string, listKey: string, entryName: string): string | undefined {
  const block = kubeconfigListBlock(kubeconfig, listKey);
  if (!block) return undefined;
  for (const entry of kubeconfigListEntries(block)) {
    const nameMatch = entry.match(/(?:^|\n)[ \t]*name:[ \t]*["']?([^"'\s]+)["']?[ \t]*$/m);
    if (nameMatch?.[1] === entryName) return entry;
  }
  return undefined;
}

/** Lists every entry `name:` under a top-level kubeconfig list key (see kubeconfigListBlock). */
function kubeconfigListEntryNames(kubeconfig: string, listKey: string): string[] {
  const block = kubeconfigListBlock(kubeconfig, listKey);
  if (!block) return [];
  const names: string[] = [];
  for (const entry of kubeconfigListEntries(block)) {
    const nameMatch = entry.match(/(?:^|\n)[ \t]*name:[ \t]*["']?([^"'\s]+)["']?[ \t]*$/m);
    if (nameMatch?.[1]) names.push(nameMatch[1]);
  }
  return names;
}

/** Reads a scalar `field:` value out of a kubeconfig entry's raw text (see kubeconfigFindEntry). */
function kubeconfigFieldValue(entry: string, field: string): string | undefined {
  const match = entry.match(new RegExp(`(?:^|\\n)[ \\t]*${field}:[ \\t]*["']?([^"'\\s]+)["']?[ \\t]*$`, 'm'));
  return match ? match[1] : undefined;
}

/**
 * Best-effort read of the namespace bound to a named context in a kubeconfig (matching
 * getOpenShiftContext's `current-context` grep). Returns undefined when the context or its
 * namespace isn't present.
 */
function kubeconfigContextNamespace(kubeconfig: string, contextName: string): string | undefined {
  const entry = kubeconfigFindEntry(kubeconfig, 'contexts', contextName);
  return entry ? kubeconfigFieldValue(entry, 'namespace') : undefined;
}

/**
 * Best-effort read of the API server URL for the cluster bound to a named context in a
 * kubeconfig. Resolves the context's `cluster:` reference, then looks up that cluster's
 * `cluster.server` in the top-level `clusters:` list.
 */
function kubeconfigClusterServer(kubeconfig: string, contextName: string): string | undefined {
  const contextEntry = kubeconfigFindEntry(kubeconfig, 'contexts', contextName);
  const clusterName = contextEntry ? kubeconfigFieldValue(contextEntry, 'cluster') : undefined;
  if (!clusterName) return undefined;
  const clusterEntry = kubeconfigFindEntry(kubeconfig, 'clusters', clusterName);
  return clusterEntry ? kubeconfigFieldValue(clusterEntry, 'server') : undefined;
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
   * Robots with a pending one-time cold-start costmap clear (keyed by #navTargetKey).
   * The mark is added when *we* launch a fresh Nav2 bringup (#ensureNav2Running cold
   * path) and consumed by the first goal, which clears the costmaps just before
   * planning (#sendNav2NavigationGoal). A genuinely warm sim we never brought up is
   * never marked, so its first goal pays no clear. Not pre-warm — the clock hasn't
   * settled that early, so the refill re-accumulates the phantoms.
   */
  private nav2ClearPending = new Set<string>();

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
    // Fail fast if there's no running Podman, before resolving the asset context dir.
    this.#getRunningPodmanConnection();
    const contextDir = extensionApi.Uri.joinPath(this.extensionContext.extensionUri, 'assets', assetDir).fsPath;
    this.#runContainerBuild(tag, contextDir, 'Containerfile', buildargs, platform);
  }

  /**
   * Core build machinery shared by bundled asset-dir builds (#startImageBuild) and the
   * layer-composition wizard's in-memory Containerfile build (buildFromContainerfile).
   * The caller owns the concurrency guard (#assertCanStartOp) before invoking this.
   * `onSettled` runs once the buildImage promise settles — used to remove a throwaway
   * build context after the build finishes (success, failure, or cancel).
   */
  #runContainerBuild(
    tag: string,
    contextDir: string,
    containerFileName: string,
    buildargs?: { [key: string]: string },
    platform?: string,
    onSettled?: () => void,
    generateSbom?: boolean,
    sbomFormat: SbomFormat = SBOM_FORMAT_DEFAULT,
  ): void {
    const podmanConnection = this.#getRunningPodmanConnection();

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
      startedAt: Date.now(),
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
              progress.finishedAt = Date.now();
              progress.error = 'Build cancelled';
              appendProgressLog(progress.logs, 'Build cancelled by user');
            } else {
              progress.status = 'Complete';
              progress.done = true;
              progress.finishedAt = Date.now();
              if (progress.totalSteps) {
                progress.currentStep = progress.totalSteps;
              }
              appendProgressLog(progress.logs, data?.trim() ? data.trim() : 'Build finished');
              void this.#recordBuildHistory(tag, platform, progress, generateSbom, sbomFormat);
            }
            this.buildAbortControllers.delete(tag);
            this.#scheduleProgressCleanup(this.activeBuilds, tag, 'build');
          }
        },
        {
          containerFile: containerFileName,
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
            progress.finishedAt = Date.now();
            progress.error = 'Build cancelled';
            appendProgressLog(progress.logs, 'Build cancelled by user');
          } else {
            progress.status = 'Complete';
            progress.done = true;
            progress.finishedAt = Date.now();
            void this.#recordBuildHistory(tag, platform, progress, generateSbom, sbomFormat);
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
            progress.finishedAt = Date.now();
            progress.error = 'Build cancelled';
            appendProgressLog(progress.logs, 'Build cancelled by user');
          } else {
            progress.status = 'Failed';
            progress.done = true;
            progress.finishedAt = Date.now();
            progress.error = err instanceof Error ? err.message : String(err);
            void this.#recordBuildHistory(tag, platform, progress, generateSbom, sbomFormat);
          }
        }
        this.#scheduleProgressCleanup(this.activeBuilds, tag, 'build');
      })
      .finally(() => {
        try {
          onSettled?.();
        } catch {
          // best-effort cleanup of a throwaway build context
        }
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
    progress.finishedAt = Date.now();
    progress.status = 'Cancelled';
    progress.error = 'Build cancelled';
    appendProgressLog(progress.logs, 'Cancel requested — build aborted');

    if (abortController) {
      this.buildAbortControllers.delete(tag);
      abortController.abort();
    }

    this.#scheduleProgressCleanup(this.activeBuilds, tag, 'build');
  }

  /**
   * Persist a build-history entry once a build has definitively settled to Complete or
   * Failed (never called for a Cancelled build — see #runContainerBuild's call sites).
   * Fire-and-forget from those call sites: never throws, and must not block the
   * build-progress finalization/cleanup it's invoked alongside.
   */
  async #recordBuildHistory(
    tag: string,
    platform: string | undefined,
    progress: BuildProgress,
    generateSbom: boolean | undefined,
    sbomFormat: SbomFormat,
  ): Promise<void> {
    const success = progress.status === 'Complete' && !progress.error;
    const startedAt = progress.startedAt ?? Date.now();
    const finishedAt = progress.finishedAt ?? Date.now();

    try {
      // Write the build's own outcome immediately — do NOT wait on SBOM generation first.
      // syft scanning a large image can take tens of seconds even with file catalogers
      // disabled (still has to walk every file), which previously delayed the entire
      // Recent Builds entry (tag/duration/success, not just the SBOM) until syft finished,
      // even though the build itself had already succeeded.
      const entry: BuildHistoryEntry = {
        tag,
        arch: PhysicalAiApiImpl.#archFromPlatform(platform),
        startedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
        success,
        ...(success ? {} : { errorMessage: progress.error ?? 'Build failed' }),
      };

      const limit = await this.getBuildHistoryLimit();
      const history = await this.#readBuildHistory();
      history.unshift(entry);
      await this.#writeBuildHistory(history.slice(0, limit));
    } catch (err) {
      console.error(`[physical-ai] Failed to record build history for "${tag}" (non-fatal):`, err);
      return;
    }

    // Opt-in only, and only after a successful build — a failed build has no image to
    // scan. Best-effort: an SBOM failure must never fail the build or block history.
    if (!success || !generateSbom) return;
    try {
      const sbom = await this.#generateSbom(tag, sbomFormat);
      if (!sbom) return;
      const history = await this.#readBuildHistory();
      const idx = history.findIndex(e => e.tag === tag && e.startedAt === startedAt);
      if (idx === -1) return; // entry aged out of the retained limit while the SBOM ran
      const sbomPackageCount = parseSbomPackageCount(sbom, sbomFormat);
      history[idx] = { ...history[idx], sbom, sbomFormat, sbomPackageCount };
      await this.#writeBuildHistory(history);
    } catch (err) {
      console.error(`[physical-ai] Failed to attach SBOM to build history for "${tag}" (non-fatal):`, err);
    }
  }

  /**
   * Run syft against the freshly built image's own filesystem (the binary was just baked
   * in via COPY --from when the user selected the Hummingbird `syft` tool). Best-effort:
   * any failure (syft missing, non-zero exit, etc.) is logged and the SBOM is left absent
   * for this history entry — it must never fail the build.
   *
   * `--select-catalogers -file` disables syft's file-integrity catalogers (file-content/
   * -digest/-executable/-metadata), which by default emit one component/package PER FILE
   * in the image (a SHA-1/SHA-256 hash manifest) — unrelated to what's actually installed.
   * Confirmed empirically on a real 2588-package robotics image: this was 115,498 of
   * 118,086 CycloneDX components (97.8%), taking the SBOM from 40.5MB down to 6.9MB with
   * zero loss of real package/library data — our use case is "what's installed," not a
   * file-integrity manifest.
   */
  async #generateSbom(tag: string, format: SbomFormat): Promise<string | undefined> {
    try {
      const result = await extensionApi.process.exec('podman', [
        'run',
        '--rm',
        tag,
        'syft',
        'dir:/',
        '-o',
        format,
        '--select-catalogers',
        '-file',
      ]);
      const sbom = result.stdout?.trim();
      return sbom || undefined;
    } catch (err) {
      console.error(`[physical-ai] SBOM generation for "${tag}" failed (non-fatal):`, err);
      return undefined;
    }
  }

  /** Resolve a build-history arch label from the buildImage `platform` option. */
  static #archFromPlatform(platform: string | undefined): 'amd64' | 'arm64' {
    if (platform === 'linux/amd64') return 'amd64';
    if (platform === 'linux/arm64' || platform === 'linux/armv64') return 'arm64';
    return process.arch === 'arm64' ? 'arm64' : 'amd64';
  }

  #buildHistoryFilePath(): string {
    return pathJoin(this.extensionContext.storagePath, BUILD_HISTORY_FILE_NAME);
  }

  /** Reads the build history file, defensively returning [] on any missing/corrupt file. */
  async #readBuildHistory(): Promise<BuildHistoryEntry[]> {
    try {
      const content = await readFile(this.#buildHistoryFilePath(), 'utf8');
      const parsed: unknown = JSON.parse(content);
      return Array.isArray(parsed) ? (parsed as BuildHistoryEntry[]) : [];
    } catch {
      return [];
    }
  }

  /**
   * Write via a temp file + atomic rename, not a direct write to the live path. A direct
   * write truncates-then-writes in place, so the frontend's 3s history poll (a concurrent
   * reader, not synchronized with this write at all) can land mid-write and read a
   * truncated/invalid file — caught by #readBuildHistory's try/catch, which then returns
   * [] for that one poll tick, flashing "No builds recorded yet" for ~3s (observed live).
   * rename() is atomic on POSIX filesystems: a concurrent read always sees either the
   * complete old file or the complete new one, never a partial write.
   */
  async #writeBuildHistory(history: BuildHistoryEntry[]): Promise<void> {
    await mkdir(this.extensionContext.storagePath, { recursive: true });
    const finalPath = this.#buildHistoryFilePath();
    const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmpPath, JSON.stringify(history), 'utf8');
    await rename(tmpPath, finalPath);
  }

  /** Recent build results (newest first), persisted across restarts. See BuildHistoryEntry.
   * Strips the (potentially tens-of-MB) `sbom` text — this is polled every few seconds by
   * the UI, so the payload must stay small regardless of SBOM size (APPENG-6265). Use
   * getBuildHistorySbom to fetch a specific entry's SBOM on demand. */
  async getBuildHistory(): Promise<BuildHistoryEntry[]> {
    const history = await this.#readBuildHistory();
    return history.map(entry => {
      const stripped: BuildHistoryEntry = { ...entry };
      // Legacy entries recorded before `sbomFormat` existed are always SPDX — backfill it
      // here so the stripped list's presence-of-format check (the frontend's only signal
      // that an SBOM exists, now that `sbom` itself is never sent) still finds them.
      if (stripped.sbom && !stripped.sbomFormat) stripped.sbomFormat = 'spdx-json';
      delete stripped.sbom;
      return stripped;
    });
  }

  /** Full SBOM text for one entry, fetched on demand (see getBuildHistory). */
  async getBuildHistorySbom(tag: string, startedAt: number): Promise<string | undefined> {
    const history = await this.#readBuildHistory();
    return history.find(e => e.tag === tag && e.startedAt === startedAt)?.sbom;
  }

  async getBuildHistoryLimit(): Promise<number> {
    const config = extensionApi.configuration.getConfiguration('physical-ai');
    const raw = config.get<number>('buildHistoryLimit');
    if (raw === undefined) {
      return BUILD_HISTORY_LIMIT_DEFAULT;
    }
    // Fall back to the built-in default if the setting is somehow out of range, rather
    // than throwing — mirrors getDefaultSoftwareRenderCpus (Settings JSON-schema min/max
    // isn't reliably enforced across every Podman Desktop version).
    try {
      return assertBuildHistoryLimit(raw);
    } catch {
      return BUILD_HISTORY_LIMIT_DEFAULT;
    }
  }

  async setBuildHistoryLimit(limit: number): Promise<void> {
    const safe = assertBuildHistoryLimit(limit);
    const config = extensionApi.configuration.getConfiguration('physical-ai');
    await config.update('buildHistoryLimit', safe);
  }

  async pullImage(fullImageName: string, tag: string): Promise<void> {
    this.#startPull(`quay.io/${fullImageName}:${tag}`);
  }

  async pullImageByRef(imageRef: string): Promise<void> {
    const ref = imageRef?.trim();
    if (!ref || !/^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/.test(ref)) {
      throw new Error(`Invalid image reference "${String(imageRef)}".`);
    }
    this.#startPull(ref);
  }

  #startPull(imageToPull: string): void {
    const podmanConnection = this.#getRunningPodmanConnection();

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

  async buildFromContainerfile(
    tag: string,
    containerfile: string,
    platform?: string,
    options?: { generateSbom?: boolean; sbomFormat?: SbomFormat },
  ): Promise<void> {
    if (!containerfile?.trim()) {
      throw new Error('Cannot build: the Containerfile is empty.');
    }
    // Guard concurrency before touching disk so an over-cap request fails fast.
    this.#assertCanStartOp(this.activeBuilds, tag, 'build');

    const contextDir = await mkdtemp(pathJoin(tmpdir(), 'physical-ai-layer-build-'));
    try {
      await writeFile(pathJoin(contextDir, 'Containerfile'), containerfile, 'utf8');
    } catch (err) {
      await rm(contextDir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }

    try {
      this.#runContainerBuild(
        tag,
        contextDir,
        'Containerfile',
        undefined,
        platform,
        () => {
          void rm(contextDir, { recursive: true, force: true }).catch(() => {});
        },
        options?.generateSbom,
        options?.sbomFormat ?? SBOM_FORMAT_DEFAULT,
      );
    } catch (err) {
      // buildImage never kicked off (e.g. no running Podman) — remove the context now.
      await rm(contextDir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
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

  async getImageBuilderLayout(): Promise<'pipeline' | 'guided' | 'layers'> {
    const config = extensionApi.configuration.getConfiguration('physical-ai');
    const layout = config.get<string>('imageBuilderLayout');
    return layout === 'pipeline' || layout === 'layers' ? layout : 'guided';
  }

  async setImageBuilderLayout(layout: 'pipeline' | 'guided' | 'layers'): Promise<void> {
    if (layout !== 'pipeline' && layout !== 'guided' && layout !== 'layers') {
      throw new Error(`Invalid image builder layout "${String(layout)}". Use "pipeline", "guided", or "layers".`);
    }
    const config = extensionApi.configuration.getConfiguration('physical-ai');
    await config.update('imageBuilderLayout', layout);
  }

  async getNavigationLayout(): Promise<'sidebar' | 'tabs' | 'cards'> {
    const config = extensionApi.configuration.getConfiguration('physical-ai');
    const layout = config.get<string>('navigationLayout');
    return layout === 'tabs' || layout === 'cards' ? layout : 'sidebar';
  }

  async setNavigationLayout(layout: 'sidebar' | 'tabs' | 'cards'): Promise<void> {
    if (layout !== 'sidebar' && layout !== 'tabs' && layout !== 'cards') {
      throw new Error(`Invalid navigation layout "${String(layout)}". Use "sidebar", "tabs", or "cards".`);
    }
    const config = extensionApi.configuration.getConfiguration('physical-ai');
    await config.update('navigationLayout', layout);
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

  /**
   * Robots actually running in the local sim container, reconciled via `ros2 node list`
   * (APPENG-6250) — the local counterpart of `listSpawnedRobotsInOpenShift`, sharing its
   * parsing logic (`parseSpawnedRobotNames`) since only the exec transport differs.
   * Returns [] (never throws) on any resolution/exec failure, matching listRosTopics.
   */
  async listSpawnedRobotsInSimulation(containerId: string): Promise<string[]> {
    try {
      const { id } = await this.#resolveSimulationContainer(containerId);
      const distro = await this.#detectRosDistro(id);
      const target = { kind: 'podman', id } as const;
      const result = await this.#execRosBash(target, distro, 'ros2 node list');
      if (result.exitCode !== 0 || !result.stdout.trim()) {
        return [];
      }
      return parseSpawnedRobotNames(result.stdout);
    } catch {
      return [];
    }
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
    if (text.length > CLIPBOARD_MAX_BYTES) {
      const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
      throw new Error(
        `Clipboard text exceeds the allowed size (${mb(text.length)}MB > ${mb(CLIPBOARD_MAX_BYTES)}MB limit).`,
      );
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
    this.nav2ClearPending.delete(PhysicalAiApiImpl.#navTargetKey({ kind: 'podman', id }, robotName));
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

    // Cold-start artifact: on a fresh Nav2 bringup the global costmap transiently
    // holds bad/phantom obstacle cells (laser scans mis-projected while the sim
    // clock/TF lag during the CPU-heavy launch). The global planner then fails to
    // find a path ("GridBased plugin failed to plan … Failed to create plan") for
    // the first several cycles, and Nav2's recovery clears the global costmap and
    // retries — the ~15 s "jumping in place" before the robot actually moves. When
    // we launched this bringup, clear both costmaps here, on the FIRST goal and
    // right before planning (by now the clock has usually settled, unlike at
    // pre-warm), then let them refill clean so the first plan succeeds. Consumed
    // once per bringup — subsequent goals and warm sims we never brought up skip it.
    const clearKey = PhysicalAiApiImpl.#navTargetKey(target, robotName);
    if (this.nav2ClearPending.has(clearKey)) {
      this.nav2ClearPending.delete(clearKey);
      await this.#clearNav2Costmaps(target, robotName, distro);
    }

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
    // Warm path: TF already present → the stack is up. The cold-start costmap clear
    // is done at goal-dispatch time (see #sendNav2NavigationGoal), not here.
    if (await this.#hasMapBaseLinkTf(target, robotName, distro)) {
      return;
    }

    // Cold path: either a bringup is already in flight (e.g. pre-warm) or we launch
    // one now. Both funnel through the same TF wait.
    const bringupRunning = await this.#isNav2BringupRunning(target, robotName, distro);
    if (!bringupRunning) {
      // We're launching a fresh bringup → the first goal must clear the costmaps once.
      this.nav2ClearPending.add(PhysicalAiApiImpl.#navTargetKey(target, robotName));
      await this.#execDetached(target, NAV2_ENTRYPOINT, [robotName], {
        PHYSICAL_AI_SPAWN_X: pose.x.toFixed(4),
        PHYSICAL_AI_SPAWN_Y: pose.y.toFixed(4),
      });
    }

    for (let attempt = 0; attempt < NAV2_TF_POLL_ATTEMPTS; attempt++) {
      await PhysicalAiApiImpl.#sleep(1000);
      if (await this.#hasMapBaseLinkTf(target, robotName, distro)) {
        return;
      }
    }

    throw new Error(
      bringupRunning
        ? `Nav2 bringup for "${robotName}" is running but map→base_link TF never became available.`
        : `Nav2 stack for "${robotName}" did not become ready (map→base_link TF missing). ` +
            'Stop other sim containers or use a fresh simulation before Go.',
    );
  }

  /**
   * Stable key for the per-bringup cold-start costmap-clear state (#nav2ClearPending):
   * container id (local) or `${namespace}/${pod}` (OpenShift), plus the robot name.
   */
  static #navTargetKey(target: ExecTarget, robotName: string): string {
    const scope = target.kind === 'podman' ? target.id : `${target.namespace}/${target.pod}`;
    return `${scope} ${robotName}`;
  }

  /**
   * Clear both Nav2 costmaps for a robot, then briefly settle so they refill from
   * live (good-TF) scans before the planner plans on them. Called once per cold Nav2
   * bringup, at goal-dispatch time, to drop the startup phantom obstacles that
   * otherwise make the global planner fail ("Failed to create plan") and churn
   * through recovery on the first goal (see #sendNav2NavigationGoal).
   * Best-effort: logs and swallows errors — a clear hiccup must never block Navigate.
   */
  async #clearNav2Costmaps(target: ExecTarget, robotName: string, distro: SupportedRosDistro): Promise<void> {
    const safeRobot = assertRobotName(robotName);
    try {
      await this.#execRosBash(
        target,
        distro,
        'for cm in local_costmap/clear_entirely_local_costmap global_costmap/clear_entirely_global_costmap; do ' +
          'timeout 15 ros2 service call "/$1/$cm" nav2_msgs/srv/ClearEntireCostmap "{}" >/dev/null 2>&1 || true; ' +
          'done',
        [safeRobot],
      );
      await PhysicalAiApiImpl.#sleep(NAV2_COSTMAP_REFILL_MS);
    } catch (err) {
      console.error(`[physical-ai] Nav2 costmap clear for "${robotName}" failed (non-fatal):`, err);
    }
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

  /**
   * Curated TF chain snapshot (map→odom→base_footprint→base_link→base_scan), one tf2_echo
   * per pair run sequentially — same one-shot/no-streaming shape as peekRosTopic, extended
   * from the single-pair precedent in #hasMapBaseLinkTf to the full chain. Sequential (not
   * concurrent) deliberately trades wall-clock time (up to ~4 * TF_DIAGNOSTIC_TIMEOUT_SEC in
   * the worst case) for a much lower peak CPU/DDS-participant spike, since this is a one-shot
   * diagnostic snapshot rather than a latency-sensitive path. Never throws for an unavailable
   * pair (idle Nav2/AMCL, or the topic simply isn't up yet); that pair's `available` is just
   * false.
   */
  async getTfTreeStatus(containerId: string, robotName: string): Promise<TfTreeResult> {
    const { id } = await this.#resolveSimulationContainer(containerId);
    const safeRobot = assertRobotName(robotName);
    const distro = await this.#detectRosDistro(id);
    const target = { kind: 'podman', id } as const;
    return this.#tfTreeStatusFor(target, distro, safeRobot);
  }

  async #tfTreeStatusFor(target: ExecTarget, distro: SupportedRosDistro, safeRobot: string): Promise<TfTreeResult> {
    const capturedAt = new Date().toISOString();

    const frames: TfTreeResult['frames'] = [];
    for (const [parentFrame, childFrame] of TF_FRAME_PAIRS) {
      const result = await this.#execRosBash(
        target,
        distro,
        'timeout "$1" ros2 run tf2_ros tf2_echo "$2" "$3" --ros-args -p use_sim_time:=true ' +
          '-r /tf:=/$4/tf -r /tf_static:=/$4/tf_static 2>&1',
        [String(TF_DIAGNOSTIC_TIMEOUT_SEC), parentFrame, childFrame, safeRobot],
      );
      const parsed = parseTfEchoOutput(result.stdout);
      frames.push({
        parentFrame,
        childFrame,
        available: parsed.available,
        translation: parsed.translation,
        rotationQuaternion: parsed.rotationQuaternion,
        error: parsed.error,
      });
    }

    return { robotNamespace: safeRobot, frames, capturedAt };
  }

  /**
   * Local + global Nav2 costmap summaries (cell counts, not raw grids — a global costmap can
   * be 100k+ cells). Runs both peeks sequentially (local then global) — one idle costmap
   * (e.g. before Navigate has run) never blanks the other, and the sequencing trades a bit of
   * wall-clock time for a lower peak CPU spike, matching getTfTreeStatus. Uses default QoS (no
   * --qos-reliability/--qos-durability override) — verified live against a running Nav2
   * bringup that costmap topics are readable with defaults, and forcing best_effort/volatile
   * risks mismatching Nav2's actual publisher QoS (transient_local/reliable is common for
   * costmap layers).
   */
  async getCostmapSummary(containerId: string, robotName: string): Promise<CostmapSummaryResult> {
    const { id } = await this.#resolveSimulationContainer(containerId);
    const safeRobot = assertRobotName(robotName);
    const distro = await this.#detectRosDistro(id);
    const target = { kind: 'podman', id } as const;
    return this.#costmapSummaryFor(target, distro, safeRobot);
  }

  async #costmapSummaryFor(
    target: ExecTarget,
    distro: SupportedRosDistro,
    safeRobot: string,
  ): Promise<CostmapSummaryResult> {
    const local = await this.#peekOccupancyGrid(target, distro, `/${safeRobot}/local_costmap/costmap`);
    const global = await this.#peekOccupancyGrid(target, distro, `/${safeRobot}/global_costmap/costmap`);
    return { local, global };
  }

  /**
   * Peeks one `nav_msgs/OccupancyGrid` topic and summarizes cell counts. Deliberately does
   * NOT route through cleanEchoOutput() — its 64KB truncation (tuned for a single peeked
   * message) would cut off a global costmap's `data:` array well before the end (verified
   * live: a 384x384 global costmap's flow-style data array alone is ~590KB), corrupting the
   * occupied/free/unknown counts. `--full-length --flow-style` on the echo itself keeps the
   * array complete AND on a single compact line instead of one line per cell.
   */
  async #peekOccupancyGrid(
    target: ExecTarget,
    distro: SupportedRosDistro,
    topic: string,
  ): Promise<OccupancyGridSummary> {
    const capturedAt = new Date().toISOString();
    const zero = (extra: Partial<OccupancyGridSummary>): OccupancyGridSummary => ({
      topic,
      widthCells: 0,
      heightCells: 0,
      resolutionMeters: 0,
      originX: 0,
      originY: 0,
      occupiedCells: 0,
      freeCells: 0,
      unknownCells: 0,
      totalCells: 0,
      capturedAt,
      ...extra,
    });

    let timeoutSec: number;
    try {
      timeoutSec = await this.getTopicPeekTimeoutSeconds();
    } catch (e) {
      return zero({ error: e instanceof Error ? e.message : String(e) });
    }

    const result = await this.#execRosBash(
      target,
      distro,
      'timeout "$1" ros2 topic echo --once --full-length --flow-style "$2" 2>&1',
      [String(timeoutSec), topic],
    );
    const stdout = (result.stdout ?? '').trim();
    const stderr = (result.stderr ?? '').trim();

    const parsed = stdout ? parseOccupancyGridEcho(stdout) : undefined;
    if (parsed) {
      return {
        topic,
        widthCells: parsed.width,
        heightCells: parsed.height,
        resolutionMeters: parsed.resolution,
        originX: parsed.originX,
        originY: parsed.originY,
        occupiedCells: parsed.occupied,
        freeCells: parsed.free,
        unknownCells: parsed.unknown,
        totalCells: parsed.total,
        capturedAt,
      };
    }

    // Any non-zero exit here means "not available yet", not just a literal timeout (124): the
    // script redirects the ros2 process's stderr into its own stdout (`2>&1`), so a topic that
    // has never been published at all (e.g. right after spawn, before Nav2 exists) fails fast
    // with exit 1 and a "does not appear to be published yet / could not determine the type"
    // message on stdout — verified live — rather than blocking until the timeout wrapper kills
    // it at 124. Both cases mean the same thing to the user: come back once Nav2 has started.
    if (result.exitCode !== 0) {
      return zero({
        timedOut: true,
        error: `No message on ${topic} within ${timeoutSec}s. The costmap may not be publishing yet — try after Navigate has run.`,
      });
    }

    return zero({ error: stderr || `Failed to peek ${topic} (exit ${result.exitCode})` });
  }

  /**
   * LaserScan summary (angle/range bounds, min/max/mean of finite ranges, inf/nan counts).
   * Keeps peekRosTopic's best_effort/volatile QoS override — LaserScan is a normal
   * best-effort sensor stream, unlike the costmap. Adds --full-length --flow-style for the
   * same reason as #peekOccupancyGrid: the TB3 LDS publishes 360+ ranges, over the default
   * 128-element truncation (verified live).
   */
  async getLaserScanSummary(containerId: string, robotName: string): Promise<LaserScanSummary> {
    const { id } = await this.#resolveSimulationContainer(containerId);
    const safeRobot = assertRobotName(robotName);
    const distro = await this.#detectRosDistro(id);
    const target = { kind: 'podman', id } as const;
    return this.#laserScanSummaryFor(target, distro, safeRobot);
  }

  async #laserScanSummaryFor(
    target: ExecTarget,
    distro: SupportedRosDistro,
    safeRobot: string,
  ): Promise<LaserScanSummary> {
    const topic = `/${safeRobot}/scan`;
    const capturedAt = new Date().toISOString();

    let timeoutSec: number;
    const zero = (extra: Partial<LaserScanSummary>): LaserScanSummary => ({
      topic,
      angleMinRad: 0,
      angleMaxRad: 0,
      angleIncrementRad: 0,
      rangeMinMeters: 0,
      rangeMaxMeters: 0,
      finiteCount: 0,
      infCount: 0,
      nanCount: 0,
      totalCount: 0,
      capturedAt,
      ...extra,
    });

    try {
      timeoutSec = await this.getTopicPeekTimeoutSeconds();
    } catch (e) {
      return zero({ error: e instanceof Error ? e.message : String(e) });
    }

    const result = await this.#execRosBash(
      target,
      distro,
      'timeout "$1" ros2 topic echo --once --qos-reliability best_effort --qos-durability volatile ' +
        '--full-length --flow-style "$2" 2>&1',
      [String(timeoutSec), topic],
    );
    const stdout = (result.stdout ?? '').trim();
    const stderr = (result.stderr ?? '').trim();

    const parsed = stdout ? parseLaserScanEcho(stdout) : undefined;
    if (parsed) {
      return {
        topic,
        angleMinRad: parsed.angleMin,
        angleMaxRad: parsed.angleMax,
        angleIncrementRad: parsed.angleIncrement,
        rangeMinMeters: parsed.rangeMin,
        rangeMaxMeters: parsed.rangeMax,
        minRange: parsed.min,
        maxRange: parsed.max,
        meanRange: parsed.mean,
        finiteCount: parsed.finiteCount,
        infCount: parsed.infCount,
        nanCount: parsed.nanCount,
        totalCount: parsed.totalCount,
        capturedAt,
      };
    }

    // See the equivalent comment in #peekOccupancyGrid: a topic with no publisher at all fails
    // fast with a non-124 exit code and a "not published yet" message merged into stdout via the
    // script's own `2>&1`, not via the timeout wrapper — treat any non-zero exit the same way.
    if (result.exitCode !== 0) {
      return zero({
        timedOut: true,
        error: `No message on ${topic} within ${timeoutSec}s. The topic may be idle — try one with active publishers.`,
      });
    }

    return zero({ error: stderr || `Failed to peek ${topic} (exit ${result.exitCode})` });
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
    const contextArgs = target.context ? ['--context', target.context] : [];
    return ['oc', [...contextArgs, 'exec', '-n', target.namespace, target.pod, '--', ...command]];
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
    const contextArgs = target.context ? ['--context', target.context] : [];
    await extensionApi.process.exec('oc', [
      ...contextArgs,
      'exec',
      '-n',
      target.namespace,
      target.pod,
      '--',
      'bash',
      '-c',
      remote,
    ]);
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
      startedAt: Date.now(),
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
            progress.finishedAt = Date.now();
            progress.error = 'Push cancelled';
            appendProgressLog(progress.logs, 'Push cancelled by user');
          } else {
            progress.status = 'Complete';
            progress.done = true;
            progress.finishedAt = Date.now();
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
            progress.finishedAt = Date.now();
            progress.error = 'Push cancelled';
            appendProgressLog(progress.logs, 'Push cancelled by user');
          } else {
            progress.status = 'Failed';
            progress.done = true;
            progress.finishedAt = Date.now();
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
    progress.finishedAt = Date.now();
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
      const contextName = match[1];
      return {
        context: contextName,
        kubeconfigPath,
        namespace: kubeconfigContextNamespace(content, contextName),
        clusterUrl: kubeconfigClusterServer(content, contextName),
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Every context available in the kubeconfig (not just current-context), so the UI can
   * offer switching to a different cluster (S8-10) — each context carries its own
   * credentials/user, so this is the only way to target a cluster other than the
   * kubeconfig's default without inventing credentials for an arbitrary URL. Returns []
   * on any read/parse failure (mirrors getOpenShiftContext's fail-soft style).
   */
  async listKubeContexts(): Promise<{ name: string; clusterUrl?: string; namespace?: string }[]> {
    try {
      const uri = extensionApi.kubernetes.getKubeconfig();
      const content = await readFile(uri.fsPath, 'utf-8');
      return kubeconfigListEntryNames(content, 'contexts').map(name => ({
        name,
        clusterUrl: kubeconfigClusterServer(content, name),
        namespace: kubeconfigContextNamespace(content, name),
      }));
    } catch {
      return [];
    }
  }

  async getDefaultOpenShiftNamespace(): Promise<string> {
    const config = extensionApi.configuration.getConfiguration('physical-ai');
    return config.get<string>('defaultOpenShiftNamespace') ?? '';
  }

  async checkOpenShiftLogin(context?: string): Promise<{ loggedIn: boolean; message?: string }> {
    try {
      const contextArgs = context ? ['--context', context] : [];
      const res = await extensionApi.process.exec('oc', [...contextArgs, 'whoami']);
      if (res.stdout?.trim()) {
        return { loggedIn: true };
      }
      return { loggedIn: false, message: 'Not logged in to OpenShift — run `oc login` first.' };
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string };
      const detail = firstNonEmpty(e.stderr?.trim(), e.message, String(err));
      if (/Unauthorized|Missing or incomplete configuration|must provide credentials/i.test(detail)) {
        return { loggedIn: false, message: 'Not logged in to OpenShift — run `oc login` first.' };
      }
      return { loggedIn: false, message: this.#ocErrorMessage(err, 'verify OpenShift login') };
    }
  }

  /**
   * Every project/namespace the user can see on the given context (S8-21), so the deploy
   * form's namespace field can offer a type-to-filter combobox instead of pure free-text.
   * `oc get projects -o name` emits `project.project.openshift.io/<name>` per line; strip
   * the resource-type prefix. Fails soft (returns []) on any error — not logged in, `oc`
   * missing, or no `oc get projects` access — so the UI degrades to free-text entry rather
   * than surfacing an error for what's just a UX nicety.
   */
  async listOpenShiftProjects(context?: string): Promise<string[]> {
    try {
      const contextArgs = context ? ['--context', context] : [];
      const res = await extensionApi.process.exec('oc', [...contextArgs, 'get', 'projects', '-o', 'name']);
      const stdout = res.stdout ?? '';
      return stdout
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => line.replace(/^project\.project\.openshift\.io\//, ''))
        .sort();
    } catch {
      return [];
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
    // config.context (S8-10) overrides the kubeconfig's current-context when the user
    // picked a different cluster from the dropdown; falls back to today's behavior.
    const targetContext = config.context ?? ctx.context;

    // extensionApi.kubernetes.createResources() re-applies an already-existing Deployment
    // or Service correctly, but leaves an already-existing ConfigMap untouched (confirmed
    // live against a real OpenShift cluster — APPENG-6227): a redeploy with changed
    // Hummingbird nginx proxy config would silently keep serving the stale config. Delete
    // any prior ConfigMap for this deployment first so it's always created fresh.
    const configMap = manifests.find(m => m.kind === 'ConfigMap') as
      { metadata?: { name?: string; namespace?: string } } | undefined;
    if (configMap?.metadata?.name && configMap.metadata.namespace) {
      const contextArgs = config.context ? ['--context', config.context] : [];
      await extensionApi.process
        .exec('oc', [
          ...contextArgs,
          'delete',
          'configmap',
          configMap.metadata.name,
          '-n',
          configMap.metadata.namespace,
          '--ignore-not-found',
        ])
        .catch(() => undefined);
    }

    await extensionApi.kubernetes.createResources(targetContext, manifests);

    const routeUrl = await this.#readRouteUrl(config.namespace, config.name, config.context);
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

  async listOpenShiftDeployments(namespace: string, context?: string): Promise<OpenShiftWorkload[]> {
    const ns = assertNamespace(namespace);
    let stdout: string;
    try {
      const contextArgs = context ? ['--context', context] : [];
      const res = await extensionApi.process.exec('oc', [
        ...contextArgs,
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
        spec?: {
          replicas?: number;
          template?: { spec?: { containers?: Array<{ name?: string; image?: string }> } };
        };
        status?: { readyReplicas?: number };
      };
      const name = d.metadata?.name;
      if (!name) continue;
      const replicas = d.spec?.replicas ?? 0;
      const readyReplicas = d.status?.readyReplicas ?? 0;
      const containers = d.spec?.template?.spec?.containers ?? [];
      const image = containers[0]?.image;
      const hasHummingbirdSidecar = containers.some(c => c.name === HUMMINGBIRD_NGINX_CONTAINER_NAME);
      const routeUrl = await this.#readRouteUrl(ns, name, context);
      workloads.push({
        name,
        namespace: ns,
        replicas,
        readyReplicas,
        ready: replicas > 0 && readyReplicas >= replicas,
        image,
        routeUrl,
        hasHummingbirdSidecar,
      });
    }
    return workloads;
  }

  async deleteOpenShiftDeployment(namespace: string, name: string, context?: string): Promise<void> {
    const ns = assertNamespace(namespace);
    const safeName = assertK8sName(name, 'name');
    try {
      const contextArgs = context ? ['--context', context] : [];
      // Selector-based (not name-based) so it also sweeps the Hummingbird nginx sidecar's
      // ConfigMap (APPENG-6227), which is named `<name>-hummingbird-nginx-conf` rather than
      // `<name>` but carries the same `app` label as the other three resources.
      await extensionApi.process.exec('oc', [
        ...contextArgs,
        'delete',
        'deployment,service,route,configmap',
        '-l',
        `app=${safeName}`,
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
    context?: string,
  ): Promise<void> {
    const ns = assertNamespace(namespace);
    const safeName = assertK8sName(name, 'name');
    // Reuse the same argv validation as the local spawn path.
    const [, safeRobot, safeX, safeY, safeYaw] = assertSpawnExecCommand([SPAWN_ENTRYPOINT, robotName, x, y, yaw]);
    const pod = await this.#resolveOpenShiftPod(ns, safeName, context);
    const target = { kind: 'oc', pod, namespace: ns, context } as const;
    await this.#execDetached(target, SPAWN_ENTRYPOINT, [safeRobot, safeX, safeY, safeYaw]);

    // Warm Nav2 in the background so the first Navigate click is instant (Jazzy only).
    // The spawn already succeeded — never let pre-warm setup surface as an error.
    try {
      const image = await this.#openShiftDeploymentImage(ns, safeName, context);
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
    context?: string,
  ): Promise<NavigationGoalResult> {
    const ns = assertNamespace(namespace);
    const safeName = assertK8sName(name, 'name');
    const safeRobot = assertRobotName(robotName);
    const image = await this.#openShiftDeploymentImage(ns, safeName, context);
    const distro = PhysicalAiApiImpl.#distroFromImage(image);
    const pod = await this.#resolveOpenShiftPod(ns, safeName, context);
    const target = { kind: 'oc', pod, namespace: ns, context } as const;

    if (distro === 'jazzy') {
      return this.#sendNav2NavigationGoal(target, safeRobot, x, y, distro);
    }
    return this.#sendCmdVelNavigationGoal(target, safeRobot, x, y, distro);
  }

  async despawnRobotInOpenShift(namespace: string, name: string, robotName: string, context?: string): Promise<void> {
    const ns = assertNamespace(namespace);
    const safeName = assertK8sName(name, 'name');
    const safeRobot = assertRobotName(robotName);
    const image = await this.#openShiftDeploymentImage(ns, safeName, context);
    const distro = PhysicalAiApiImpl.#distroFromImage(image);
    const pod = await this.#resolveOpenShiftPod(ns, safeName, context);
    await this.#teardownRobot({ kind: 'oc', pod, namespace: ns, context }, safeRobot, distro);
    this.nav2WarmStatus.delete(PhysicalAiApiImpl.#warmKey(`${ns}/${safeName}`, safeRobot));
    this.nav2ClearPending.delete(
      PhysicalAiApiImpl.#navTargetKey({ kind: 'oc', pod, namespace: ns, context }, safeRobot),
    );
  }

  async getRobotWarmStatusInOpenShift(namespace: string, name: string, robotName: string): Promise<Nav2WarmStatus> {
    const ns = assertNamespace(namespace);
    const safeName = assertK8sName(name, 'name');
    const safeRobot = assertRobotName(robotName);
    return this.nav2WarmStatus.get(PhysicalAiApiImpl.#warmKey(`${ns}/${safeName}`, safeRobot)) ?? 'idle';
  }

  /**
   * Robots actually running in the deployment's pod, reconciled via `ros2 node list`
   * (S8-17) — spawn state otherwise lives only in frontend memory, so a page reload or
   * extension restart forgets robots spawned earlier even though they're still running.
   * Returns [] (never throws) on any resolution/exec failure, matching listRosTopics.
   */
  async listSpawnedRobotsInOpenShift(namespace: string, name: string, context?: string): Promise<string[]> {
    const ns = assertNamespace(namespace);
    const safeName = assertK8sName(name, 'name');
    try {
      const image = await this.#openShiftDeploymentImage(ns, safeName, context);
      const distro = PhysicalAiApiImpl.#distroFromImage(image);
      const pod = await this.#resolveOpenShiftPod(ns, safeName, context);
      const target = { kind: 'oc', pod, namespace: ns, context } as const;
      const result = await this.#execRosBash(target, distro, 'ros2 node list');
      if (result.exitCode !== 0 || !result.stdout.trim()) {
        return [];
      }
      return parseSpawnedRobotNames(result.stdout);
    } catch {
      return [];
    }
  }

  /** OpenShift counterpart of getTfTreeStatus — see #tfTreeStatusFor for the shared logic. */
  async getTfTreeStatusInOpenShift(
    namespace: string,
    name: string,
    robotName: string,
    context?: string,
  ): Promise<TfTreeResult> {
    const ns = assertNamespace(namespace);
    const safeName = assertK8sName(name, 'name');
    const safeRobot = assertRobotName(robotName);
    const image = await this.#openShiftDeploymentImage(ns, safeName, context);
    const distro = PhysicalAiApiImpl.#distroFromImage(image);
    const pod = await this.#resolveOpenShiftPod(ns, safeName, context);
    const target = { kind: 'oc', pod, namespace: ns, context } as const;
    return this.#tfTreeStatusFor(target, distro, safeRobot);
  }

  /** OpenShift counterpart of getCostmapSummary — see #costmapSummaryFor for the shared logic. */
  async getCostmapSummaryInOpenShift(
    namespace: string,
    name: string,
    robotName: string,
    context?: string,
  ): Promise<CostmapSummaryResult> {
    const ns = assertNamespace(namespace);
    const safeName = assertK8sName(name, 'name');
    const safeRobot = assertRobotName(robotName);
    const image = await this.#openShiftDeploymentImage(ns, safeName, context);
    const distro = PhysicalAiApiImpl.#distroFromImage(image);
    const pod = await this.#resolveOpenShiftPod(ns, safeName, context);
    const target = { kind: 'oc', pod, namespace: ns, context } as const;
    return this.#costmapSummaryFor(target, distro, safeRobot);
  }

  /** OpenShift counterpart of getLaserScanSummary — see #laserScanSummaryFor for the shared logic. */
  async getLaserScanSummaryInOpenShift(
    namespace: string,
    name: string,
    robotName: string,
    context?: string,
  ): Promise<LaserScanSummary> {
    const ns = assertNamespace(namespace);
    const safeName = assertK8sName(name, 'name');
    const safeRobot = assertRobotName(robotName);
    const image = await this.#openShiftDeploymentImage(ns, safeName, context);
    const distro = PhysicalAiApiImpl.#distroFromImage(image);
    const pod = await this.#resolveOpenShiftPod(ns, safeName, context);
    const target = { kind: 'oc', pod, namespace: ns, context } as const;
    return this.#laserScanSummaryFor(target, distro, safeRobot);
  }

  /** Name of a Running pod for the deployment (selected by the `app=<name>` label). */
  async #resolveOpenShiftPod(namespace: string, name: string, context?: string): Promise<string> {
    let stdout: string;
    try {
      const contextArgs = context ? ['--context', context] : [];
      const res = await extensionApi.process.exec('oc', [
        ...contextArgs,
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
  async #openShiftDeploymentImage(namespace: string, name: string, context?: string): Promise<string> {
    let stdout: string;
    try {
      const contextArgs = context ? ['--context', context] : [];
      const res = await extensionApi.process.exec('oc', [
        ...contextArgs,
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
  async #readRouteUrl(namespace: string, name: string, context?: string): Promise<string | undefined> {
    try {
      const contextArgs = context ? ['--context', context] : [];
      const res = await extensionApi.process.exec('oc', [
        ...contextArgs,
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
