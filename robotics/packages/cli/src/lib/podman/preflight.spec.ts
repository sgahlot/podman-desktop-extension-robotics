import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./exec', () => ({
  runPodman: vi.fn(),
  PodmanCliError: class PodmanCliError extends Error {
    readonly exitCode: number;
    readonly stdoutOutput: string;
    readonly stderrOutput: string;
    constructor(message: string, exitCode: number, stdoutOutput: string, stderrOutput: string) {
      super(message);
      this.exitCode = exitCode;
      this.stdoutOutput = stdoutOutput;
      this.stderrOutput = stderrOutput;
    }
  },
}));

import { PodmanCliError, runPodman } from './exec';
import { assertPodmanAvailable } from './preflight';

describe('assertPodmanAvailable', () => {
  beforeEach(() => {
    vi.mocked(runPodman).mockReset();
  });

  it('resolves when podman info succeeds', async () => {
    vi.mocked(runPodman).mockResolvedValue({ stdout: '{}', stderr: '' });
    await expect(assertPodmanAvailable()).resolves.toBeUndefined();
    expect(runPodman).toHaveBeenCalledWith(['info', '--format', 'json']);
  });

  it('throws a friendly error when podman is unavailable', async () => {
    vi.mocked(runPodman).mockRejectedValue(new PodmanCliError('podman info failed', 1, '', 'command not found'));
    await expect(assertPodmanAvailable()).rejects.toThrow(/No running Podman connection found/);
  });
});
