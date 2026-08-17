import { describe, it, expect } from 'vitest';
import {
  buildOpenShiftManifests,
  assertK8sName,
  assertNamespace,
  assertImageRef,
  parseGpuToleration,
  toYaml,
  manifestsToYaml,
  NOVNC_CONTAINER_PORT,
  PART_OF_LABEL,
  PART_OF_VALUE,
} from './manifests';
import type { OpenShiftDeployConfig } from '../types/OpenShiftDeploy';

// Minimal structural shapes for the manifest objects under test, so assertions
// can drill in without `any`.
interface DeploymentManifest {
  spec: {
    template: {
      spec: {
        tolerations?: { key: string; operator: string; value?: string; effect: string }[];
        containers: {
          image: string;
          command: string[];
          env: { name: string; value: string }[];
          ports: { containerPort: number }[];
          readinessProbe: { tcpSocket: { port: number } };
          resources: { requests: Record<string, string>; limits: Record<string, string> };
        }[];
      };
    };
  };
}
interface ServiceManifest {
  spec: { ports: { port: number }[] };
}
interface RouteManifest {
  spec: {
    to: { kind: string; name: string };
    port: { targetPort: string };
    tls: { termination: string };
  };
}

describe('assertK8sName', () => {
  it('accepts a valid DNS-1123 label', () => {
    expect(assertK8sName('ros2-jazzy-sim')).toBe('ros2-jazzy-sim');
    expect(assertK8sName('a')).toBe('a');
    expect(assertK8sName('a1b2')).toBe('a1b2');
  });

  it('rejects invalid names', () => {
    expect(() => assertK8sName('')).toThrow();
    expect(() => assertK8sName('Bad_Name')).toThrow();
    expect(() => assertK8sName('-leading')).toThrow();
    expect(() => assertK8sName('trailing-')).toThrow();
    expect(() => assertK8sName('UPPER')).toThrow();
    expect(() => assertK8sName('a'.repeat(64))).toThrow();
    // shell metacharacter / injection attempt
    expect(() => assertK8sName('name;rm -rf /')).toThrow();
  });

  it('uses the label in the error message', () => {
    expect(() => assertNamespace('Bad NS')).toThrow(/namespace/);
  });
});

describe('assertImageRef', () => {
  it('accepts common image refs', () => {
    expect(assertImageRef('quay.io/ecosystem-appeng/ros2-jazzy-sim:noble-amd64')).toBe(
      'quay.io/ecosystem-appeng/ros2-jazzy-sim:noble-amd64',
    );
    expect(assertImageRef('docker.io/library/nginx')).toBeTruthy();
    expect(assertImageRef('registry:5000/team/app:1.2.3')).toBeTruthy();
    expect(assertImageRef('quay.io/ns/img@sha256:' + 'a'.repeat(64))).toBeTruthy();
  });

  it('rejects refs with whitespace or shell metacharacters', () => {
    expect(() => assertImageRef('')).toThrow();
    expect(() => assertImageRef('quay.io/ns/img:tag; rm -rf /')).toThrow();
    expect(() => assertImageRef('quay.io/ns/img tag')).toThrow();
    expect(() => assertImageRef('$(evil)')).toThrow();
  });
});

