import type { HardenedApp } from '../types/layerCompatibility';
import { HUMMINGBIRD_TOOL_OPTIONS } from '../types/layerCompatibility';
import { hummingbirdIsolatedCliRoot } from './hummingbirdToolBake';

/**
 * argv passed to the baked binary after `podman run --rm --entrypoint <bin> <image> …`.
 * Must be non-destructive (no cluster/network requirements). Verified against
 * `registry.access.redhat.com/hi/<tool>:latest` (2026-10).
 */
const BUNDLED_TOOL_SMOKE_ARGS: Partial<Record<HardenedApp, readonly string[]>> = {
  cosign: ['version'],
  curl: ['--version'],
  jq: ['--version'],
  kubectl: ['version', '--client'],
  helm: ['version'],
};

/** Bake-in tools that support a non-destructive smoke check inside the built image (not full app workflows). */
export const BUNDLED_TOOLS_WITH_SMOKE_CHECK: readonly HardenedApp[] = Object.keys(
  BUNDLED_TOOL_SMOKE_ARGS,
) as HardenedApp[];

export function isBundledToolSmokeCheckSupported(tool: HardenedApp): boolean {
  return tool in BUNDLED_TOOL_SMOKE_ARGS;
}

/** Path of the tool binary inside the user's built image (`generatePresetHardenedContainerfile`). */
export function bundledToolBakedBinPath(tool: HardenedApp): string {
  return `/usr/local/bin/${tool}`;
}

export function podmanDynamicLinkerForImageArch(architecture: string): string {
  const arch = architecture.trim().toLowerCase();
  return arch === 'amd64' || arch === 'x86_64' ? '/lib64/ld-linux-x86-64.so.2' : '/lib/ld-linux-aarch64.so.1';
}

/**
 * Full `podman` argv for a bundled-tool smoke check. Uses `--entrypoint` on the baked binary so
 * sim/runtime images that set `ENTRYPOINT ["/bin/bash"]` do not try to run the loader through bash.
 */
export function bundledToolSmokePodmanExecArgs(imageTag: string, tool: HardenedApp): string[] {
  const args = BUNDLED_TOOL_SMOKE_ARGS[tool];
  if (!args) {
    throw new Error(`Bundled tool "${tool}" does not support a smoke check yet.`);
  }

  const isolatedRoot = hummingbirdIsolatedCliRoot(tool);
  if (isolatedRoot) {
    // Invoke via the Hummingbird dynamic linker — Podman does not always pass argv to a
    // shell-script --entrypoint, which showed up as curl exit 3 (no URL / missing --version).
    return [
      'run',
      '--rm',
      '--entrypoint',
      `${isolatedRoot}/ld-linux.so`,
      imageTag,
      '--library-path',
      `${isolatedRoot}/lib64`,
      `${isolatedRoot}/bin/${tool}`,
      ...args,
    ];
  }

  const bin = bundledToolBakedBinPath(tool);
  return ['run', '--rm', '--entrypoint', bin, imageTag, ...args];
}

export function bundledToolSmokeCheckLabel(tool: HardenedApp): string {
  const option = HUMMINGBIRD_TOOL_OPTIONS.find(o => o.id === tool);
  return option?.label ?? tool;
}
