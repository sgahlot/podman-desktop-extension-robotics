import { describe, it, expect } from 'vitest';
import { HUMMINGBIRD_TOOL_OPTIONS } from '../types/layerCompatibility';
import {
  BUNDLED_TOOLS_WITH_SMOKE_CHECK,
  bundledToolBakedBinPath,
  bundledToolSmokePodmanExecArgs,
  isBundledToolSmokeCheckSupported,
  podmanDynamicLinkerForImageArch,
} from './bundledToolSmokeCheck';

describe('bundledToolSmokeCheck', () => {
  it('selects the aarch64 dynamic linker for arm64 images', () => {
    expect(podmanDynamicLinkerForImageArch('arm64')).toBe('/lib/ld-linux-aarch64.so.1');
  });

  it('uses the baked-in path under /usr/local/bin', () => {
    expect(bundledToolBakedBinPath('cosign')).toBe('/usr/local/bin/cosign');
  });

  it('supports a smoke check for every bake-in Hummingbird tool', () => {
    const toolIds = HUMMINGBIRD_TOOL_OPTIONS.map(o => o.id);
    expect([...BUNDLED_TOOLS_WITH_SMOKE_CHECK].sort()).toEqual([...toolIds].sort());
    for (const tool of toolIds) {
      expect(isBundledToolSmokeCheckSupported(tool)).toBe(true);
    }
  });

  it('runs version-style checks with --entrypoint so sim ENTRYPOINT does not intercept', () => {
    expect(bundledToolSmokePodmanExecArgs('my:tag', 'cosign')).toEqual([
      'run',
      '--rm',
      '--entrypoint',
      '/usr/local/bin/cosign',
      'my:tag',
      'version',
    ]);
    expect(bundledToolSmokePodmanExecArgs('my:tag', 'curl')).toEqual([
      'run',
      '--rm',
      '--entrypoint',
      '/opt/hummingbird/curl/ld-linux.so',
      'my:tag',
      '--library-path',
      '/opt/hummingbird/curl/lib64',
      '/opt/hummingbird/curl/bin/curl',
      '--version',
    ]);
    expect(bundledToolSmokePodmanExecArgs('my:tag', 'jq')).toEqual([
      'run',
      '--rm',
      '--entrypoint',
      '/opt/hummingbird/jq/ld-linux.so',
      'my:tag',
      '--library-path',
      '/opt/hummingbird/jq/lib64',
      '/opt/hummingbird/jq/bin/jq',
      '--version',
    ]);
    expect(bundledToolSmokePodmanExecArgs('my:tag', 'kubectl')).toEqual([
      'run',
      '--rm',
      '--entrypoint',
      '/usr/local/bin/kubectl',
      'my:tag',
      'version',
      '--client',
    ]);
    expect(bundledToolSmokePodmanExecArgs('my:tag', 'helm')).toEqual([
      'run',
      '--rm',
      '--entrypoint',
      '/usr/local/bin/helm',
      'my:tag',
      'version',
    ]);
  });
});