describe('buildOpenShiftManifests', () => {
  const config: OpenShiftDeployConfig = {
    name: 'ros2-jazzy-sim',
    namespace: 'sgahlot-pd-extn',
    image: 'quay.io/ecosystem-appeng/ros2-jazzy-sim:noble-amd64',
  };

  it('returns Deployment, Service and Route in order', () => {
    const manifests = buildOpenShiftManifests(config);
    expect(manifests.map(m => m.kind)).toEqual(['Deployment', 'Service', 'Route']);
  });

  it('labels every resource as part-of physical-ai', () => {
    for (const m of buildOpenShiftManifests(config)) {
      const meta = m.metadata as { labels: Record<string, string>; namespace: string; name: string };
      expect(meta.labels[PART_OF_LABEL]).toBe(PART_OF_VALUE);
      expect(meta.namespace).toBe(config.namespace);
      expect(meta.name).toBe(config.name);
    }
  });

  it('configures the container for software rendering on the noVNC port', () => {
    const [deployment] = buildOpenShiftManifests(config);
    const container = (deployment as unknown as DeploymentManifest).spec.template.spec.containers[0];
    expect(container.image).toBe(config.image);
    expect(container.command).toEqual(['/bin/bash', '/entrypoint-gazebo.sh']);
    const env = Object.fromEntries(container.env.map(e => [e.name, e.value]));
    expect(env.LIBGL_ALWAYS_SOFTWARE).toBe('1');
    expect(env.GALLIUM_DRIVER).toBe('llvmpipe');
    expect(container.ports[0].containerPort).toBe(NOVNC_CONTAINER_PORT);
    expect(container.readinessProbe.tcpSocket.port).toBe(NOVNC_CONTAINER_PORT);
  });

  it('does not request a GPU by default (software rendering)', () => {
    const [deployment] = buildOpenShiftManifests(config);
    const container = (deployment as unknown as DeploymentManifest).spec.template.spec.containers[0];
    expect(container.resources.limits['nvidia.com/gpu']).toBeUndefined();
  });

  it('guarantees 8 CPUs by default for software rendering so navigation runs smoothly', () => {
    // llvmpipe on 2 cores collapses RTF to ~0.1 (goals never finish); 4 cores let
    // goals complete but sit at ~90% utilization during active nav, so RTF sags to
    // ~0.3-0.6 and motion is slow/jerky. 6 cores ran near real-time but Gazebo/Ogre
    // thread pools (sized to nproc, not the quota) still burst past it, so CFS
    // throttling left residual micro-stutter. 8 guaranteed cores (requests ==
    // limits) widen the quota so those bursts fit, with headroom for multi-robot.
    const [deployment] = buildOpenShiftManifests(config);
    const container = (deployment as unknown as DeploymentManifest).spec.template.spec.containers[0];
    expect(container.resources.requests.cpu).toBe('8');
    expect(container.resources.limits.cpu).toBe('8');
  });

  it('honours a configurable software-render CPU count (requests == limits)', () => {
    const [deployment] = buildOpenShiftManifests({ ...config, cpu: 6 });
    const container = (deployment as unknown as DeploymentManifest).spec.template.spec.containers[0];
    expect(container.resources.requests.cpu).toBe('6');
    expect(container.resources.limits.cpu).toBe('6');
  });

  it('rejects an invalid CPU count', () => {
    expect(() => buildOpenShiftManifests({ ...config, cpu: 0 })).toThrow();
    expect(() => buildOpenShiftManifests({ ...config, cpu: 2.5 })).toThrow();
    expect(() => buildOpenShiftManifests({ ...config, cpu: 128 })).toThrow();
  });

  it('ignores the configurable CPU count under GPU (uses the fixed GPU-pod CPU)', () => {
    // The user CPU field is software-render only; the GPU pod's CPU is bounded by
    // the GPU node size, not preference, so config.cpu is ignored here.
    const [deployment] = buildOpenShiftManifests({ ...config, useGpu: true, cpu: 16 });
    const container = (deployment as unknown as DeploymentManifest).spec.template.spec.containers[0];
    expect(container.resources.requests.cpu).toBe('6');
    expect(container.resources.limits.cpu).toBe('6');
  });

  it('requests a GPU and uses hardware rendering when useGpu is set', () => {
    const [deployment] = buildOpenShiftManifests({ ...config, useGpu: true });
    const container = (deployment as unknown as DeploymentManifest).spec.template.spec.containers[0];
    const env = Object.fromEntries(container.env.map(e => [e.name, e.value]));
    // Software-rendering env is dropped; the entrypoint uses hardware rendering.
    expect(env.LIBGL_ALWAYS_SOFTWARE).toBeUndefined();
    expect(env.GALLIUM_DRIVER).toBeUndefined();
    expect(env.PHYSICAL_AI_USE_GPU).toBe('1');
    expect(container.resources.limits['nvidia.com/gpu']).toBe('1');
    // The GPU offloads only sensor rendering; the GUI stays software on a no-DRI
    // cluster, so the pod is guaranteed GPU_POD_CPU cores (requests == limits).
    expect(container.resources.requests.cpu).toBe('6');
    expect(container.resources.limits.cpu).toBe('6');
  });

  it('tolerates the default GPU-node taint when useGpu is set', () => {
    const [deployment] = buildOpenShiftManifests({ ...config, useGpu: true });
    const spec = (deployment as unknown as DeploymentManifest).spec.template.spec;
    expect(spec.tolerations).toEqual([{ key: 'g5-gpu', operator: 'Equal', value: 'true', effect: 'NoSchedule' }]);
  });

  it('honors a custom GPU toleration', () => {
    const [deployment] = buildOpenShiftManifests({
      ...config,
      useGpu: true,
      gpuToleration: 'nvidia.com/gpu:NoSchedule',
    });
    const spec = (deployment as unknown as DeploymentManifest).spec.template.spec;
    expect(spec.tolerations).toEqual([{ key: 'nvidia.com/gpu', operator: 'Exists', effect: 'NoSchedule' }]);
  });

  it('adds no toleration on the software-render path', () => {
    const spec = (buildOpenShiftManifests(config)[0] as unknown as DeploymentManifest).spec.template.spec;
    expect(spec.tolerations).toBeUndefined();
  });

  it('rejects an invalid GPU toleration', () => {
    expect(() => buildOpenShiftManifests({ ...config, useGpu: true, gpuToleration: '' })).toThrow();
    expect(() => buildOpenShiftManifests({ ...config, useGpu: true, gpuToleration: 'BAD KEY=x' })).toThrow();
  });

  it('exposes the noVNC port via an edge-terminated Route', () => {
    const [, service, route] = buildOpenShiftManifests(config);
    expect((service as unknown as ServiceManifest).spec.ports[0].port).toBe(NOVNC_CONTAINER_PORT);
    expect((route as unknown as RouteManifest).spec.to).toEqual({ kind: 'Service', name: config.name });
    expect((route as unknown as RouteManifest).spec.port.targetPort).toBe('novnc');
    expect((route as unknown as RouteManifest).spec.tls.termination).toBe('edge');
  });

  it('keeps the noVNC WebSocket alive with a long Route timeout', () => {
    const [, , route] = buildOpenShiftManifests(config);
    expect(
      (route as unknown as { metadata: { annotations?: Record<string, string> } }).metadata.annotations?.[
        'haproxy.router.openshift.io/timeout'
      ],
    ).toBe('3600s');
  });

  it('validates inputs', () => {
    expect(() => buildOpenShiftManifests({ ...config, name: 'BAD' })).toThrow();
    expect(() => buildOpenShiftManifests({ ...config, namespace: 'BAD NS' })).toThrow();
    expect(() => buildOpenShiftManifests({ ...config, image: 'evil; rm -rf /' })).toThrow();
  });
});

