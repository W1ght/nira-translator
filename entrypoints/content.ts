import { browser } from 'wxt/browser';

import { DEFAULT_SETTINGS } from '../src/constants/defaults';
import type { ExtensionSettings, PageDisplayMode } from '../src/types/domain';
import { getSettings } from '../src/content/messaging';
import pageCss from '../src/content/page.css?inline';
import { PageFloatingBall } from '../src/content/page-floating-ball';
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
  allFrames: true,
  matchAboutBlank: true,
  matchOriginAsFallback: true,
  runAt: 'document_idle',
  async main() {
    await waitForBody();

    let settings = await getSettings().catch(() => DEFAULT_SETTINGS);
    const pageStyle = installPageStyle();
    const pageTranslator = new PageTranslator(settings);
    const selectionController = new SelectionController(settings);

    if (shouldAutoTranslate(settings)) pageTranslator.setEnabled(true);

    let pageFloatingBall: PageFloatingBall | null = null;
    const setPageEnabled = (enabled: boolean) => {
      const state = pageTranslator.setEnabled(enabled);
      pageFloatingBall?.updateState(state);
      return state;
    };
    if (window === window.top) {
      pageFloatingBall = new PageFloatingBall(
        settings,
        pageTranslator.getState(),
        () => setPageEnabled(!pageTranslator.isEnabled()),
      );
    }

    const onMessage = (rawMessage: unknown): Promise<unknown> | undefined => {
      if (!isContentMessage(rawMessage)) return undefined;

      switch (rawMessage.type) {
        case 'page:get-state':
          return Promise.resolve({ ok: true, state: pageTranslator.getState() });
        case 'page:set-enabled':
          return Promise.resolve({
            ok: true,
            state: setPageEnabled(rawMessage.enabled),
          });
        case 'page:toggle':
          return Promise.resolve({
            ok: true,
            state: setPageEnabled(!pageTranslator.isEnabled()),
          });
        case 'page:set-mode':
          settings = { ...settings, pageDisplayMode: rawMessage.mode };
          selectionController.updateSettings(settings);
          const state = pageTranslator.setMode(rawMessage.mode);
          pageFloatingBall?.update(settings, state);
          return Promise.resolve({
            ok: true,
            state,
          });
        case 'selection:translate-current':
          return selectionController.translateCurrentSelection().then(() => ({ ok: true }));
        case 'settings:changed': {
          const wasAutoEnabled = shouldAutoTranslate(settings);
          settings = rawMessage.settings;
          pageTranslator.updateSettings(settings);
          selectionController.updateSettings(settings);
          const isAutoEnabled = shouldAutoTranslate(settings);
          if (isAutoEnabled && !pageTranslator.isEnabled()) setPageEnabled(true);
          if (!isAutoEnabled && wasAutoEnabled && pageTranslator.isEnabled()) setPageEnabled(false);
          pageFloatingBall?.update(settings, pageTranslator.getState());
          return Promise.resolve({ ok: true });
        }
      }
    };

    browser.runtime.onMessage.addListener(onMessage);

    const destroy = () => {
      browser.runtime.onMessage.removeListener(onMessage);
      pageTranslator.destroy();
      selectionController.destroy();
      pageFloatingBall?.destroy();
      pageStyle.remove();
    };

    window.addEventListener('pagehide', destroy, { once: true });
  },
});

function installPageStyle(): HTMLStyleElement {
  const style = document.createElement('style');
  style.dataset.niraRoot = 'page-style';
  style.textContent = pageCss;
  document.documentElement.append(style);
  return style;
}

function shouldAutoTranslate(settings: ExtensionSettings): boolean {
  const pageLocations = new Set([location.hostname.toLowerCase(), location.origin.toLowerCase()]);
  if (document.referrer) {
    try {
      const referrer = new URL(document.referrer);
      pageLocations.add(referrer.hostname.toLowerCase());
      pageLocations.add(referrer.origin.toLowerCase());
    } catch {
      // Invalid or opaque referrers do not participate in host matching.
    }
  }
  return settings.autoTranslateHosts.some((host) => {
    const normalized = host.trim().toLowerCase();
    return pageLocations.has(normalized);
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
