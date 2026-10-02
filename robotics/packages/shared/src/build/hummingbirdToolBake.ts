import type { HardenedApp } from '../types/layerCompatibility';
import { HUMMINGBIRD_APP_OPTIONS, hummingbirdImageRef } from '../types/layerCompatibility';

/** Target platform for a layer build — selects arch-specific paths in Hummingbird images. */
export type HummingbirdBakeArch = 'amd64' | 'arm64';

export const HI_CURL_ROOT = '/opt/hummingbird/curl';
export const HI_JQ_ROOT = '/opt/hummingbird/jq';

/** Baked CLIs that run via an isolated Hummingbird lib64 + dynamic linker (not host glibc). */
export const HUMMINGBIRD_ISOLATED_CLI_TOOLS: readonly HardenedApp[] = ['curl', 'jq'];

/** Dynamic linker path inside `registry.access.redhat.com/hi/*` tool images (verified 2026-10). */
export function hummingbirdToolImageDynamicLinkerPath(arch: HummingbirdBakeArch): string {
  return arch === 'arm64' ? '/usr/lib/ld-linux-aarch64.so.1' : '/lib64/ld-linux-x86-64.so.2';
}

export function hummingbirdIsolatedCliRoot(tool: HardenedApp): string | undefined {
  if (tool === 'curl') return HI_CURL_ROOT;
  if (tool === 'jq') return HI_JQ_ROOT;
  return undefined;
}

function hummingbirdIsolatedCliBakeLines(
  tool: 'curl' | 'jq',
  ref: string,
  binPath: string,
  arch: HummingbirdBakeArch,
): string[] {
  const root = hummingbirdIsolatedCliRoot(tool)!;
  const ld = hummingbirdToolImageDynamicLinkerPath(arch);
  return [
    `# ${tool} — Hummingbird glibc bundle (Noble glibc is older than hi/${tool})`,
    `COPY --from=${ref} ${binPath} ${root}/bin/${tool}`,
    `COPY --from=${ref} /usr/lib64/ ${root}/lib64/`,
    `COPY --from=${ref} ${ld} ${root}/ld-linux.so`,
    `RUN printf '%s\\n' '#!/bin/sh' 'exec ${root}/ld-linux.so --library-path ${root}/lib64 ${root}/bin/${tool} "$$@"' > /usr/local/bin/${tool} && chmod +x /usr/local/bin/${tool}`,
  ];
}

/**
 * Containerfile lines to bake a Hummingbird CLI into a Ubuntu/ROS base image.
 * `curl` and `jq` ship against a newer glibc than Noble — copy lib64 + invoke via
 * the Hummingbird dynamic linker (wrapper at /usr/local/bin for scripts/PATH).
 */
export function hummingbirdToolBakeContainerfileLines(
  tool: HardenedApp,
  arch: HummingbirdBakeArch = 'amd64',
): string[] {
  const opt = HUMMINGBIRD_APP_OPTIONS.find(o => o.id === tool);
  if (opt?.kind !== 'tool') {
    return [];
  }
  const ref = hummingbirdImageRef(tool);
  const binPath = opt.binPath ?? `/usr/bin/${tool}`;

  if (tool === 'curl' || tool === 'jq') {
    return hummingbirdIsolatedCliBakeLines(tool, ref, binPath, arch);
  }

  return [`COPY --from=${ref} ${binPath} /usr/local/bin/${tool}`];
}
