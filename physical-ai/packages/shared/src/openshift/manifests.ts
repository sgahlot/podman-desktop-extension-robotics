/**
 * Pure builders for the OpenShift manifests the extension applies (APPENG-5777).
 *
 * Kept dependency-free so it is unit-testable without the Podman Desktop API.
 * The extension applies the *objects* via `extensionApi.kubernetes.createResources`;
 * the YAML rendering here is only for the on-screen preview.
 */

import type { OpenShiftDeployConfig } from '../types/OpenShiftDeploy';

/** noVNC port baked into the simulation image (matches the Containerfile EXPOSE). */
export const NOVNC_CONTAINER_PORT = 6080;

/** Label marking resources this extension manages, used for list/delete. */
export const PART_OF_LABEL = 'app.kubernetes.io/part-of';
export const PART_OF_VALUE = 'physical-ai';

/** DNS-1123 label: lowercase alphanumeric and '-', must start/end alphanumeric, max 63. */
const DNS_1123_LABEL_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/**
 * Conservative image-ref check: registry/repo path with optional :tag and/or
 * @sha256 digest. Rejects whitespace and shell metacharacters.
 */
const IMAGE_REF_RE =
  /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?(:[0-9]+)?(\/[a-z0-9]([a-z0-9._-]*[a-z0-9])?)*(:[a-zA-Z0-9._-]+)?(@sha256:[a-f0-9]{64})?$/;

export function assertK8sName(name: string, label = 'name'): string {
  if (typeof name !== 'string' || name.length === 0 || name.length > 63 || !DNS_1123_LABEL_RE.test(name)) {
    throw new Error(
      `Invalid ${label} "${name}". Use lowercase letters, digits and '-' (max 63, must start and end alphanumeric).`,
    );
  }
  return name;
}

export function assertNamespace(namespace: string): string {
  return assertK8sName(namespace, 'namespace');
}

export function assertImageRef(image: string): string {
  if (typeof image !== 'string' || image.length === 0 || image.length > 512 || !IMAGE_REF_RE.test(image)) {
    throw new Error(
      `Invalid image reference "${image}". Expected something like quay.io/<ns>/ros2-jazzy-sim:noble-amd64.`,
    );
  }
  return image;
}

/** GPU device the NVIDIA GPU operator advertises; requested when useGpu is set. */
export const GPU_RESOURCE = 'nvidia.com/gpu';

/**
 * Default guaranteed CPU count for the software-render pod. Chosen because
 * llvmpipe + Gazebo + Nav2 burst past ~6 cores and CFS throttling causes
 * micro-stutter; 8 leaves headroom. Configurable per cluster via `config.cpu`.
 */
export const DEFAULT_SW_RENDER_CPU = 8;

/**
 * Guaranteed CPU count for the GPU pod. The GPU only offloads *sensor* rendering
 * (the gz server's off-screen EGL); on an NVIDIA-operator cluster there is no
 * /dev/dri render node, so the Gazebo GUI canvas stays software-rendered (the GUI
 * process alone burns ~3 cores of llvmpipe at idle) and active Nav2 adds ~1.5
 * more. At 6 the pod throttled ~97% of scheduling periods even at idle (measured
 * live), so first-move lagged ~20s and motion was jumpy. 7 (requests==limits) is
 * the most a g5.2xlarge fits — 7000m pod + ~474m node-system = ~7474m < ~7500m
 * allocatable, i.e. the node's last free core — and gives idle demand headroom so
 * the throttle eases. Still bounded by the 8-vCPU GPU node, which can't match the
 * 8-CPU software-render path on a bigger node (see the story5/item-5 notes): real
 * smoothness on this path needs a larger GPU node or a /dev/dri render node so the
 * GUI itself can render on the GPU. Not user-configurable — GPU node size, not
 * preference, bounds it.
 */
export const GPU_POD_CPU = 7;

/** Validate a user-supplied CPU count: a whole number of cores in a sane range. */
export function assertCpuCount(cpu: number): number {
  if (typeof cpu !== 'number' || !Number.isInteger(cpu) || cpu < 1 || cpu > 64) {
    throw new Error(`Invalid CPU count "${cpu}". Use a whole number of cores between 1 and 64.`);
  }
  return cpu;
}

/**
 * Default GPU-node taint to tolerate. GPU MachineSets taint their nodes so only
 * GPU workloads land there; this matches the common `g5-gpu=true:NoSchedule`
 * taint. Override per cluster via `config.gpuToleration`.
 */
export const DEFAULT_GPU_TOLERATION = 'g5-gpu=true:NoSchedule';

/** Taint effects Kubernetes accepts on a toleration. */
const TOLERATION_EFFECTS = ['NoSchedule', 'PreferNoSchedule', 'NoExecute'];

