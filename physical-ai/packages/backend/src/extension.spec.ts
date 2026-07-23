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
    reveal: vi.fn(),
    onDidDispose: vi.fn(),
  };
  return {
    provider: { createProvider: vi.fn(), getContainerConnections: vi.fn() },
    window: { createWebviewPanel: vi.fn(() => mockPanel), showInformationMessage: vi.fn() },
    commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })) },
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

function mockPanel() {
  return {
    webview: {
      html: '',
      asWebviewUri: vi.fn((uri: any) => ({ toString: () => `webview-uri:${uri.fsPath}` })),
      onDidReceiveMessage: vi.fn(),
      postMessage: vi.fn(),
    },
    dispose: vi.fn(),
    reveal: vi.fn(),
    onDidDispose: vi.fn(),
  };
}

describe('extension', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    MOCK_CONTEXT.subscriptions = [];
    await deactivate();

    vi.mocked(extensionApi.window.createWebviewPanel).mockImplementation(() => mockPanel() as any);
    vi.mocked(extensionApi.commands.registerCommand).mockReturnValue({ dispose: vi.fn() } as any);

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

    it('registers physical-ai.open and adds panel + command to subscriptions', async () => {
      vi.mocked(fs.promises.readFile).mockResolvedValue('<html></html>');

      await activate(MOCK_CONTEXT);

      expect(extensionApi.commands.registerCommand).toHaveBeenCalledWith(
        'physical-ai.open',
        expect.any(Function),
      );
      expect(MOCK_CONTEXT.subscriptions).toHaveLength(2);
    });

    it('reveals existing panel when physical-ai.open runs again', async () => {
      vi.mocked(fs.promises.readFile).mockResolvedValue('<html></html>');

      await activate(MOCK_CONTEXT);
      const panel = vi.mocked(extensionApi.window.createWebviewPanel).mock.results[0].value;
      const openHandler = vi.mocked(extensionApi.commands.registerCommand).mock.calls[0][1];

      await openHandler();

      expect(panel.reveal).toHaveBeenCalled();
      expect(extensionApi.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    });

    it('recreates panel after dispose when physical-ai.open runs', async () => {
      vi.mocked(fs.promises.readFile).mockResolvedValue('<html></html>');

      await activate(MOCK_CONTEXT);
      const firstPanel = vi.mocked(extensionApi.window.createWebviewPanel).mock.results[0].value;
      const disposeHandler = vi.mocked(firstPanel.onDidDispose).mock.calls[0][0];
      disposeHandler();

      const openHandler = vi.mocked(extensionApi.commands.registerCommand).mock.calls[0][1];
      await openHandler();

      expect(extensionApi.window.createWebviewPanel).toHaveBeenCalledTimes(2);
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
