import * as path from 'node:path';
import { spawnPodman } from './exec';

export interface BuildImageOptions {
  contextDir: string;
  containerFile: string;
  tag: string;
  buildArgs?: Record<string, string>;
  platform?: string;
}

/**
 * CLI equivalent of the extension's `#runContainerBuild` (api-impl.ts) via `podman build`.
 *
 * `podman build --file` (like `docker build -f`), when given a relative path, resolves it
 * relative to the CLI's own cwd — NOT relative to the context directory. Joining contextDir
 * into the --file argument here avoids that footgun; without it, running this command from a
 * directory that happens to have its own `Containerfile` (e.g. this repo's root, which has one
 * for packaging the extension itself) silently builds the wrong file.
 */
export async function buildImage(options: BuildImageOptions, onOutput: (line: string) => void): Promise<void> {
  const containerFilePath = path.join(options.contextDir, options.containerFile);
  const args = ['build', '--file', containerFilePath, '--tag', options.tag];
  for (const [key, value] of Object.entries(options.buildArgs ?? {})) {
    args.push('--build-arg', `${key}=${value}`);
  }
  if (options.platform) {
    args.push('--platform', options.platform);
  }
  args.push(options.contextDir);
  await spawnPodman(args, onOutput);
}
