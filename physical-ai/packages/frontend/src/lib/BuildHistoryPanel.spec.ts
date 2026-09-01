import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import BuildHistoryPanel from './BuildHistoryPanel.svelte';
import type { BuildHistoryEntry } from '/@shared/src/types/BuildHistory';

const mockGetBuildHistory = vi.fn();
const mockGetBuildHistorySbom = vi.fn();
const mockCopyToClipboard = vi.fn();

vi.mock('../api/client', () => ({
  physicalAiClient: {
    getBuildHistory: (...args: unknown[]) => mockGetBuildHistory(...args),
    getBuildHistorySbom: (...args: unknown[]) => mockGetBuildHistorySbom(...args),
    copyToClipboard: (...args: unknown[]) => mockCopyToClipboard(...args),
  },
}));

const SPDX_SBOM = JSON.stringify({ packages: [{ name: 'pkg-a' }, { name: 'pkg-b' }] });

describe('BuildHistoryPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetBuildHistory.mockResolvedValue([]);
    mockGetBuildHistorySbom.mockResolvedValue(undefined);
    mockCopyToClipboard.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a placeholder when there is no history yet', async () => {
    render(BuildHistoryPanel);
    expect(await screen.findByText('No builds recorded yet.')).toBeTruthy();
  });

  it('renders a successful entry with tag, arch, duration, and a success indicator', async () => {
    const entry: BuildHistoryEntry = {
      tag: 'quay.io/ns/ros2-jazzy-base:noble',
      arch: 'amd64',
      startedAt: Date.now(),
      durationMs: 12_300,
      success: true,
    };
    mockGetBuildHistory.mockResolvedValue([entry]);

    render(BuildHistoryPanel);

    expect(await screen.findByText(entry.tag)).toBeTruthy();
    expect(screen.getByText('(amd64)')).toBeTruthy();
    expect(screen.getByText('12.3s')).toBeTruthy();
    expect(screen.getByText('✅')).toBeTruthy();
  });

  it('formats a duration over a minute as minutes and seconds', async () => {
    const entry: BuildHistoryEntry = {
      tag: 'quay.io/ns/pai-layer-ubuntu-noble:latest-amd64',
      arch: 'amd64',
      startedAt: Date.now(),
      durationMs: 1_150_200,
      success: true,
    };
    mockGetBuildHistory.mockResolvedValue([entry]);

    render(BuildHistoryPanel);

    expect(await screen.findByText('19m 10s')).toBeTruthy();
  });

  it('renders a failed entry with its error message', async () => {
    const entry: BuildHistoryEntry = {
      tag: 'quay.io/ns/pai-layer-fedora-bootc-42:latest',
      arch: 'arm64',
      startedAt: Date.now(),
      durationMs: 4_000,
      success: false,
      errorMessage: 'dnf install failed: package not found',
    };
    mockGetBuildHistory.mockResolvedValue([entry]);

    render(BuildHistoryPanel);

    expect(await screen.findByText(entry.tag)).toBeTruthy();
    expect(screen.getByText('❌')).toBeTruthy();
    expect(screen.getByText(entry.errorMessage!)).toBeTruthy();
  });

  it('a build without an sbom shows no SBOM toggle', async () => {
    const entry: BuildHistoryEntry = {
      tag: 'quay.io/ns/ros2-jazzy-base:noble',
      arch: 'amd64',
      startedAt: Date.now(),
      durationMs: 1_000,
      success: true,
    };
    mockGetBuildHistory.mockResolvedValue([entry]);

    render(BuildHistoryPanel);

    await screen.findByText(entry.tag);
    expect(screen.queryByText(/SBOM/)).toBeNull();
  });

  it('labels a CycloneDX SBOM by its component count from sbomPackageCount, without fetching the SBOM', async () => {
    const entry: BuildHistoryEntry = {
      tag: 'quay.io/ns/pai-layer-ubuntu-noble:latest',
      arch: 'amd64',
      startedAt: Date.now(),
      durationMs: 20_000,
      success: true,
      sbomFormat: 'cyclonedx-json',
      sbomPackageCount: 3,
    };
    mockGetBuildHistory.mockResolvedValue([entry]);

    render(BuildHistoryPanel);

    expect(await screen.findByRole('button', { name: /SBOM \(3 components\)/ })).toBeTruthy();
    // The count came from the polled entry's own field — no on-demand fetch needed yet.
    expect(mockGetBuildHistorySbom).not.toHaveBeenCalled();
  });

  it('fetches the SBOM on demand when expanded, showing a parsed, pretty-printed count, and copies the raw SBOM to clipboard', async () => {
    const entry: BuildHistoryEntry = {
      tag: 'quay.io/ns/pai-layer-ubuntu-noble:latest',
      arch: 'amd64',
      startedAt: Date.now(),
      durationMs: 20_000,
      success: true,
      sbomFormat: 'spdx-json',
      sbomPackageCount: 2,
    };
    mockGetBuildHistory.mockResolvedValue([entry]);
    mockGetBuildHistorySbom.mockResolvedValue(SPDX_SBOM);

    render(BuildHistoryPanel);

    const toggle = await screen.findByRole('button', { name: /SBOM \(2 packages\)/ });
    expect(screen.queryByText(/pkg-a/)).toBeNull();

    await fireEvent.click(toggle);
    // testing-library normalizes whitespace when matching text content, so match against
    // the same normalized form rather than the raw (indented, multi-line) pretty string.
    // eslint-disable-next-line no-null/no-null -- JSON.stringify's replacer arg requires null
    const prettyNormalized = JSON.stringify(JSON.parse(SPDX_SBOM), null, 2).replace(/\s+/g, ' ').trim();
    expect(await screen.findByText(prettyNormalized)).toBeTruthy();
    expect(mockGetBuildHistorySbom).toHaveBeenCalledWith(entry.tag, entry.startedAt);

    await fireEvent.click(toggle);
    expect(screen.queryByText(prettyNormalized)).toBeNull();

    // Re-expanding reuses the cached fetch/formatted text — no second RPC call.
    await fireEvent.click(toggle);
    expect(screen.getByText(prettyNormalized)).toBeTruthy();
    expect(mockGetBuildHistorySbom).toHaveBeenCalledTimes(1);

    const copyButton = screen.getByRole('button', { name: 'Copy to clipboard' });
    await fireEvent.click(copyButton);
    // Copies via the extension's own clipboard RPC (not navigator.clipboard, which
    // silently no-ops in this webview), and copies the raw SBOM exactly as syft produced
    // it, not the display-only pretty-print. Reuses the already-fetched text.
    await waitFor(() => {
      expect(mockCopyToClipboard).toHaveBeenCalledWith(SPDX_SBOM);
    });
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(mockGetBuildHistorySbom).toHaveBeenCalledTimes(1);
  });

  it('shows transient "Fetching SBOM..." then "Formatting SBOM..." placeholders while expanding', async () => {
    let resolveFetch!: (sbom: string) => void;
    mockGetBuildHistorySbom.mockImplementation(
      () =>
        new Promise<string>(resolve => {
          resolveFetch = resolve;
        }),
    );
    const entry: BuildHistoryEntry = {
      tag: 'quay.io/ns/pai-layer-ubuntu-noble:latest',
      arch: 'amd64',
      startedAt: Date.now(),
      durationMs: 20_000,
      success: true,
      sbomFormat: 'spdx-json',
      sbomPackageCount: 2,
    };
    mockGetBuildHistory.mockResolvedValue([entry]);

    render(BuildHistoryPanel);
    const toggle = await screen.findByRole('button', { name: /SBOM \(2 packages\)/ });
    await fireEvent.click(toggle);

    expect(await screen.findByText('Fetching SBOM…')).toBeTruthy();
    resolveFetch(SPDX_SBOM);
    // Once the fetch resolves, pretty-printing is deferred a tick so this placeholder paints.
    expect(await screen.findByText(/Formatting SBOM/)).toBeTruthy();
  });

  it('shows an inline error when the on-demand SBOM fetch fails', async () => {
    mockGetBuildHistorySbom.mockRejectedValue(new Error('history file unreadable'));
    const entry: BuildHistoryEntry = {
      tag: 'quay.io/ns/pai-layer-ubuntu-noble:latest',
      arch: 'amd64',
      startedAt: Date.now(),
      durationMs: 20_000,
      success: true,
      sbomFormat: 'spdx-json',
      sbomPackageCount: 2,
    };
    mockGetBuildHistory.mockResolvedValue([entry]);

    render(BuildHistoryPanel);
    const toggle = await screen.findByRole('button', { name: /SBOM \(2 packages\)/ });
    await fireEvent.click(toggle);

    expect(await screen.findByText('history file unreadable')).toBeTruthy();
  });

  it('shows "Copy failed" feedback when the clipboard RPC rejects (e.g. oversized payload)', async () => {
    mockCopyToClipboard.mockRejectedValue(new Error('Clipboard text exceeds the allowed size.'));
    mockGetBuildHistorySbom.mockResolvedValue(SPDX_SBOM);

    const entry: BuildHistoryEntry = {
      tag: 'quay.io/ns/pai-layer-ubuntu-noble:latest',
      arch: 'amd64',
      startedAt: Date.now(),
      durationMs: 20_000,
      success: true,
      sbomFormat: 'spdx-json',
      sbomPackageCount: 2,
    };
    mockGetBuildHistory.mockResolvedValue([entry]);

    render(BuildHistoryPanel);

    const copyButton = await screen.findByRole('button', { name: 'Copy to clipboard' });
    await fireEvent.click(copyButton);
    await screen.findByRole('button', { name: 'Copy failed' });
    // Shown inline, not just as a hover tooltip (which has a built-in hover delay).
    expect(await screen.findByText('Clipboard text exceeds the allowed size.')).toBeTruthy();
  });

  it('keeps the copy-failed error visible until the next retry, unlike the success message', async () => {
    mockCopyToClipboard.mockRejectedValueOnce(new Error('boom'));
    mockGetBuildHistorySbom.mockResolvedValue(SPDX_SBOM);

    const entry: BuildHistoryEntry = {
      tag: 'quay.io/ns/pai-layer-ubuntu-noble:latest',
      arch: 'amd64',
      startedAt: Date.now(),
      durationMs: 20_000,
      success: true,
      sbomFormat: 'spdx-json',
      sbomPackageCount: 2,
    };
    mockGetBuildHistory.mockResolvedValue([entry]);

    render(BuildHistoryPanel);

    const copyButton = await screen.findByRole('button', { name: 'Copy to clipboard' });
    await fireEvent.click(copyButton);
    await screen.findByText('boom');

    // No auto-clear timer for a failure — it stays until the button is clicked again,
    // whereas a successful copy's "Copied" label does auto-clear (existing behavior).
    await new Promise(r => setTimeout(r, 50));
    expect(screen.getByText('boom')).toBeTruthy();

    mockCopyToClipboard.mockResolvedValueOnce(undefined);
    await fireEvent.click(screen.getByRole('button', { name: 'Copy failed' }));
    await screen.findByRole('button', { name: 'Copied' });
    expect(screen.queryByText('boom')).toBeNull();
  });

  it('falls back to a plain "SBOM" label (no package count) when the fetched sbom text is not parseable JSON', async () => {
    // Simulates a legacy entry recorded before sbomFormat existed — the backend backfills
    // sbomFormat to spdx-json for these so the toggle still shows (APPENG-6265), but no
    // sbomPackageCount was ever computed for it.
    const entry: BuildHistoryEntry = {
      tag: 'quay.io/ns/pai-layer-ubuntu-noble:latest',
      arch: 'amd64',
      startedAt: Date.now(),
      durationMs: 20_000,
      success: true,
      sbomFormat: 'spdx-json',
    };
    mockGetBuildHistory.mockResolvedValue([entry]);
    mockGetBuildHistorySbom.mockResolvedValue('not valid json');

    render(BuildHistoryPanel);

    const toggle = await screen.findByRole('button', { name: '▶ SBOM' });
    await fireEvent.click(toggle);
    expect(await screen.findByText('not valid json')).toBeTruthy();
    // Still no count after fetching — the text genuinely isn't parseable JSON.
    expect(screen.getByRole('button', { name: '▼ SBOM' })).toBeTruthy();
  });

  it('refreshes once on mount and does not keep polling in the background (APPENG-6265)', async () => {
    vi.useFakeTimers();
    mockGetBuildHistory.mockResolvedValue([]);

    render(BuildHistoryPanel);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockGetBuildHistory).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(mockGetBuildHistory).toHaveBeenCalledTimes(1);
  });

  it('refreshAfterBuild(false) refreshes once and starts no catch-up poll', async () => {
    vi.useFakeTimers();
    mockGetBuildHistory.mockResolvedValue([]);

    const { component } = render(BuildHistoryPanel);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockGetBuildHistory).toHaveBeenCalledTimes(1);

    await component.refreshAfterBuild(false);
    expect(mockGetBuildHistory).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(mockGetBuildHistory).toHaveBeenCalledTimes(2);
  });

  it('refreshAfterBuild(true) keeps polling on sbomWatchIntervalMs until sbomWatchDurationMs elapses, then stops', async () => {
    vi.useFakeTimers();
    mockGetBuildHistory.mockResolvedValue([]);

    const { component } = render(BuildHistoryPanel, {
      props: { sbomWatchIntervalMs: 3000, sbomWatchDurationMs: 9000 },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(mockGetBuildHistory).toHaveBeenCalledTimes(1);

    const watch = component.refreshAfterBuild(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockGetBuildHistory).toHaveBeenCalledTimes(2); // the immediate refresh inside refreshAfterBuild

    await vi.advanceTimersByTimeAsync(3000);
    expect(mockGetBuildHistory).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(3000);
    expect(mockGetBuildHistory).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(3000);
    expect(mockGetBuildHistory).toHaveBeenCalledTimes(5);
    await watch;

    // The 9s watch window has elapsed — further time must not trigger more refreshes.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockGetBuildHistory).toHaveBeenCalledTimes(5);
  });

  it('refreshAfterBuild(true) stops as soon as the newest entry gets its SBOM, without waiting out the full ceiling', async () => {
    vi.useFakeTimers();
    const withoutSbom: BuildHistoryEntry = {
      tag: 'quay.io/ns/pai-layer-ubuntu-noble:latest',
      arch: 'arm64',
      startedAt: 1,
      durationMs: 3400,
      success: true,
    };
    const withSbom: BuildHistoryEntry = { ...withoutSbom, sbomFormat: 'cyclonedx-json', sbomPackageCount: 2588 };
    mockGetBuildHistory.mockResolvedValueOnce([withoutSbom]); // initial mount refresh
    mockGetBuildHistory.mockResolvedValueOnce([withoutSbom]); // refreshAfterBuild's immediate refresh
    mockGetBuildHistory.mockResolvedValueOnce([withoutSbom]); // 1st catch-up tick — syft still running
    mockGetBuildHistory.mockResolvedValue([withSbom]); // 2nd catch-up tick — syft has attached it

    const { component } = render(BuildHistoryPanel, {
      props: { sbomWatchIntervalMs: 3000, sbomWatchDurationMs: 5 * 60_000 },
    });
    await vi.advanceTimersByTimeAsync(0);

    const watch = component.refreshAfterBuild(true);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(3000);
    await watch;

    expect(mockGetBuildHistory).toHaveBeenCalledTimes(4);
    expect(await screen.findByRole('button', { name: /SBOM \(2588 components\)/ })).toBeTruthy();

    // Well past the 5-minute ceiling — since it already stopped, no further calls.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(mockGetBuildHistory).toHaveBeenCalledTimes(4);
  });
});
