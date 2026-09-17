import { readdir } from 'node:fs/promises';
import { join as pathJoin, relative } from 'node:path';
import { formatBuildContextIssues, verifyBuildContext } from '/@shared/src/build/verifyBuildContext';

async function walkContextFiles(dir: string, root: string, out: Set<string>): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = pathJoin(dir, entry.name);
    const rel = relative(root, full).split('\\').join('/');
    out.add(rel);
    if (entry.isDirectory()) {
      await walkContextFiles(full, root, out);
    }
  }
}

/** List every file and directory path (relative) under a build context root. */
export async function listBuildContextPaths(contextDir: string): Promise<Set<string>> {
  const paths = new Set<string>();
  await walkContextFiles(contextDir, contextDir, paths);
  return paths;
}

/**
 * Fail fast when COPY sources or managed-sim runtime files are missing from the context.
 * Called immediately before Podman build for every image build path.
 */
export async function assertBuildContextReady(
  contextDir: string,
  containerfile: string,
  options?: { bundleSimRuntime?: boolean },
): Promise<void> {
  const contextFiles = await listBuildContextPaths(contextDir);
  const issues = verifyBuildContext(containerfile, contextFiles, options);
  if (issues.length === 0) {
    return;
  }
  throw new Error(`Build context verification failed:\n${formatBuildContextIssues(issues)}`);
}
