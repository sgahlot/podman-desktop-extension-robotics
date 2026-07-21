import type { ExtensionContext } from '@podman-desktop/api';
import * as extensionApi from '@podman-desktop/api';
import fs from 'node:fs';
import { RpcExtension } from '/@shared/src/messages/MessageProxy';
import { PhysicalAiApiImpl } from './api-impl';

export async function activate(extensionContext: ExtensionContext): Promise<void> {
  console.log('starting Physical AI extension');

  const panel = extensionApi.window.createWebviewPanel('physicalAi', 'Physical AI', {
    localResourceRoots: [extensionApi.Uri.joinPath(extensionContext.extensionUri, 'media')],
  });

  extensionContext.subscriptions.push(panel);

  const indexHtmlUri = extensionApi.Uri.joinPath(extensionContext.extensionUri, 'media', 'index.html');
  const indexHtmlPath = indexHtmlUri.fsPath;

  let indexHtml = await fs.promises.readFile(indexHtmlPath, 'utf8');

  const scriptLink = indexHtml.match(/<script.*?src="(.*?)".*?>/g);
  if (scriptLink) {
    scriptLink.forEach(link => {
      const src = link.match(/src="(.*?)"/);
      if (src) {
        const webviewSrc = panel.webview.asWebviewUri(
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
        const webviewHref = panel.webview.asWebviewUri(
          extensionApi.Uri.joinPath(extensionContext.extensionUri, 'media', href[1]),
        );
        indexHtml = indexHtml.replace(href[1], webviewHref.toString());
      }
    });
  }

  panel.webview.html = indexHtml;

  const rpcExtension = new RpcExtension(panel.webview);
  const physicalAiApi = new PhysicalAiApiImpl(extensionContext);
  rpcExtension.registerInstance<PhysicalAiApiImpl>(PhysicalAiApiImpl, physicalAiApi);
}

export async function deactivate(): Promise<void> {
  console.log('stopping Physical AI extension');
}
