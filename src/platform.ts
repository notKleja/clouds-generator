import { BrowserHost } from './browser-host';

declare const __WEB_APP__: boolean;
export const IS_WEB = typeof __WEB_APP__ !== 'undefined' && __WEB_APP__;
let browserHost: BrowserHost | undefined;
function webHost() {
  if (browserHost) return browserHost;
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    /* Temporary presets still work. */
  }
  browserHost = new BrowserHost(
    storage,
    (message) => {
      window.dispatchEvent(
        new MessageEvent('message', { source: window, data: { pluginMessage: message } }),
      );
    },
    (bytes, filename) => {
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    },
  );
  return browserHost;
}
export function sendHostMessage(message: unknown): void {
  if (IS_WEB)
    queueMicrotask(() => {
      void webHost().receive(message);
    });
  else parent.postMessage({ pluginMessage: message }, '*');
}
