import { SIM_RUNTIME_LAYER_MARKER, containerfileNeedsBundledSimRuntime } from '../types/simOperationalLayer';

export type BuildContextIssueKind =
  | 'missing-copy-source'
  | 'sim-runtime-incomplete'
  | 'sim-runtime-staged-without-layer'
  | 'sim-packages-without-runtime'
  | 'legacy-lib-path';

export interface BuildContextIssue {
  kind: BuildContextIssueKind;
  message: string;
}

/** Relative paths the sim operational layer expects in the build context. */
export const SIM_RUNTIME_CONTEXT_PATHS = [
  'entrypoint-gazebo.sh',
  'entrypoint-spawn-robot.sh',
  'entrypoint-nav2.sh',
  'lib/load-validate-input.sh',
  'lib/validate-input.sh',
  'lib/patch-nav2-params.py',
  'config/cyclonedds-qos.xml',
  'worlds',
] as const;

/**
 * Parse `COPY`/`ADD` source paths from a Containerfile. Skips multi-stage
 * `COPY --from=…` and only returns host-context paths (not URLs).
 */
export function parseContainerfileCopySources(containerfile: string): string[] {
  const sources: string[] = [];
  for (const rawLine of containerfile.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const upper = line.toUpperCase();
    if (!upper.startsWith('COPY ') && !upper.startsWith('ADD ')) {
      continue;
    }
    // `--from` is not preceded by a word char, so avoid `\b--from` (fails on `COPY --from=…`).
    if (/(?:^|\s)--from/i.test(line)) {
      continue;
    }
    const tokens = line.split(/\s+/);
    if (tokens.length < 3) {
      continue;
    }
    // COPY [options...] src [src...] dest — collect tokens after flags until the last (dest).
    const args = tokens.slice(1).filter(t => !t.startsWith('--'));
    if (args.length < 2) {
      continue;
    }
    const dest = args[args.length - 1];
    for (const src of args.slice(0, -1)) {
      if (src.startsWith('http://') || src.startsWith('https://')) {
        continue;
      }
      // Trailing slash on dest with single src means directory copy; keep src as listed.
      sources.push(src.replace(/\/$/, ''));
      if (dest.endsWith('/') && args.length === 2) {
        // `COPY worlds/ /opt/...` — already captured.
      }
    }
  }
  return sources;
}

export function containerfileInstallsSimPackages(containerfile: string): boolean {
  return (
    containerfile.includes('# Layer 4 — Simulation') || /nav2-minimal-tb3|ros-gz-sim|navigation2/.test(containerfile)
  );
}

export function containerfileIsManagedSimImage(containerfile: string): boolean {
  return (
    containerfileNeedsBundledSimRuntime(containerfile) ||
    containerfile.includes('COPY entrypoint-gazebo.sh') ||
    containerfile.includes('io.physical-ai.simulation.capability="managed"')
  );
}

export function containerfileUsesLegacyPhysicalAiLibPath(containerfile: string): boolean {
  return /\/usr\/local\/lib\/physical-ai\//.test(containerfile);
}

function hasContextPath(contextFiles: ReadonlySet<string>, relPath: string): boolean {
  if (contextFiles.has(relPath)) {
    return true;
  }
  const prefix = relPath.endsWith('/') ? relPath : `${relPath}/`;
  for (const p of contextFiles) {
    if (p === relPath || p.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

/**
 * Verify a staged build context before invoking Podman. Pure — caller supplies the
 * set of relative paths present under the context directory (files and directories).
 */
export function verifyBuildContext(
  containerfile: string,
  contextFiles: ReadonlySet<string>,
  options?: { bundleSimRuntime?: boolean },
): BuildContextIssue[] {
  const issues: BuildContextIssue[] = [];
  const needsRuntime = options?.bundleSimRuntime ?? containerfileNeedsBundledSimRuntime(containerfile);
  const managedSim = containerfileIsManagedSimImage(containerfile);

  for (const src of parseContainerfileCopySources(containerfile)) {
    if (!hasContextPath(contextFiles, src)) {
      issues.push({
        kind: 'missing-copy-source',
        message: `Containerfile COPY source "${src}" is missing from the build context.`,
      });
    }
  }

  if (containerfileUsesLegacyPhysicalAiLibPath(containerfile)) {
    issues.push({
      kind: 'legacy-lib-path',
      message:
        'Containerfile still COPYs helper scripts to /usr/local/lib/physical-ai/; use /usr/local/lib/robotics/ (entrypoints expect robotics after the rename).',
    });
  }

  if (needsRuntime) {
    if (!containerfile.includes(SIM_RUNTIME_LAYER_MARKER) && !containerfile.includes('COPY entrypoint-gazebo.sh')) {
      issues.push({
        kind: 'sim-runtime-staged-without-layer',
        message: 'Sim runtime files were staged but the Containerfile has no Layer 5 marker or entrypoint COPY lines.',
      });
    }
    for (const rel of SIM_RUNTIME_CONTEXT_PATHS) {
      if (!hasContextPath(contextFiles, rel)) {
        issues.push({
          kind: 'sim-runtime-incomplete',
          message: `Managed sim build is missing "${rel}" in the build context.`,
        });
      }
    }
  }

  if (containerfile.includes('# Layer 4 — Simulation') && !managedSim && !containerfile.includes('packages-only')) {
    issues.push({
      kind: 'sim-packages-without-runtime',
      message:
        'Containerfile installs simulation packages but does not bundle entrypoints/noVNC/worlds — the image will not work with OpenShift deploy or Navigate until a sim runtime layer is added.',
    });
  }

  return issues;
}

export function formatBuildContextIssues(issues: BuildContextIssue[]): string {
  return issues.map(i => i.message).join('\n');
}
