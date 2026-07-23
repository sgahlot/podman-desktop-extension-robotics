import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isMessageRequest,
  isMessageResponse,
  RpcExtension,
  RpcBrowser,
} from './MessageProxy';

vi.mock('@podman-desktop/api', () => ({}));

describe('isMessageRequest', () => {
  it('returns true for valid request', () => {
    expect(isMessageRequest({ id: 1, channel: 'test', args: [] })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isMessageRequest(null)).toBe(false);
  });

  it('returns false for missing id', () => {
    expect(isMessageRequest({ channel: 'test' })).toBe(false);
  });

  it('returns false for missing channel', () => {
    expect(isMessageRequest({ id: 1 })).toBe(false);
  });

  it('returns false for non-object', () => {
    expect(isMessageRequest('string')).toBe(false);
  });
});

describe('isMessageResponse', () => {
  it('returns true for valid response', () => {
    expect(isMessageResponse({ id: 1, channel: 'test', args: [], status: 'success', body: 'ok' })).toBe(true);
  });

  it('returns false for request without status', () => {
    expect(isMessageResponse({ id: 1, channel: 'test', args: [] })).toBe(false);
  });

  it('returns false for non-object', () => {
    expect(isMessageResponse(42)).toBe(false);
  });
});

describe('RpcExtension', () => {
  let rpcExt: RpcExtension;
  let mockWebview: any;
  let messageHandler: (msg: unknown) => Promise<void>;

  beforeEach(() => {
    mockWebview = {
      onDidReceiveMessage: vi.fn((handler: any) => {
        messageHandler = handler;
      }),
      postMessage: vi.fn(),
    };
    rpcExt = new RpcExtension(mockWebview);
  });

  it('registers message listener on init', () => {
    expect(mockWebview.onDidReceiveMessage).toHaveBeenCalledOnce();
  });

  it('registers a method and calls it on message', async () => {
    const handler = vi.fn().mockResolvedValue('result');
    rpcExt.register('myMethod', handler);

    await messageHandler({ id: 1, channel: 'myMethod', args: ['arg1'] });

    expect(handler).toHaveBeenCalledWith('arg1');
    expect(mockWebview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        channel: 'myMethod',
        body: 'result',
        status: 'success',
      }),
    );
  });

  it('sends error response when method throws', async () => {
    rpcExt.register('failing', vi.fn().mockRejectedValue(new Error('boom')));

    await messageHandler({ id: 2, channel: 'failing', args: [] });

    expect(mockWebview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 2,
        status: 'error',
        error: 'boom',
      }),
    );
  });

  it('sends error response when method throws a string', async () => {
    rpcExt.register('failing', vi.fn().mockRejectedValue('string error'));

    await messageHandler({ id: 3, channel: 'failing', args: [] });

    expect(mockWebview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        error: 'string error',
      }),
    );
  });

  it('ignores non-request messages', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await messageHandler('not a valid message');
    expect(mockWebview.postMessage).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('throws on unknown channel', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      messageHandler({ id: 4, channel: 'unknown', args: [] }),
    ).rejects.toThrow('channel does not exist');
    consoleSpy.mockRestore();
  });

  describe('registerInstance', () => {
    it('registers all prototype methods of a class', () => {
      class TestApi {
        async methodA(): Promise<string> { return 'a'; }
        async methodB(): Promise<string> { return 'b'; }
      }

      const instance = new TestApi();
      rpcExt.registerInstance(TestApi, instance);

      expect(rpcExt.methods.has('methodA')).toBe(true);
      expect(rpcExt.methods.has('methodB')).toBe(true);
      expect(rpcExt.methods.has('constructor')).toBe(false);
    });

    it('binds methods to the instance', async () => {
      class TestApi {
        value = 'hello';
        async getValue(): Promise<string> { return this.value; }
      }

      const instance = new TestApi();
      rpcExt.registerInstance(TestApi, instance);

      const result = await rpcExt.methods.get('getValue')!();
      expect(result).toBe('hello');
    });

    it('does not register JavaScript private (#) methods', () => {
      class TestApi {
        async publicMethod(): Promise<string> {
          return 'public';
        }
        #hidden(): Promise<string> {
          return Promise.resolve('secret');
        }
        callHidden(): Promise<string> {
          return this.#hidden();
        }
      }

      const instance = new TestApi();
      rpcExt.registerInstance(TestApi, instance);

      expect(rpcExt.methods.has('publicMethod')).toBe(true);
      expect(rpcExt.methods.has('callHidden')).toBe(true);
      expect(rpcExt.methods.has('#hidden')).toBe(false);
      expect(
        Object.getOwnPropertyNames(TestApi.prototype).some(n => n.includes('hidden')),
      ).toBe(false);
    });
  });
});

