import { describe, it, expect } from 'vitest';
import { assertQuayName } from './quayNames';

describe('assertQuayName', () => {
  it('accepts valid Quay names', () => {
    expect(assertQuayName('ecosystem-appeng', 'namespace')).toBe('ecosystem-appeng');
    expect(assertQuayName('ros2-jazzy-sim', 'repository')).toBe('ros2-jazzy-sim');
    expect(assertQuayName('a', 'namespace')).toBe('a');
  });

  it('rejects path / query injection', () => {
    expect(() => assertQuayName('../admin', 'namespace')).toThrow(/Invalid Quay/);
    expect(() => assertQuayName('ns?x=1', 'namespace')).toThrow(/Invalid Quay/);
    expect(() => assertQuayName('ns/other', 'repository')).toThrow(/Invalid Quay/);
    expect(() => assertQuayName('NS', 'namespace')).toThrow(/Invalid Quay/);
    expect(() => assertQuayName('', 'namespace')).toThrow(/Invalid Quay/);
  });
});
