import { execFile, spawn } from 'node:child_process';

export interface PodmanExecResult {
  stdout: string;
  stderr: string;
}

export class PodmanCliError extends Error {
  readonly exitCode: number;
  readonly stdoutOutput: string;
  readonly stderrOutput: string;

  constructor(message: string, exitCode: number, stdoutOutput: string, stderrOutput: string) {
    super(message);
    this.name = 'PodmanCliError';
    this.exitCode = exitCode;
    this.stdoutOutput = stdoutOutput;
    this.stderrOutput = stderrOutput;
  }
}

/** Runs a podman CLI subcommand to completion and returns its captured output. */
export function runPodman(args: string[]): Promise<PodmanExecResult> {
  return new Promise((resolve, reject) => {
    execFile('podman', args, { maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const exitCode = typeof error.code === 'number' ? error.code : 1;
        reject(new PodmanCliError(`podman ${args[0] ?? ''} failed: ${error.message}`, exitCode, stdout, stderr));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/** Runs a podman CLI subcommand, forwarding stdout/stderr line-by-line as it streams. */
export function spawnPodman(args: string[], onLine: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('podman', args);
    let stderrOutput = '';

    const forwardLines = (chunk: Buffer): void => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.trim().length > 0) onLine(line);
      }
    };

    child.stdout.on('data', forwardLines);
    child.stderr.on('data', (chunk: Buffer) => {
      stderrOutput += chunk.toString('utf8');
      forwardLines(chunk);
    });

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new PodmanCliError(`podman ${args[0] ?? ''} exited with code ${code}`, code ?? 1, '', stderrOutput));
      }
    });
  });
}
