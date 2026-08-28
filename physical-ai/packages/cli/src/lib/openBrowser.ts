import { spawn } from 'node:child_process';

/**
 * Opens a URL in the user's default browser — the CLI equivalent of the extension's
 * `env.openExternal`. No cross-platform "open" library dependency: the three-way OS dispatch
 * here (macOS `open`, Windows `start`, else `xdg-open`) is small and stable.
 */
export function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : ['xdg-open', [url]];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  // Best-effort only: the caller already prints the URL as a fallback, so a launch failure
  // (e.g. no xdg-open on a headless box) should be silently ignored, not crash the process —
  // an unhandled 'error' event on a spawned child otherwise throws.
  child.on('error', () => {});
  child.unref();
}
