import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as extensionApi from '@podman-desktop/api';
import { access, cp } from 'node:fs/promises';
import { resolveBundledAssetDir, stageBundledAssetDir, stageSimRuntimeAssetFiles } from './bundledAssets';

vi.mock('@podman-desktop/api', () => ({
  Uri: { joinPath: vi.fn() },
}));

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
  cp: vi.fn(),
}));

const EXT_URI = { fsPath: '/ext/root' } as extensionApi.Uri;

describe('resolveBundledAssetDir', () => {
  beforeEach(() => {
    vi.mocked(extensionApi.Uri.joinPath).mockImplementation(
      (base, ...segments) => ({ fsPath: [base.fsPath, ...segments].join('/') }) as extensionApi.Uri,
    );
  });

  it('returns extensionUri/assets/<dir> when Containerfile exists there', async () => {
    vi.mocked(access).mockResolvedValue(undefined);
    await expect(resolveBundledAssetDir(EXT_URI, 'ros2-jazzy-sim')).resolves.toBe('/ext/root/assets/ros2-jazzy-sim');
  });

  it('falls back to ../assets when extensionUri points at dist/', async () => {
    vi.mocked(access).mockImplementation(async (p: Parameters<typeof access>[0]) => {
      const path = String(p);
      if (path === '/ext/root/dist/assets/ros2-jazzy-sim/Containerfile') {
        throw new Error('missing');
      }
      if (path === '/ext/root/assets/ros2-jazzy-sim/Containerfile') {
        return;
      }
      throw new Error(`unexpected path ${path}`);
    });
    const distUri = { fsPath: '/ext/root/dist' } as extensionApi.Uri;
    await expect(resolveBundledAssetDir(distUri, 'ros2-jazzy-sim')).resolves.toBe('/ext/root/assets/ros2-jazzy-sim');
  });

  it('throws a clear error when no candidate has Containerfile', async () => {
    vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
    await expect(resolveBundledAssetDir(EXT_URI, 'ros2-jazzy-sim')).rejects.toThrow(/Bundled container assets/);
  });
});

describe('stageBundledAssetDir', () => {
  beforeEach(() => {
    vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({
      fsPath: '/ext/root/assets/ros2-jazzy-base',
    } as unknown as extensionApi.Uri);
    vi.mocked(access).mockResolvedValue(undefined);
    vi.mocked(cp).mockResolvedValue(undefined);
  });

  it('recursively copies the resolved bundle into destDir', async () => {
    await stageBundledAssetDir(EXT_URI, 'ros2-jazzy-base', '/tmp/build-ctx');
    expect(cp).toHaveBeenCalledWith('/ext/root/assets/ros2-jazzy-base', '/tmp/build-ctx', { recursive: true });
  });
});

describe('stageSimRuntimeAssetFiles', () => {
  beforeEach(() => {
    vi.mocked(extensionApi.Uri.joinPath).mockReturnValue({
      fsPath: '/ext/root/assets/ros2-jazzy-sim',
    } as unknown as extensionApi.Uri);
    vi.mocked(access).mockResolvedValue(undefined);
    vi.mocked(cp).mockResolvedValue(undefined);
  });

  it('copies entrypoints and support dirs without the preset Containerfile', async () => {
    await stageSimRuntimeAssetFiles(EXT_URI, 'ros2-jazzy-sim', '/tmp/layer-ctx');
    expect(cp).toHaveBeenCalledWith(
      '/ext/root/assets/ros2-jazzy-sim/entrypoint-gazebo.sh',
      '/tmp/layer-ctx/entrypoint-gazebo.sh',
    );
    expect(cp).toHaveBeenCalledWith('/ext/root/assets/ros2-jazzy-sim/worlds', '/tmp/layer-ctx/worlds', {
      recursive: true,
    });
  });
});
