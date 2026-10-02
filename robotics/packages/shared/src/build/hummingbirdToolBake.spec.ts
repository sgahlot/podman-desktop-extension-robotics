import { describe, it, expect } from 'vitest';
import { hummingbirdToolBakeContainerfileLines, hummingbirdToolImageDynamicLinkerPath } from './hummingbirdToolBake';

describe('hummingbirdToolBakeContainerfileLines', () => {
  it('bundles jq with hi/jq lib64 and a wrapper script', () => {
    const lines = hummingbirdToolBakeContainerfileLines('jq', 'arm64');
    const text = lines.join('\n');
    expect(text).toContain('/opt/hummingbird/jq/lib64/');
    expect(text).toContain('/usr/local/bin/jq');
    expect(text).toContain('--library-path');
  });

  it('bundles curl with hi/curl lib64 and a wrapper script', () => {
    const lines = hummingbirdToolBakeContainerfileLines('curl', 'arm64');
    const text = lines.join('\n');
    expect(text).toContain('/opt/hummingbird/curl/lib64/');
    expect(text).toContain('/usr/lib/ld-linux-aarch64.so.1');
    expect(text).toContain('/usr/local/bin/curl');
    expect(text).toContain('--library-path');
  });

  it('uses x86_64 dynamic linker path for amd64 curl bakes', () => {
    expect(hummingbirdToolImageDynamicLinkerPath('amd64')).toBe('/lib64/ld-linux-x86-64.so.2');
    const lines = hummingbirdToolBakeContainerfileLines('curl', 'amd64');
    expect(lines.join('\n')).toContain('/lib64/ld-linux-x86-64.so.2');
  });

  it('keeps a single COPY for cosign', () => {
    const lines = hummingbirdToolBakeContainerfileLines('cosign', 'arm64');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('/usr/local/bin/cosign');
  });
});
