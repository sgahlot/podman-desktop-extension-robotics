import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./exec', () => ({ runPodman: vi.fn() }));
vi.mock('./containers', () => ({ resolveSimContainer: vi.fn() }));

import { runPodman } from './exec';
import { resolveSimContainer } from './containers';
import { spawnRobot } from './spawnRobot';

describe('spawnRobot', () => {
  beforeEach(() => {
    vi.mocked(resolveSimContainer)
      .mockReset()
      .mockResolvedValue({ id: 'abcdef012345abcdef012345', image: 'quay.io/ns/ros2-jazzy-sim:noble', ports: [] });
    vi.mocked(runPodman).mockReset().mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('execs the spawn entrypoint with the resolved container id and validated argv', async () => {
    await spawnRobot('abcdef012345', 'robot1', '1.0', '2.0', '0.5');
    expect(runPodman).toHaveBeenCalledWith([
      'exec',
      '-d',
      'abcdef012345abcdef012345',
      '/entrypoint-spawn-robot.sh',
      'robot1',
      '1.0',
      '2.0',
      '0.5',
    ]);
  });

  it('rejects an invalid robot name before exec-ing', async () => {
    await expect(spawnRobot('abcdef012345', 'bad name!', '1', '2', '0')).rejects.toThrow(/Invalid robot name/);
    expect(runPodman).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric x before exec-ing', async () => {
    await expect(spawnRobot('abcdef012345', 'robot1', 'abc', '2', '0')).rejects.toThrow(/Invalid x/);
    expect(runPodman).not.toHaveBeenCalled();
  });
});
