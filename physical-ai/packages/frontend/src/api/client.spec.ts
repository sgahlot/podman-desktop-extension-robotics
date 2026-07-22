import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockPostMessage = vi.fn();
const mockGetState = vi.fn();
const mockSetState = vi.fn();

vi.stubGlobal('acquirePodmanDesktopApi', () => ({
  postMessage: mockPostMessage,
  getState: mockGetState,
  setState: mockSetState,
}));

describe('client', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('saveRouterState', () => {
    it('saves state via podmanDesktopApi', async () => {
      const { saveRouterState } = await import('./client');
      saveRouterState({ url: '/images' });
      expect(mockSetState).toHaveBeenCalledWith({ url: '/images' });
    });
  });

  describe('getRouterState', () => {
    it('returns stored state', async () => {
      mockGetState.mockReturnValue({ url: '/help' });
      const { getRouterState } = await import('./client');
      expect(getRouterState()).toEqual({ url: '/help' });
    });

    it('returns default state when no state stored', async () => {
      mockGetState.mockReturnValue(null);
      const { getRouterState } = await import('./client');
      expect(getRouterState()).toEqual({ url: '/' });
    });

    it('returns default state for non-object state', async () => {
      mockGetState.mockReturnValue('invalid');
      const { getRouterState } = await import('./client');
      expect(getRouterState()).toEqual({ url: '/' });
    });
  });

  describe('exports', () => {
    it('exports physicalAiClient', async () => {
      const { physicalAiClient } = await import('./client');
      expect(physicalAiClient).toBeDefined();
    });

    it('exports rpcBrowser', async () => {
      const { rpcBrowser } = await import('./client');
      expect(rpcBrowser).toBeDefined();
    });
  });
});
