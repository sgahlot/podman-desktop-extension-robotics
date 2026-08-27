import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./exec', () => ({ spawnPodman: vi.fn() }));

import { spawnPodman } from './exec';
import { buildImage } from './build';

describe('buildImage', () => {
  beforeEach(() => {
    vi.mocked(spawnPodman).mockReset().mockResolvedValue(undefined);
  });

  it('builds podman build argv with build-args and platform', async () => {
    const onOutput = vi.fn();
    await buildImage(
      {
        contextDir: '/ctx',
        containerFile: 'Containerfile',
        tag: 'my-tag:latest',
        buildArgs: { ROS_BASE_IMAGE: 'ghcr.io/foo:bar' },
        platform: 'linux/amd64',
      },
      onOutput,
    );

    expect(spawnPodman).toHaveBeenCalledWith(
      [
        'build',
        '--file',
        '/ctx/Containerfile',
        '--tag',
        'my-tag:latest',
        '--build-arg',
        'ROS_BASE_IMAGE=ghcr.io/foo:bar',
        '--platform',
        'linux/amd64',
        '/ctx',
      ],
      onOutput,
    );
  });

  it('omits --build-arg and --platform when not given', async () => {
    await buildImage({ contextDir: '/ctx', containerFile: 'Containerfile', tag: 'tag' }, vi.fn());
    expect(spawnPodman).toHaveBeenCalledWith(
      ['build', '--file', '/ctx/Containerfile', '--tag', 'tag', '/ctx'],
      expect.any(Function),
    );
  });

  it('joins a nested containerFile path under contextDir, not the CLI process cwd', async () => {
    await buildImage({ contextDir: '/ctx', containerFile: 'sub/Containerfile.custom', tag: 'tag' }, vi.fn());
    expect(spawnPodman).toHaveBeenCalledWith(
      ['build', '--file', '/ctx/sub/Containerfile.custom', '--tag', 'tag', '/ctx'],
      expect.any(Function),
    );
  });
});