/** A single Kubernetes toleration object (the shape the pod spec expects). */
export interface KubeToleration {
  key: string;
  operator: 'Equal' | 'Exists';
  value?: string;
  effect: string;
}

// A taint/label key: optional DNS-subdomain prefix ('/') then a name segment.
const TOLERATION_KEY_RE = /^([a-z0-9]([a-z0-9.-]*[a-z0-9])?\/)?[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/**
 * Parse a `key[=value][:effect]` toleration spec into a Kubernetes toleration.
 * With a value → `Equal`; without → `Exists`. `effect` defaults to `NoSchedule`.
 * The effect is split off first (only when it's a known effect), so keys that
 * contain a '/' prefix (e.g. `nvidia.com/gpu`) parse correctly.
 */
export function parseGpuToleration(raw: string): KubeToleration {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(`Invalid GPU toleration "${raw}". Expected key[=value][:effect], e.g. g5-gpu=true:NoSchedule.`);
  }
  let rest = raw.trim();
  let effect = 'NoSchedule';
  const colon = rest.lastIndexOf(':');
  if (colon !== -1) {
    const maybeEffect = rest.slice(colon + 1);
    if (TOLERATION_EFFECTS.includes(maybeEffect)) {
      effect = maybeEffect;
      rest = rest.slice(0, colon);
    }
  }
  const eq = rest.indexOf('=');
  const key = eq === -1 ? rest : rest.slice(0, eq);
  const value = eq === -1 ? undefined : rest.slice(eq + 1);
  if (!TOLERATION_KEY_RE.test(key)) {
    throw new Error(`Invalid GPU toleration key "${key}". Use a taint key like g5-gpu or nvidia.com/gpu.`);
  }
  return value !== undefined ? { key, operator: 'Equal', value, effect } : { key, operator: 'Exists', effect };
}

/**
 * Build the [Deployment, Service, Route] objects for a single simulation pod.
 * Software (llvmpipe + headless EGL) rendering by default; when `config.useGpu`
 * is set the pod requests an NVIDIA GPU and the entrypoint uses hardware rendering.
 */
export function buildOpenShiftManifests(config: OpenShiftDeployConfig): Record<string, unknown>[] {
  const name = assertK8sName(config.name, 'deployment name');
  const namespace = assertNamespace(config.namespace);
  const image = assertImageRef(config.image);
  const useGpu = config.useGpu === true;

  const labels = {
    app: name,
    'app.kubernetes.io/name': name,
    [PART_OF_LABEL]: PART_OF_VALUE,
  };

  // GPU on: signal the entrypoint to use hardware rendering and request a GPU device.
  // GPU off: force software (llvmpipe) — the entrypoint then uses headless EGL for sensors.
  const env = useGpu
    ? [{ name: 'PHYSICAL_AI_USE_GPU', value: '1' }]
    : [
        { name: 'LIBGL_ALWAYS_SOFTWARE', value: '1' },
        { name: 'GALLIUM_DRIVER', value: 'llvmpipe' },
      ];
  // Software (llvmpipe) rendering is CPU-bound: the Gazebo GUI client alone needs
  // ~2.3 cores just to render the scene, and during *active* Nav2 navigation the
  // planner/controller/costmaps add ~1 more, so total demand is ~3.6 cores. A
  // 2-core cap collapses the sim to ~0.1 real-time factor (goals never finish);
  // 4 cores let goals complete but sit at ~90% utilization, so RTF sags to
  // ~0.3-0.6 and the robot moves slowly and jerkily. 6 cores ran near real-time
  // but Gazebo/Ogre still size thread pools to the node's nproc (not the quota),
  // so bursts oversubscribe the quota and CFS throttling causes residual
  // micro-stutter. 8 guaranteed cores (the default) widen the quota so those
  // bursts fit, smoothing the stutter and leaving headroom for multi-robot
  // scenes. The count is configurable via `config.cpu` so users can dial it to
  // their node sizes (an 8-CPU Guaranteed pod only fits nodes with >=8 allocatable
  // — see story7-multipod-openshift-architecture.md). The complementary image-level
  // fix caps Ogre/GZ/OMP/llvmpipe thread pools to the quota so pools stop
  // oversubscribing at any core count. With a GPU only the *sensor* render moves
  // off the CPU — the GUI canvas is still software-rendered on a no-DRI cluster
  // (see entrypoint-gazebo.sh path 2), so the GPU pod still needs ~GPU_POD_CPU
  // cores (requests==limits) or the GUI throttles and the noVNC view never paints.
  const cpu = useGpu ? String(GPU_POD_CPU) : String(assertCpuCount(config.cpu ?? DEFAULT_SW_RENDER_CPU));
  const requests: Record<string, string> = { cpu, memory: '2Gi' };
  const limits: Record<string, string> = useGpu ? { cpu, memory: '4Gi', [GPU_RESOURCE]: '1' } : { cpu, memory: '4Gi' };

  // GPU nodes are usually tainted so only GPU workloads land there; tolerate the
  // taint or the pod sits Pending on the only nodes that have a GPU. Software pods
  // don't want a GPU node, so no toleration there.
  const tolerations = useGpu ? [parseGpuToleration(config.gpuToleration ?? DEFAULT_GPU_TOLERATION)] : undefined;

  const deployment = {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name, namespace, labels },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: name } },
      template: {
        metadata: { labels },
        spec: {
          ...(tolerations ? { tolerations } : {}),
          containers: [
            {
              name: 'sim',
              image,
              // Always: sim images iterate under a fixed tag (e.g. :noble-amd64); IfNotPresent
              // would serve a node-cached stale image after a re-push, hiding fixes.
              imagePullPolicy: 'Always',
              // ENTRYPOINT is /bin/bash; the gazebo entrypoint is the arg (mirrors local launch).
              command: ['/bin/bash', '/entrypoint-gazebo.sh'],
              env,
              ports: [{ name: 'novnc', containerPort: NOVNC_CONTAINER_PORT }],
              resources: {
                requests,
                limits,
              },
              readinessProbe: {
                tcpSocket: { port: NOVNC_CONTAINER_PORT },
                initialDelaySeconds: 20,
                periodSeconds: 10,
                failureThreshold: 12,
              },
            },
          ],
        },
      },
    },
  };

  const service = {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name, namespace, labels },
    spec: {
      selector: { app: name },
      ports: [{ name: 'novnc', port: NOVNC_CONTAINER_PORT, targetPort: NOVNC_CONTAINER_PORT }],
    },
  };

  const route = {
    apiVersion: 'route.openshift.io/v1',
    kind: 'Route',
    metadata: {
      name,
      namespace,
      labels,
      // noVNC is a long-lived WebSocket; the default 30s HAProxy timeout would sever
      // an idle canvas and make the sim "connect then drop". Keep the tunnel open.
      annotations: { 'haproxy.router.openshift.io/timeout': '3600s' },
    },
    spec: {
      to: { kind: 'Service', name },
      port: { targetPort: 'novnc' },
      tls: { termination: 'edge', insecureEdgeTerminationPolicy: 'Redirect' },
    },
  };

  return [deployment, service, route];
}

