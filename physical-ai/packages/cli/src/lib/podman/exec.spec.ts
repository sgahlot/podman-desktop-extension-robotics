import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

import { execFile, spawn } from 'node:child_process';
import { PodmanCliError, runPodman, spawnPodman } from './exec';

type ExecFileCallback = (error: unknown, stdout: string, stderr: string) => void;

function fakeChild(): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter } {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

describe('runPodman', () => {
  beforeEach(() => {
    vi.mocked(execFile).mockReset();
  });

  it('resolves with stdout/stderr on success', async () => {
    vi.mocked(execFile).mockImplementation((_file, _args, _options, callback) => {
      (callback as ExecFileCallback)(undefined, 'out', 'err');
      return undefined as never;
    });

    await expect(runPodman(['info'])).resolves.toEqual({ stdout: 'out', stderr: 'err' });
    expect(execFile).toHaveBeenCalledWith('podman', ['info'], { maxBuffer: 32 * 1024 * 1024 }, expect.any(Function));
  });

  it('rejects with a PodmanCliError carrying exit code and stderr on failure', async () => {
    vi.mocked(execFile).mockImplementation((_file, _args, _options, callback) => {
      const error = Object.assign(new Error('boom'), { code: 125 });
      (callback as ExecFileCallback)(error, '', 'no such container');
      return undefined as never;
    });

    await expect(runPodman(['stop', 'x'])).rejects.toMatchObject({
      exitCode: 125,
      stderrOutput: 'no such container',
    });
  });

  it('includes stderr content in the error message, not just the exit summary', async () => {
    vi.mocked(execFile).mockImplementation((_file, _args, _options, callback) => {
      const error = Object.assign(new Error('boom'), { code: 125 });
      (callback as ExecFileCallback)(error, '', 'no such container');
      return undefined as never;
    });

    await expect(runPodman(['stop', 'x'])).rejects.toThrow(/no such container/);
  });
});

describe('spawnPodman', () => {
  it('forwards stdout lines and resolves on exit code 0', async () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const lines: string[] = [];
    const promise = spawnPodman(['build'], line => lines.push(line));
    child.stdout.emit('data', Buffer.from('STEP 1/2\n\n'));
    child.emit('close', 0);

    await expect(promise).resolves.toBeUndefined();
    expect(lines).toEqual(['STEP 1/2']);
    expect(spawn).toHaveBeenCalledWith('podman', ['build']);
  });

  it('rejects with a PodmanCliError on non-zero exit', async () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = spawnPodman(['build'], () => {});
    child.stderr.emit('data', Buffer.from('boom'));
    child.emit('close', 1);

    await expect(promise).rejects.toBeInstanceOf(PodmanCliError);
  });

  it('includes stdout content in the error message — podman build writes the actual failing RUN step output (e.g. an apt error) to stdout, only a generic wrapper to stderr', async () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);

    const promise = spawnPodman(['build'], () => {});
    child.stdout.emit('data', Buffer.from('E: Unable to locate package ros-humble-ros-gz\n'));
    child.stderr.emit('data', Buffer.from('Error: building at STEP "RUN ...": exit status 100\n'));
    child.emit('close', 100);

    await expect(promise).rejects.toThrow(/Unable to locate package ros-humble-ros-gz/);
  });
});
