export type TargetArch = 'amd64' | 'arm64';

/**
 * Maps Node's `process.arch` to the amd64/arm64 vocabulary `--target-arch` flags use, so
 * `build:base` always resolves to a concrete architecture instead of silently deferring to
 * whatever podman/the container runtime picks by default when no `--platform` is passed.
 */
export function hostTargetArch(): TargetArch {
  return process.arch === 'arm64' ? 'arm64' : 'amd64';
}
