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
  // ~0.3-0.6 and the robot moves slowly and jerkily. 6 guaranteed cores keep
  // ~60% utilization with headroom, so navigation runs smoothly at ~real-time.
  // With a GPU the render load moves off the CPU, so 2 cores is plenty.
  const requests: Record<string, string> = useGpu ? { cpu: '1', memory: '2Gi' } : { cpu: '6', memory: '2Gi' };
  const limits: Record<string, string> = useGpu
    ? { cpu: '2', memory: '4Gi', [GPU_RESOURCE]: '1' }
    : { cpu: '6', memory: '4Gi' };

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
