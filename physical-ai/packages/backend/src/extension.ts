import type { ExtensionContext, WebviewPanel } from '@podman-desktop/api';
import * as extensionApi from '@podman-desktop/api';
import fs from 'node:fs';
import { RpcExtension } from '/@shared/src/messages/MessageProxy';
import { PhysicalAiApiImpl } from './api-impl';

const COMMAND_OPEN = 'physical-ai.open';

let panel: WebviewPanel | undefined;

async function createDashboardPanel(extensionContext: ExtensionContext): Promise<WebviewPanel> {
  const newPanel = extensionApi.window.createWebviewPanel('physicalAi', 'Physical AI', {
    localResourceRoots: [extensionApi.Uri.joinPath(extensionContext.extensionUri, 'media')],
  });

  const indexHtmlUri = extensionApi.Uri.joinPath(extensionContext.extensionUri, 'media', 'index.html');
  const indexHtmlPath = indexHtmlUri.fsPath;

  let indexHtml = await fs.promises.readFile(indexHtmlPath, 'utf8');

  const scriptLink = indexHtml.match(/<script.*?src="(.*?)".*?>/g);
  if (scriptLink) {
    scriptLink.forEach(link => {
      const src = link.match(/src="(.*?)"/);
      if (src) {
        const webviewSrc = newPanel.webview.asWebviewUri(
          extensionApi.Uri.joinPath(extensionContext.extensionUri, 'media', src[1]),
        );
        indexHtml = indexHtml.replace(src[1], webviewSrc.toString());
      }
    });
  }

  const cssLink = indexHtml.match(/<link.*?href="(.*?)".*?>/g);
  if (cssLink) {
    cssLink.forEach(link => {
      const href = link.match(/href="(.*?)"/);
      if (href) {
        const webviewHref = newPanel.webview.asWebviewUri(
          extensionApi.Uri.joinPath(extensionContext.extensionUri, 'media', href[1]),
        );
        indexHtml = indexHtml.replace(href[1], webviewHref.toString());
      }
    });
  }

  newPanel.webview.html = indexHtml;

  const rpcExtension = new RpcExtension(newPanel.webview);
  const physicalAiApi = new PhysicalAiApiImpl(extensionContext);
  rpcExtension.registerInstance<PhysicalAiApiImpl>(PhysicalAiApiImpl, physicalAiApi);

  newPanel.onDidDispose(() => {
    if (panel === newPanel) {
      panel = undefined;
    }
  });

  return newPanel;
}

async function openDashboard(extensionContext: ExtensionContext): Promise<void> {
  if (panel) {
    panel.reveal();
    return;
  }

  panel = await createDashboardPanel(extensionContext);
  extensionContext.subscriptions.push(panel);
}

export async function activate(extensionContext: ExtensionContext): Promise<void> {
  console.log('starting Physical AI extension');

  await openDashboard(extensionContext);

  extensionContext.subscriptions.push(
    extensionApi.commands.registerCommand(COMMAND_OPEN, async () => {
      await openDashboard(extensionContext);
    }),
  );
}

export async function deactivate(): Promise<void> {
  panel = undefined;
  console.log('stopping Physical AI extension');
}