describe('parseGpuToleration', () => {
  it('parses key=value:effect as an Equal toleration', () => {
    expect(parseGpuToleration('g5-gpu=true:NoSchedule')).toEqual({
      key: 'g5-gpu',
      operator: 'Equal',
      value: 'true',
      effect: 'NoSchedule',
    });
  });

  it('parses a bare key:effect as an Exists toleration', () => {
    expect(parseGpuToleration('nvidia.com/gpu:NoExecute')).toEqual({
      key: 'nvidia.com/gpu',
      operator: 'Exists',
      effect: 'NoExecute',
    });
  });

  it('defaults the effect to NoSchedule when omitted', () => {
    expect(parseGpuToleration('g5-gpu=true')).toEqual({
      key: 'g5-gpu',
      operator: 'Equal',
      value: 'true',
      effect: 'NoSchedule',
    });
  });

  it('does not treat a prefixed key as an effect', () => {
    // The ':' split only fires for a known effect, so nvidia.com/gpu stays whole.
    expect(parseGpuToleration('nvidia.com/gpu')).toEqual({
      key: 'nvidia.com/gpu',
      operator: 'Exists',
      effect: 'NoSchedule',
    });
  });

  it('rejects empty or malformed specs', () => {
    expect(() => parseGpuToleration('')).toThrow();
    expect(() => parseGpuToleration('   ')).toThrow();
    expect(() => parseGpuToleration('bad key=x')).toThrow();
  });
});

describe('toYaml / manifestsToYaml', () => {
  it('quotes strings and leaves numbers/booleans bare', () => {
    // Genuine runtime null without writing the `null` literal (lint: no-null);
    // the emitter should render it as the string "null".
    const nullValue = JSON.parse('null') as null;
    const yaml = toYaml({ a: 'hello', b: 42, c: true, d: nullValue });
    expect(yaml).toContain('a: "hello"');
    expect(yaml).toContain('b: 42');
    expect(yaml).toContain('c: true');
    expect(yaml).toContain('d: null');
  });

  it('renders nested maps and lists in block style', () => {
    const yaml = toYaml({ spec: { ports: [{ name: 'novnc', port: 6080 }] } });
    expect(yaml).toContain('spec:\n');
    expect(yaml).toContain('  ports:\n');
    expect(yaml).toContain('    - name: "novnc"\n');
    expect(yaml).toContain('      port: 6080\n');
  });

  it('quotes values with special characters so they never misparse', () => {
    const yaml = toYaml({ image: 'quay.io/ns/img:tag', path: '/entrypoint.sh' });
    expect(yaml).toContain('image: "quay.io/ns/img:tag"');
    expect(yaml).toContain('path: "/entrypoint.sh"');
  });

  it('joins multiple documents with a --- separator', () => {
    const manifests = buildOpenShiftManifests({
      name: 'sim',
      namespace: 'proj',
      image: 'quay.io/ns/sim:noble-amd64',
    });
    const yaml = manifestsToYaml(manifests);
    expect(yaml.split('---\n')).toHaveLength(3);
    expect(yaml).toContain('kind: "Deployment"');
    expect(yaml).toContain('kind: "Service"');
    expect(yaml).toContain('kind: "Route"');
  });

  it('renders empty arrays and objects inline', () => {
    expect(toYaml({ a: [], b: {} })).toContain('a: []');
    expect(toYaml({ a: [], b: {} })).toContain('b: {}');
  });
});
