import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import BuildHistoryPanel from './BuildHistoryPanel.svelte';
import type { BuildHistoryEntry } from '/@shared/src/types/BuildHistory';

const mockGetBuildHistory = vi.fn();

vi.mock('../api/client', () => ({
  physicalAiClient: {
    getBuildHistory: (...args: unknown[]) => mockGetBuildHistory(...args),
  },
}));

const SPDX_SBOM = JSON.stringify({ packages: [{ name: 'pkg-a' }, { name: 'pkg-b' }] });

describe('BuildHistoryPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetBuildHistory.mockResolvedValue([]);
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

  it('expands/collapses the SBOM toggle showing a parsed package count, and copies to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

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
    expect(screen.queryByText(SPDX_SBOM)).toBeNull();

    await fireEvent.click(toggle);
    expect(screen.getByText(SPDX_SBOM)).toBeTruthy();

    await fireEvent.click(toggle);
    expect(screen.queryByText(SPDX_SBOM)).toBeNull();

    const copyButton = screen.getByRole('button', { name: 'Copy to clipboard' });
    await fireEvent.click(copyButton);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(SPDX_SBOM);
    });
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
    expect(screen.getByText('not valid json')).toBeTruthy();
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
