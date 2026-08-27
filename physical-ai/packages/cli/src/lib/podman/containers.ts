import { runPodman } from './exec';
import {
  SIM_CONTAINER_LABEL,
  SIM_CONTAINER_LABEL_VALUE,
  type SimContainerInfo,
} from '../../../../shared/src/types/SimulationContainer';

/**
 * Shape of one entry from `podman ps -a --format json` (podman 6.x). Field names/casing
 * (snake_case `Ports` entries in particular) are podman-native, NOT the Docker-Engine-API
 * shape `containerEngine.listContainers()` returns in the extension — verified live against
 * a running podman 6.0.2 install; re-verify if the target podman version differs materially.
 */
interface PodmanPsEntry {
  Id: string;
  Names?: string[];
  Image?: string;
  State?: string;
  Labels?: Record<string, string>;
  Ports?: Array<{ host_ip: string; container_port: number; host_port: number; protocol: string }> | null;
}

async function listAllContainers(): Promise<PodmanPsEntry[]> {
  const { stdout } = await runPodman(['ps', '-a', '--format', 'json']);
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  return JSON.parse(trimmed) as PodmanPsEntry[];
}

function toSimState(state: string | undefined): SimContainerInfo['state'] {
  if (state === 'running') return 'running';
  if (state === 'exited') return 'exited';
  if (state === 'stopped') return 'stopped';
  return 'unknown';
}

function toSimContainerInfo(entry: PodmanPsEntry): SimContainerInfo {
  return {
    id: entry.Id,
    name: entry.Names?.[0] ?? entry.Id.slice(0, 12),
    imageTag: entry.Image ?? '',
    state: toSimState(entry.State),
    ports: (entry.Ports ?? []).map(p => `${p.host_port}:${p.container_port}/${p.protocol}`),
    labels: entry.Labels ?? {},
  };
}

/** CLI equivalent of the extension's `listSimulationContainers`. */
export async function listSimContainers(): Promise<SimContainerInfo[]> {
  const containers = await listAllContainers();
  return containers.filter(c => c.Labels?.[SIM_CONTAINER_LABEL] === SIM_CONTAINER_LABEL_VALUE).map(toSimContainerInfo);
}

/** CLI equivalent of the extension's `#resolveSimulationContainer`. */
export async function resolveSimContainer(containerId: string): Promise<{ id: string; image: string }> {
  if (!containerId || containerId.length < 12) {
    throw new Error('Container id must be at least 12 characters.');
  }
  const containers = await listAllContainers();
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
  return { id: match.Id, image: match.Image ?? '' };
}

/** CLI equivalent of the extension's `stopSimulation`. */
export async function stopContainer(containerId: string): Promise<void> {
  const { id } = await resolveSimContainer(containerId);
  await runPodman(['stop', id]);
}
