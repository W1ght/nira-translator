import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SelectionOverlay, type SelectionOverlayProps } from './SelectionOverlay';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function renderOverlay(patch: Partial<SelectionOverlayProps> = {}): HTMLDivElement {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const props: SelectionOverlayProps = {
    anchor: { triggerLeft: 10, triggerTop: 10, panelLeft: 10, panelTop: 30 },
    panel: { status: 'closed' },
    showTrigger: true,
    theme: 'light',
    targetLanguageLabel: '简体中文',
    onTranslate: vi.fn(),
    onClose: vi.fn(),
    onRetry: vi.fn(),
    onReload: vi.fn(),
    ...patch,
  };
  act(() => root?.render(createElement(SelectionOverlay, props)));
  return container;
}

describe('SelectionOverlay interactions', () => {
  it('starts translation when the small trigger is hovered', () => {
    const onTranslate = vi.fn();
    const view = renderOverlay({ onTranslate });
    const trigger = view.querySelector<HTMLButtonElement>('.nira-trigger');
    expect(trigger).not.toBeNull();
    act(() => trigger?.dispatchEvent(new Event('pointerover', { bubbles: true })));
    expect(onTranslate).toHaveBeenCalledTimes(1);
  });

  it('offers page reload instead of retry for an invalid context', () => {
    const onReload = vi.fn();
    const view = renderOverlay({
      panel: { status: 'error', message: 'Nira translator 已更新，请刷新当前页面后重新划词。', action: 'reload' },
      showTrigger: false,
      onReload,
    });
    const button = [...view.querySelectorAll('button')].find((item) => item.textContent === '刷新页面');
    expect(button).toBeDefined();
    act(() => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
