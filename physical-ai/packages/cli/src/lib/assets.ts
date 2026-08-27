import * as path from 'node:path';

/**
 * Resolves a bundled Containerfile asset directory relative to the installed CLI package
 * (packages/cli/assets/<name>, populated at build time by scripts/copy-assets.mjs).
 *
 * Compiles to dist/cli/src/lib/assets.js — tsc infers a `rootDir` one level above this
 * package because src/ imports files from ../../shared (outside packages/cli), which nests
 * emitted output under dist/cli/... rather than dist/... directly. Four levels up from the
 * compiled file's directory lands back at the package root (packages/cli/).
 */
export function resolveBundledAssetDir(assetDirName: string): string {
  return path.join(__dirname, '..', '..', '..', '..', 'assets', assetDirName);
}
