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

const ERROR_CONTEXT_LINES = 20;

/**
 * Appends the last few non-empty lines of output to an error message — without this, a bare
 * "podman build exited with code 100" tells the user nothing about what actually failed, and
 * Listr2's progress UI clears its scrolling output window once the task finishes.
 */
function withContext(message: string, output: string): string {
  const lines = output
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
  if (lines.length === 0) return message;
  return `${message}\n${lines.slice(-ERROR_CONTEXT_LINES).join('\n')}`;
}

/** Runs a podman CLI subcommand to completion and returns its captured output. */
export function runPodman(args: string[]): Promise<PodmanExecResult> {
  return new Promise((resolve, reject) => {
    execFile('podman', args, { maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const exitCode = typeof error.code === 'number' ? error.code : 1;
        // podman/buildah splits output unpredictably across streams (e.g. `podman build`
        // writes RUN-step output, including the actual failing command's error text, to
        // stdout, and only a generic step-wrapper message to stderr) — combine both so the
        // real cause isn't dropped.
        const message = withContext(`podman ${args[0] ?? ''} failed: ${error.message}`, `${stdout}\n${stderr}`);
        reject(new PodmanCliError(message, exitCode, stdout, stderr));
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
    let combinedOutput = '';

    const forwardLines = (chunk: Buffer): void => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.trim().length > 0) onLine(line);
      }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      combinedOutput += chunk.toString('utf8');
      forwardLines(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrOutput += chunk.toString('utf8');
      combinedOutput += chunk.toString('utf8');
      forwardLines(chunk);
    });

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        // See the comment in runPodman above — the useful error text (e.g. an apt failure
        // inside a RUN step) is typically on stdout, not stderr, so use the combined stream.
        const message = withContext(`podman ${args[0] ?? ''} exited with code ${code}`, combinedOutput);
        reject(new PodmanCliError(message, code ?? 1, '', stderrOutput));
      }
    });
  });
}
