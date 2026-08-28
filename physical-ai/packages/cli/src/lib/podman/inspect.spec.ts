import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./exec', () => ({ runPodman: vi.fn() }));

import { runPodman } from './exec';
import { getImageArchitecture } from './inspect';

describe('getImageArchitecture', () => {
  beforeEach(() => {
    vi.mocked(runPodman).mockReset();
  });

  it('runs podman image inspect with the Architecture format and trims the result', async () => {
    vi.mocked(runPodman).mockResolvedValue({ stdout: 'arm64\n', stderr: '' });

    await expect(getImageArchitecture('quay.io/ns/img:tag')).resolves.toBe('arm64');
    expect(runPodman).toHaveBeenCalledWith(['image', 'inspect', '--format', '{{.Architecture}}', 'quay.io/ns/img:tag']);
  });
});
