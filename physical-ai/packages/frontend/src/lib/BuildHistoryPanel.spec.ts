import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import BuildHistoryPanel from './BuildHistoryPanel.svelte';
import type { BuildHistoryEntry } from '/@shared/src/types/BuildHistory';

const mockGetBuildHistory = vi.fn();
const mockCopyToClipboard = vi.fn();

vi.mock('../api/client', () => ({
  physicalAiClient: {
    getBuildHistory: (...args: unknown[]) => mockGetBuildHistory(...args),
    copyToClipboard: (...args: unknown[]) => mockCopyToClipboard(...args),
  },
}));

const SPDX_SBOM = JSON.stringify({ packages: [{ name: 'pkg-a' }, { name: 'pkg-b' }] });
const CYCLONEDX_SBOM = JSON.stringify({ components: [{ name: 'comp-a' }, { name: 'comp-b' }, { name: 'comp-c' }] });

describe('BuildHistoryPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetBuildHistory.mockResolvedValue([]);
    mockCopyToClipboard.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a placeholder when there is no history yet', async () => {
    render(BuildHistoryPanel, { props: { pollIntervalMs: 1_000_000 } });
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

    render(BuildHistoryPanel, { props: { pollIntervalMs: 1_000_000 } });

    expect(await screen.findByText(entry.tag)).toBeTruthy();
    expect(screen.getByText('(amd64)')).toBeTruthy();
    expect(screen.getByText('12.3s')).toBeTruthy();
    expect(screen.getByText('✅')).toBeTruthy();
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

    render(BuildHistoryPanel, { props: { pollIntervalMs: 1_000_000 } });

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

    render(BuildHistoryPanel, { props: { pollIntervalMs: 1_000_000 } });

    await screen.findByText(entry.tag);
    expect(screen.queryByText(/SBOM/)).toBeNull();
  });

  it('labels a CycloneDX SBOM by its component count, not "packages"', async () => {
    const entry: BuildHistoryEntry = {
      tag: 'quay.io/ns/pai-layer-ubuntu-noble:latest',
      arch: 'amd64',
      startedAt: Date.now(),
      durationMs: 20_000,
      success: true,
      sbom: CYCLONEDX_SBOM,
      sbomFormat: 'cyclonedx-json',
    };
    mockGetBuildHistory.mockResolvedValue([entry]);

    render(BuildHistoryPanel, { props: { pollIntervalMs: 1_000_000 } });

    expect(await screen.findByRole('button', { name: /SBOM \(3 components\)/ })).toBeTruthy();
  });

  it('expands/collapses the SBOM toggle showing a parsed, pretty-printed package count, and copies the raw SBOM to clipboard', async () => {
    const entry: BuildHistoryEntry = {
      tag: 'quay.io/ns/pai-layer-ubuntu-noble:latest',
      arch: 'amd64',
      startedAt: Date.now(),
      durationMs: 20_000,
      success: true,
      sbom: SPDX_SBOM,
    };
    mockGetBuildHistory.mockResolvedValue([entry]);

    render(BuildHistoryPanel, { props: { pollIntervalMs: 1_000_000 } });

    const toggle = await screen.findByRole('button', { name: /SBOM \(2 packages\)/ });
    expect(screen.queryByText(/pkg-a/)).toBeNull();

    await fireEvent.click(toggle);
    // Pretty-printing is deferred a tick so the "Formatting..." placeholder can paint first.
    expect(screen.getByText(/Formatting SBOM/)).toBeTruthy();
    // testing-library normalizes whitespace when matching text content, so match against
    // the same normalized form rather than the raw (indented, multi-line) pretty string.
    // eslint-disable-next-line no-null/no-null -- JSON.stringify's replacer arg requires null
    const prettyNormalized = JSON.stringify(JSON.parse(SPDX_SBOM), null, 2).replace(/\s+/g, ' ').trim();
    expect(await screen.findByText(prettyNormalized)).toBeTruthy();

    await fireEvent.click(toggle);
    expect(screen.queryByText(prettyNormalized)).toBeNull();

    // Re-expanding reuses the cached formatted text — no "Formatting..." flash the 2nd time.
    await fireEvent.click(toggle);
    expect(screen.queryByText(/Formatting SBOM/)).toBeNull();
    expect(screen.getByText(prettyNormalized)).toBeTruthy();

    const copyButton = screen.getByRole('button', { name: 'Copy to clipboard' });
    await fireEvent.click(copyButton);
    // Copies via the extension's own clipboard RPC (not navigator.clipboard, which
    // silently no-ops in this webview), and copies the raw SBOM exactly as syft produced
    // it, not the display-only pretty-print.
    await waitFor(() => {
      expect(mockCopyToClipboard).toHaveBeenCalledWith(SPDX_SBOM);
    });
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('shows "Copy failed" feedback when the clipboard RPC rejects (e.g. oversized payload)', async () => {
    mockCopyToClipboard.mockRejectedValue(new Error('Clipboard text exceeds the allowed size.'));

    const entry: BuildHistoryEntry = {
      tag: 'quay.io/ns/pai-layer-ubuntu-noble:latest',
      arch: 'amd64',
      startedAt: Date.now(),
      durationMs: 20_000,
      success: true,
      sbom: SPDX_SBOM,
    };
    mockGetBuildHistory.mockResolvedValue([entry]);

    render(BuildHistoryPanel, { props: { pollIntervalMs: 1_000_000 } });

    const copyButton = await screen.findByRole('button', { name: 'Copy to clipboard' });
    await fireEvent.click(copyButton);
    const failedButton = await screen.findByRole('button', { name: 'Copy failed' });
    // The button label alone can't say why — the real error is on the tooltip.
    expect(failedButton.title).toBe('Clipboard text exceeds the allowed size.');
  });

  it('falls back to a plain "SBOM" label (no package count) when the sbom text is not parseable JSON', async () => {
    const entry: BuildHistoryEntry = {
      tag: 'quay.io/ns/pai-layer-ubuntu-noble:latest',
      arch: 'amd64',
      startedAt: Date.now(),
      durationMs: 20_000,
      success: true,
      sbom: 'not valid json',
    };
    mockGetBuildHistory.mockResolvedValue([entry]);

    render(BuildHistoryPanel, { props: { pollIntervalMs: 1_000_000 } });

    const toggle = await screen.findByRole('button', { name: '▶ SBOM' });
    await fireEvent.click(toggle);
    expect(await screen.findByText('not valid json')).toBeTruthy();
  });

  it('re-fetches history on the configured poll interval', async () => {
    vi.useFakeTimers();
    mockGetBuildHistory.mockResolvedValue([]);

    render(BuildHistoryPanel, { props: { pollIntervalMs: 3000 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(mockGetBuildHistory).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(mockGetBuildHistory).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(3000);
    expect(mockGetBuildHistory).toHaveBeenCalledTimes(3);
  });
});
