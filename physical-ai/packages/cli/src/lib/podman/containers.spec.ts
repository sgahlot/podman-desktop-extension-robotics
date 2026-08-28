import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./exec', () => ({ runPodman: vi.fn() }));

import { runPodman } from './exec';
import { listSimContainers, resolveSimContainer, stopContainer, hostPortForPrivate } from './containers';

beforeEach(() => {
  vi.mocked(runPodman).mockReset();
});

const SIM_CONTAINER = {
  Id: 'abcdef012345abcdef012345',
  Names: ['pai-sim-1'],
  Image: 'quay.io/ns/ros2-jazzy-sim:noble',
  State: 'running',
  Labels: { 'io.physical-ai.role': 'simulation' },
  Ports: [{ host_ip: '', container_port: 6080, host_port: 6080, protocol: 'tcp' }],
};

const OTHER_CONTAINER = {
  Id: 'ffffff999999ffffff999999',
  Names: ['unrelated'],
  Image: 'other:latest',
  State: 'exited',
  Labels: {},
  Ports: undefined,
};

describe('listSimContainers', () => {
  it('filters to labeled containers and maps podman-native fields', async () => {
    vi.mocked(runPodman).mockResolvedValue({ stdout: JSON.stringify([SIM_CONTAINER, OTHER_CONTAINER]), stderr: '' });

    await expect(listSimContainers()).resolves.toEqual([
      {
        id: 'abcdef012345abcdef012345',
        name: 'pai-sim-1',
        imageTag: 'quay.io/ns/ros2-jazzy-sim:noble',
        state: 'running',
        ports: ['6080:6080/tcp'],
        labels: { 'io.physical-ai.role': 'simulation' },
      },
    ]);
    expect(runPodman).toHaveBeenCalledWith(['ps', '-a', '--format', 'json']);
  });
});

describe('resolveSimContainer', () => {
  it('rejects an id shorter than 12 characters', async () => {
    await expect(resolveSimContainer('short')).rejects.toThrow(/at least 12 characters/);
  });

  it('rejects when no container matches', async () => {
    vi.mocked(runPodman).mockResolvedValue({ stdout: JSON.stringify([OTHER_CONTAINER]), stderr: '' });
    await expect(resolveSimContainer('abcdef012345')).rejects.toThrow(/Not a Physical AI simulation container/);
  });

  it('rejects a container missing the sim label', async () => {
    vi.mocked(runPodman).mockResolvedValue({ stdout: JSON.stringify([OTHER_CONTAINER]), stderr: '' });
    await expect(resolveSimContainer('ffffff999999')).rejects.toThrow(/Not a Physical AI simulation container/);
  });

  it('resolves a matching labeled container by id prefix', async () => {
    vi.mocked(runPodman).mockResolvedValue({ stdout: JSON.stringify([SIM_CONTAINER]), stderr: '' });
    await expect(resolveSimContainer('abcdef012345')).resolves.toEqual({
      id: 'abcdef012345abcdef012345',
      image: 'quay.io/ns/ros2-jazzy-sim:noble',
      ports: ['6080:6080/tcp'],
    });
  });
});

describe('hostPortForPrivate', () => {
  it('finds the host port mapped to a given container-private port', () => {
    expect(hostPortForPrivate(['16080:6080/tcp', '8080:8080/tcp'], 6080)).toBe(16080);
  });

  it('falls back to the private port itself when no mapping is found', () => {
    expect(hostPortForPrivate(['8080:8080/tcp'], 6080)).toBe(6080);
  });
});

describe('stopContainer', () => {
  it('resolves then stops the matched container id', async () => {
    vi.mocked(runPodman)
      .mockResolvedValueOnce({ stdout: JSON.stringify([SIM_CONTAINER]), stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' });

    await stopContainer('abcdef012345');
    expect(runPodman).toHaveBeenNthCalledWith(2, ['stop', 'abcdef012345abcdef012345']);
  });
});
