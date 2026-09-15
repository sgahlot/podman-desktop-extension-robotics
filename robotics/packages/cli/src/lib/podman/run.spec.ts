import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./exec', () => ({ runPodman: vi.fn() }));

import { runPodman } from './exec';
import { runContainer } from './run';

describe('runContainer', () => {
  beforeEach(() => {
    vi.mocked(runPodman).mockReset().mockResolvedValue({ stdout: 'abc123\n', stderr: '' });
  });

  it('builds podman run argv and returns the trimmed container id', async () => {
    const id = await runContainer({
      image: 'img:tag',
      name: 'pai-sim-1',
      cmd: ['/entrypoint-gazebo.sh'],
      env: { PHYSICAL_AI_USE_GPU: '1' },
      labels: { 'io.physical-ai.role': 'simulation' },
      portMappings: [{ hostPort: 6080, containerPort: 6080, protocol: 'tcp' }],
      devices: [{ pathOnHost: '/dev/dri/card0', pathInContainer: '/dev/dri/card0', cgroupPermissions: 'rwm' }],
    });

    expect(id).toBe('abc123');
    expect(runPodman).toHaveBeenCalledWith([
      'run',
      '-d',
      '--name',
      'pai-sim-1',
      '-p',
      '6080:6080/tcp',
      '-e',
      'PHYSICAL_AI_USE_GPU=1',
      '--label',
      'io.physical-ai.role=simulation',
      '--device',
      '/dev/dri/card0:/dev/dri/card0:rwm',
      'img:tag',
      '/entrypoint-gazebo.sh',
    ]);
  });

  it('omits --device when no devices are given', async () => {
    await runContainer({
      image: 'img:tag',
      name: 'pai-sim-2',
      cmd: ['/entrypoint-gazebo.sh'],
      env: {},
      labels: {},
      portMappings: [],
    });

    expect(runPodman).toHaveBeenCalledWith(['run', '-d', '--name', 'pai-sim-2', 'img:tag', '/entrypoint-gazebo.sh']);
  });
});
