import { browser } from 'wxt/browser';

import { DEFAULT_SETTINGS } from '../src/constants/defaults';
import type { ExtensionSettings, PageDisplayMode } from '../src/types/domain';
import { getSettings } from '../src/content/messaging';
import pageCss from '../src/content/page.css?inline';
import { PageTranslator } from '../src/content/page-translator';
import { SelectionController } from '../src/content/selection-controller';

type ContentMessage =
  | { type: 'page:get-state' }
  | { type: 'page:set-enabled'; enabled: boolean }
  | { type: 'page:toggle' }
  | { type: 'page:set-mode'; mode: PageDisplayMode }
  | { type: 'selection:translate-current' }
  | { type: 'settings:changed'; settings: ExtensionSettings };

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  async main() {
    await waitForBody();

    let settings = await getSettings().catch(() => DEFAULT_SETTINGS);
    const pageStyle = installPageStyle();
    const pageTranslator = new PageTranslator(settings);
    const selectionController = new SelectionController(settings);

    if (shouldAutoTranslate(settings)) pageTranslator.setEnabled(true);

    const onMessage = (rawMessage: unknown): Promise<unknown> | undefined => {
      if (!isContentMessage(rawMessage)) return undefined;

      switch (rawMessage.type) {
        case 'page:get-state':
          return Promise.resolve({ ok: true, state: pageTranslator.getState() });
        case 'page:set-enabled':
          return Promise.resolve({
            ok: true,
            state: pageTranslator.setEnabled(rawMessage.enabled),
          });
        case 'page:toggle':
          return Promise.resolve({
            ok: true,
            state: pageTranslator.setEnabled(!pageTranslator.isEnabled()),
          });
        case 'page:set-mode':
          settings = { ...settings, pageDisplayMode: rawMessage.mode };
          selectionController.updateSettings(settings);
          return Promise.resolve({
            ok: true,
            state: pageTranslator.setMode(rawMessage.mode),
          });
        case 'selection:translate-current':
          return selectionController.translateCurrentSelection().then(() => ({ ok: true }));
        case 'settings:changed': {
          const wasAutoEnabled = shouldAutoTranslate(settings);
          settings = rawMessage.settings;
          pageTranslator.updateSettings(settings);
          selectionController.updateSettings(settings);
          const isAutoEnabled = shouldAutoTranslate(settings);
          if (isAutoEnabled && !pageTranslator.isEnabled()) pageTranslator.setEnabled(true);
          if (!isAutoEnabled && wasAutoEnabled && pageTranslator.isEnabled()) pageTranslator.setEnabled(false);
          return Promise.resolve({ ok: true });
        }
      }
    };

    browser.runtime.onMessage.addListener(onMessage);

    const destroy = () => {
      browser.runtime.onMessage.removeListener(onMessage);
      pageTranslator.destroy();
      selectionController.destroy();
      pageStyle.remove();
    };

    window.addEventListener('pagehide', destroy, { once: true });
  },
});

function installPageStyle(): HTMLStyleElement {
  const style = document.createElement('style');
  style.dataset.liuyiRoot = 'page-style';
  style.textContent = pageCss;
  document.documentElement.append(style);
  return style;
}

function shouldAutoTranslate(settings: ExtensionSettings): boolean {
  return settings.autoTranslateHosts.some((host) => {
    const normalized = host.trim().toLowerCase();
    return normalized === location.hostname.toLowerCase()
      || normalized === location.origin.toLowerCase();
  });
}

function isContentMessage(message: unknown): message is ContentMessage {
  if (!message || typeof message !== 'object' || !('type' in message)) return false;
  const type = (message as { type?: unknown }).type;
  return type === 'page:get-state'
    || type === 'page:set-enabled'
    || type === 'page:toggle'
    || type === 'page:set-mode'
    || type === 'selection:translate-current'
    || type === 'settings:changed';
}

async function waitForBody(): Promise<void> {
  if (document.body) return;
  await new Promise<void>((resolve) => {
    document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
  });
}