describe('RpcBrowser', () => {
  let rpcBrowser: RpcBrowser;
  let mockApi: any;
  let windowMessageHandler: (event: MessageEvent) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    mockApi = {
      postMessage: vi.fn(),
    };
    const mockWindow = {
      addEventListener: vi.fn((event: string, handler: any) => {
        if (event === 'message') windowMessageHandler = handler;
      }),
    };
    rpcBrowser = new RpcBrowser(mockWindow as any, mockApi);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers message listener on init', () => {
    expect(windowMessageHandler).toBeDefined();
  });

  it('generates unique IDs', () => {
    const id1 = rpcBrowser.getUniqueId();
    const id2 = rpcBrowser.getUniqueId();
    expect(id2).toBe(id1 + 1);
  });

  describe('invoke', () => {
    it('posts a message with channel and args', async () => {
      const promise = rpcBrowser.invoke('myMethod', 'arg1', 'arg2');

      expect(mockApi.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'myMethod',
          args: ['arg1', 'arg2'],
        }),
      );

      windowMessageHandler(new MessageEvent('message', {
        data: { id: 1, channel: 'myMethod', args: [], status: 'success', body: 'result' },
      }));

      await expect(promise).resolves.toBe('result');
    });

    it('rejects on error response', async () => {
      const promise = rpcBrowser.invoke('myMethod');

      windowMessageHandler(new MessageEvent('message', {
        data: { id: 1, channel: 'myMethod', args: [], status: 'error', error: 'fail' },
      }));

      await expect(promise).rejects.toBe('fail');
    });

    it('rejects on timeout', async () => {
      const promise = rpcBrowser.invoke('myMethod');
      const rejection = expect(promise).rejects.toThrow('Timeout');

      await vi.advanceTimersByTimeAsync(600000);

      await rejection;
    });
  });

  describe('getProxy', () => {
    it('creates a proxy that invokes methods', async () => {
      const proxy = rpcBrowser.getProxy<{ myMethod: (a: string) => Promise<string> }>();

      const promise = proxy.myMethod('test');
      expect(mockApi.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'myMethod', args: ['test'] }),
      );

      windowMessageHandler(new MessageEvent('message', {
        data: { id: 1, channel: 'myMethod', args: [], status: 'success', body: 'proxied' },
      }));

      await expect(promise).resolves.toBe('proxied');
    });
  });

  describe('subscribe', () => {
    it('calls handler on subscribed message', () => {
      const handler = vi.fn();
      rpcBrowser.subscribe('sub-1', handler);

      windowMessageHandler(new MessageEvent('message', {
        data: { id: 'sub-1', body: 'hello' },
      }));

      expect(handler).toHaveBeenCalledWith('hello');
    });

    it('unsubscribe removes the handler', () => {
      const handler = vi.fn();
      const sub = rpcBrowser.subscribe('sub-2', handler);
      sub.unsubscribe();

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      windowMessageHandler(new MessageEvent('message', {
        data: { id: 'sub-2', body: 'hello' },
      }));
      consoleSpy.mockRestore();

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('isSubscribedMessage', () => {
    it('returns true for subscribed message', () => {
      rpcBrowser.subscribe('sub-1', vi.fn());
      expect(rpcBrowser.isSubscribedMessage({ id: 'sub-1', body: 'test' })).toBe(true);
    });

    it('returns false for non-subscribed id', () => {
      expect(rpcBrowser.isSubscribedMessage({ id: 'unknown', body: 'test' })).toBe(false);
    });

    it('returns false for numeric id (request/response)', () => {
      expect(rpcBrowser.isSubscribedMessage({ id: 1, body: 'test' })).toBe(false);
    });

    it('returns false for missing body', () => {
      rpcBrowser.subscribe('sub-1', vi.fn());
      expect(rpcBrowser.isSubscribedMessage({ id: 'sub-1' })).toBe(false);
    });
  });
});
