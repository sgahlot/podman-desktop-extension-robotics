import { afterEach, describe, expect, it } from 'vitest';
import { hostTargetArch } from './hostArch';

describe('hostTargetArch', () => {
  const originalArch = process.arch;

  afterEach(() => {
    Object.defineProperty(process, 'arch', { value: originalArch, configurable: true });
  });

  it('maps arm64 to arm64', () => {
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
    expect(hostTargetArch()).toBe('arm64');
  });

  it('maps any non-arm64 arch (e.g. x64) to amd64', () => {
    Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
    expect(hostTargetArch()).toBe('amd64');
  });
});
