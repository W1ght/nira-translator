import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '../constants/defaults';
import type { PageTranslationState } from '../types/domain';
import { PageFloatingBall } from './page-floating-ball';

const activeBalls = new Set<PageFloatingBall>();

function state(enabled: boolean): PageTranslationState {
  return {
    enabled,
    mode: 'dual',
    sourceLanguage: 'auto',
    targetLanguage: 'zh-CN',
    translatedCount: enabled ? 2 : 0,
    pendingCount: 0,
    error: null,
  };
}

function createBall(
  enabled = false,
  onToggle = vi.fn(() => state(!enabled)),
): { ball: PageFloatingBall; host: HTMLDivElement; button: HTMLButtonElement } {
  const ball = new PageFloatingBall(DEFAULT_SETTINGS, state(enabled), onToggle);
  activeBalls.add(ball);
  const host = document.querySelector<HTMLDivElement>('[data-nira-root="page-floating-ball"]')!;
  const button = host.shadowRoot!.querySelector<HTMLButtonElement>('button')!;
  return { ball, host, button };
}

afterEach(() => {
  for (const ball of activeBalls) ball.destroy();
  activeBalls.clear();
});

describe('PageFloatingBall', () => {
  it('toggles page translation from the floating button and reflects the active state', async () => {
    const onToggle = vi.fn(() => state(true));
    const { button } = createBall(false, onToggle);

    expect(button.getAttribute('aria-label')).toBe('开启网页翻译');
    expect(button.dataset.enabled).toBe('false');

    button.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('aria-label')).toBe('关闭网页翻译');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.dataset.enabled).toBe('true');
  });

  it('follows visibility and theme settings without losing translation state', () => {
    const { ball, host, button } = createBall(true);

    ball.update({
      ...DEFAULT_SETTINGS,
      pageFloatingBallEnabled: false,
      theme: 'dark',
    }, state(true));

    expect(host.hidden).toBe(true);
    expect(host.dataset.theme).toBe('dark');
    expect(button.dataset.enabled).toBe('true');

    ball.update({ ...DEFAULT_SETTINGS, pageFloatingBallEnabled: true }, state(true));
    expect(host.hidden).toBe(false);
  });

  it('removes its isolated shadow host on destroy', () => {
    const { ball, host } = createBall();
    ball.destroy();
    activeBalls.delete(ball);

    expect(host.isConnected).toBe(false);
  });
});
