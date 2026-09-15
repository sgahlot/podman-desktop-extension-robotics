import { describe, expect, it } from 'vitest';
import { formatRpcError } from './formatRpcError';

describe('formatRpcError', () => {
  it('returns Error.message', () => {
    expect(formatRpcError(new Error('boom'), 'fallback')).toBe('boom');
  });

  it('returns string rejections from the RPC layer', () => {
    expect(formatRpcError('quota exceeded', 'fallback')).toBe('quota exceeded');
  });

  it('falls back for empty values', () => {
    expect(formatRpcError('', 'fallback')).toBe('fallback');
    expect(formatRpcError(undefined, 'fallback')).toBe('fallback');
  });
});
