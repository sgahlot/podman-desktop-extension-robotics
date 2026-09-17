import * as extensionApi from '@podman-desktop/api';
import { access, cp } from 'node:fs/promises';
import { join as pathJoin } from 'node:path';

const SIM_RUNTIME_FILES = ['entrypoint-gazebo.sh', 'entrypoint-spawn-robot.sh', 'entrypoint-nav2.sh'] as const;
const SIM_RUNTIME_DIRS = ['lib', 'worlds', 'www', 'config'] as const;

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a bundled asset directory shipped with the extension (`assets/<name>/`).
 * Tries `extensionUri/assets/<name>` first, then `../assets/<name>` when `extensionUri`
 * points at `dist/` (local Vite output layout).
 */
export async function resolveBundledAssetDir(extensionUri: extensionApi.Uri, assetDir: string): Promise<string> {
  const candidates = [
    extensionApi.Uri.joinPath(extensionUri, 'assets', assetDir).fsPath,
    pathJoin(extensionUri.fsPath, '..', 'assets', assetDir),
  ];

  for (const candidate of candidates) {
    if (await pathExists(pathJoin(candidate, 'Containerfile'))) {
      return candidate;
    }
  }

  throw new Error(
    `Bundled container assets "${assetDir}" were not found under the extension install path. ` +
      'Reinstall or update the Robotics extension image — the OCI bundle must include assets/.',
  );
}

/**
 * Copy a full bundled asset tree into `destDir` so Podman can use it as a build context.
 * The extension host process can read `extensionUri`, but Podman (especially via Podman
 * Machine on macOS) cannot always use that path as `-c` — stage to tmpdir/storage instead.
 */
export async function stageBundledAssetDir(
  extensionUri: extensionApi.Uri,
  assetDir: string,
  destDir: string,
): Promise<void> {
  const source = await resolveBundledAssetDir(extensionUri, assetDir);
  await cp(source, destDir, { recursive: true });
}

/** Copy only the sim operational files (entrypoints, worlds, helpers) into a layer build context. */
export async function stageSimRuntimeAssetFiles(
  extensionUri: extensionApi.Uri,
  assetDir: string,
  destDir: string,
): Promise<void> {
  const source = await resolveBundledAssetDir(extensionUri, assetDir);
  for (const file of SIM_RUNTIME_FILES) {
    await cp(pathJoin(source, file), pathJoin(destDir, file));
  }
  for (const dir of SIM_RUNTIME_DIRS) {
    await cp(pathJoin(source, dir), pathJoin(destDir, dir), { recursive: true });
  }
}
