/**
 * Structural checks on generated Containerfiles — encodes build semantics that must
 * survive refactors (repo before ros-lyrical dnf, etc.).
 */

const LYRICAL_DESKTOP_MARKER = 'ros-lyrical-desktop';
const LYRICAL_REPO_FILE = 'ros2-lyrical-testing.repo';
const LYRICAL_REPO_BASEURL = 'baseurl=https://repo.ros2.org/fedora/testing/43';

export function indexOfFirstRosLyricalDesktopInstall(containerfile: string): number {
  return containerfile.indexOf(LYRICAL_DESKTOP_MARKER);
}

export function lyricalTestingRepoConfiguredBeforeFirstDesktopInstall(containerfile: string): boolean {
  const desktopIdx = indexOfFirstRosLyricalDesktopInstall(containerfile);
  if (desktopIdx < 0) return true;

  const prefix = containerfile.slice(0, desktopIdx);
  if (prefix.includes(LYRICAL_REPO_BASEURL)) return true;
  if (prefix.includes(LYRICAL_REPO_FILE) && prefix.includes("<<'EOF'")) return true;

  const runStart = prefix.lastIndexOf('\nRUN ');
  if (runStart >= 0) {
    const runBlock = containerfile.slice(runStart, Math.min(containerfile.length, desktopIdx + 120));
    if (runBlock.includes(LYRICAL_REPO_FILE) && runBlock.includes('&&')) return true;
  }
  return false;
}

export function assertLyricalRepoBeforeRosDesktopInstall(containerfile: string): void {
  if (!containerfile.includes(LYRICAL_DESKTOP_MARKER)) return;
  if (!lyricalTestingRepoConfiguredBeforeFirstDesktopInstall(containerfile)) {
    throw new Error(
      'Containerfile installs ros-lyrical-desktop packages before the ROS 2 Lyrical Fedora 43 testing repository is configured.',
    );
  }
}

export function normalizeContainerfileForSnapshot(containerfile: string): string {
  return `${containerfile.replace(/\r\n/g, '\n').trimEnd()}\n`;
}

/** Podman rejects shell heredocs glued to the next command (`EOF && dnf`). */
export function containerfileHasInvalidHeredocGlue(containerfile: string): boolean {
  return /EOF &&\s*\S/.test(containerfile);
}

export function assertContainerfileParseableByPodman(containerfile: string): void {
  if (containerfileHasInvalidHeredocGlue(containerfile)) {
    throw new Error(
      'Containerfile glues a shell heredoc terminator to the next command (EOF && …); use a separate RUN for dnf.',
    );
  }
}