// --- Minimal YAML emitter (block style) for the preview only -------------------

/** True for null or undefined without using the `null` literal (lint: no-null). */
function isNullish(v: unknown): v is null | undefined {
  return (v ?? undefined) === undefined;
}

function isScalar(v: unknown): boolean {
  return isNullish(v) || typeof v !== 'object';
}

function yamlScalar(v: unknown): string {
  if (isNullish(v)) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // Double-quote every string (valid YAML flow scalar) so values like ports,
  // ':' in image refs, or leading '/' never get misparsed.
  return JSON.stringify(String(v));
}

function emit(value: unknown, indent: number): string {
  const pad = '  '.repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]\n`;
    let out = '';
    for (const item of value) {
      if (isScalar(item)) {
        out += `${pad}- ${yamlScalar(item)}\n`;
      } else if (Array.isArray(item)) {
        out += `${pad}-\n${emit(item, indent + 1)}`;
      } else {
        const entries = Object.entries(item as Record<string, unknown>).filter(([, v]) => v !== undefined);
        if (entries.length === 0) {
          out += `${pad}- {}\n`;
          continue;
        }
        entries.forEach(([k, v], i) => {
          const prefix = i === 0 ? `${pad}- ` : `${pad}  `;
          if (isScalar(v)) {
            out += `${prefix}${k}: ${yamlScalar(v)}\n`;
          } else if (Array.isArray(v) && v.length === 0) {
            out += `${prefix}${k}: []\n`;
          } else if (!Array.isArray(v) && Object.keys(v as object).length === 0) {
            out += `${prefix}${k}: {}\n`;
          } else {
            out += `${prefix}${k}:\n${emit(v, indent + 2)}`;
          }
        });
      }
    }
    return out;
  }

  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return `${pad}{}\n`;
  let out = '';
  for (const [k, v] of entries) {
    if (isScalar(v)) {
      out += `${pad}${k}: ${yamlScalar(v)}\n`;
    } else if (Array.isArray(v) && v.length === 0) {
      out += `${pad}${k}: []\n`;
    } else if (!Array.isArray(v) && Object.keys(v as object).length === 0) {
      out += `${pad}${k}: {}\n`;
    } else {
      out += `${pad}${k}:\n${emit(v, indent + 1)}`;
    }
  }
  return out;
}

/** Render one manifest object to a YAML document. */
export function toYaml(value: unknown): string {
  return emit(value, 0);
}

/** Render several manifests as a multi-document YAML string. */
export function manifestsToYaml(manifests: unknown[]): string {
  return manifests.map(m => toYaml(m)).join('---\n');
}
