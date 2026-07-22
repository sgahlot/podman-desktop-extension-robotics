import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { ExtensionContext } from '@podman-desktop/api';
import fs from 'node:fs';

vi.mock('@podman-desktop/api', () => {
  const mockWebview = {
    html: '',
    asWebviewUri: vi.fn((uri: any) => ({ toString: () => `webview-uri:${uri.fsPath}` })),
    onDidReceiveMessage: vi.fn(),
    postMessage: vi.fn(),
  };
  const mockPanel = {
    webview: mockWebview,
    dispose: vi.fn(),
  };
  return {
    provider: { createProvider: vi.fn(), getContainerConnections: vi.fn() },
    window: { createWebviewPanel: vi.fn(() => mockPanel), showInformationMessage: vi.fn() },
    commands: { registerCommand: vi.fn() },
    containerEngine: { listImages: vi.fn(), pullImage: vi.fn(), buildImage: vi.fn(), pushImage: vi.fn() },
    configuration: { getConfiguration: vi.fn() },
    Uri: { joinPath: vi.fn((...parts: any[]) => ({ fsPath: parts.map((p: any) => p.fsPath ?? p).join('/') })) },
    Disposable: { create: vi.fn() },
  };
});

vi.mock('node:fs', () => ({
  default: {
    promises: {
      readFile: vi.fn(),
    },
  },
}));

const mockRegisterInstance = vi.fn();
vi.mock('/@shared/src/messages/MessageProxy', () => ({
  RpcExtension: class {
    registerInstance = mockRegisterInstance;
  },
}));

import * as extensionApi from '@podman-desktop/api';
import { activate, deactivate } from './extension';

const MOCK_CONTEXT = {
  extensionUri: { fsPath: '/fake/extension' },
  subscriptions: [] as any[],
} as unknown as ExtensionContext;

describe('extension', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    MOCK_CONTEXT.subscriptions = [];

    vi.mocked(extensionApi.window.createWebviewPanel).mockReturnValue({
      webview: {
        html: '',
        asWebviewUri: vi.fn((uri: any) => ({ toString: () => `webview-uri:${uri.fsPath}` })),
        onDidReceiveMessage: vi.fn(),
        postMessage: vi.fn(),
      },
      dispose: vi.fn(),
    } as any);

    vi.mocked(extensionApi.Uri.joinPath).mockImplementation(
      (...parts: any[]) => ({ fsPath: parts.map((p: any) => p.fsPath ?? p).join('/') }) as any,
    );
  });

  describe('activate', () => {
    it('creates a webview panel', async () => {
      vi.mocked(fs.promises.readFile).mockResolvedValue('<html></html>');

      await activate(MOCK_CONTEXT);

      expect(extensionApi.window.createWebviewPanel).toHaveBeenCalledWith(
        'physicalAi',
        'Physical AI',
        expect.objectContaining({ localResourceRoots: expect.any(Array) }),
      );
    });

    it('adds panel to subscriptions for disposal', async () => {
      vi.mocked(fs.promises.readFile).mockResolvedValue('<html></html>');

      await activate(MOCK_CONTEXT);

      expect(MOCK_CONTEXT.subscriptions).toHaveLength(1);
    });

    it('reads index.html from media directory', async () => {
      vi.mocked(fs.promises.readFile).mockResolvedValue('<html></html>');

      await activate(MOCK_CONTEXT);

      expect(fs.promises.readFile).toHaveBeenCalledWith(
        expect.stringContaining('media/index.html'),
        'utf8',
      );
    });

    it('rewrites script src to webview URIs', async () => {
      vi.mocked(fs.promises.readFile).mockResolvedValue(
        '<html><script type="module" src="index-abc.js"></script></html>',
      );

      await activate(MOCK_CONTEXT);

      const panel = vi.mocked(extensionApi.window.createWebviewPanel).mock.results[0].value;
      expect(panel.webview.html).toContain('webview-uri:');
      expect(panel.webview.html).not.toContain('src="index-abc.js"');
    });

    it('rewrites css href to webview URIs', async () => {
      vi.mocked(fs.promises.readFile).mockResolvedValue(
        '<html><link rel="stylesheet" href="index-abc.css"></html>',
      );

      await activate(MOCK_CONTEXT);

      const panel = vi.mocked(extensionApi.window.createWebviewPanel).mock.results[0].value;
      expect(panel.webview.html).toContain('webview-uri:');
      expect(panel.webview.html).not.toContain('href="index-abc.css"');
    });

    it('sets the webview html', async () => {
      vi.mocked(fs.promises.readFile).mockResolvedValue('<html><body>test</body></html>');

      await activate(MOCK_CONTEXT);

      const panel = vi.mocked(extensionApi.window.createWebviewPanel).mock.results[0].value;
      expect(panel.webview.html).toBeTruthy();
    });
  });

  describe('deactivate', () => {
    it('completes without error', async () => {
      await expect(deactivate()).resolves.toBeUndefined();
    });
  });
});
