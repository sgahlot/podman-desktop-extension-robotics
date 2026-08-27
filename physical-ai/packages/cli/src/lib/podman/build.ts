import { spawnPodman } from './exec';

export interface BuildImageOptions {
  contextDir: string;
  containerFile: string;
  tag: string;
  buildArgs?: Record<string, string>;
  platform?: string;
}

/** CLI equivalent of the extension's `#runContainerBuild` (api-impl.ts) via `podman build`. */
export async function buildImage(options: BuildImageOptions, onOutput: (line: string) => void): Promise<void> {
  const args = ['build', '--file', options.containerFile, '--tag', options.tag];
  for (const [key, value] of Object.entries(options.buildArgs ?? {})) {
    args.push('--build-arg', `${key}=${value}`);
  }
  if (options.platform) {
    args.push('--platform', options.platform);
  }
  args.push(options.contextDir);
  await spawnPodman(args, onOutput);
}
