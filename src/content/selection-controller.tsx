import { createRoot, type Root } from 'react-dom/client';

import { languageLabel } from '../constants/languages';
import type {
  ExtensionSettings,
  ThemeMode,
  TranslationErrorPayload,
  TranslationRequest,
} from '../types/domain';
import { createJobId, requestTranslation, cancelTranslation } from './messaging';
import {
  SelectionOverlay,
  type OverlayAnchor,
  type OverlayPanel,
} from './SelectionOverlay';
import selectionCss from './selection.css?inline';
import { selectionErrorState } from './selection-errors';

const MAX_SELECTION_CHARACTERS = 16_000;

interface SelectionSnapshot {
  text: string;
  rect: DOMRect;
}

interface RuntimeError extends Error {
  payload?: TranslationErrorPayload;
}

export class SelectionController {
  private settings: ExtensionSettings;
  private readonly host: HTMLDivElement;
  private readonly root: Root;
  private readonly colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
  private snapshot: SelectionSnapshot | null = null;
  private anchor: OverlayAnchor | null = null;
  private panel: OverlayPanel = { status: 'closed' };
  private showTrigger = false;
  private activeJobId: string | null = null;
  private requestGeneration = 0;

  constructor(settings: ExtensionSettings) {
    this.settings = settings;
    this.host = document.createElement('div');
    this.host.dataset.niraRoot = 'selection';
    this.host.setAttribute('aria-label', 'Nira translator 划词翻译');

    const shadowRoot = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = selectionCss;
    const mount = document.createElement('div');
    shadowRoot.append(style, mount);
    document.documentElement.append(this.host);
    this.root = createRoot(mount);

    document.addEventListener('mouseup', this.handleMouseUp, true);
    document.addEventListener('keyup', this.handleKeyUp, true);
    document.addEventListener('keydown', this.handleKeyDown, true);
    document.addEventListener('scroll', this.handleScroll, true);
    window.addEventListener('resize', this.handleResize, { passive: true });
    this.colorScheme.addEventListener('change', this.handleThemeChange);
    this.render();
  }

  updateSettings(settings: ExtensionSettings): void {
    this.settings = settings;
    if (!settings.selectionButtonEnabled && this.panel.status === 'closed') {
      this.showTrigger = false;
    }
    this.render();
  }

  async translateCurrentSelection(): Promise<void> {
    const current = readSelection();
    if (current) this.setSnapshot(current, false);
    if (!this.snapshot) return;
    await this.translateSnapshot();
  }

  destroy(): void {
    document.removeEventListener('mouseup', this.handleMouseUp, true);
    document.removeEventListener('keyup', this.handleKeyUp, true);
    document.removeEventListener('keydown', this.handleKeyDown, true);
    document.removeEventListener('scroll', this.handleScroll, true);
    window.removeEventListener('resize', this.handleResize);
    this.colorScheme.removeEventListener('change', this.handleThemeChange);
    if (this.activeJobId) void cancelTranslation(this.activeJobId);
    this.root.unmount();
    this.host.remove();
  }

  private readonly handleMouseUp = (event: MouseEvent): void => {
    if (event.composedPath().includes(this.host)) return;
    window.setTimeout(() => {
      const snapshot = readSelection();
      if (!snapshot) {
        if (this.panel.status === 'closed') this.hide();
        return;
      }
      this.setSnapshot(snapshot, this.settings.selectionButtonEnabled);
    }, 10);
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (!event.shiftKey && !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      return;
    }
    const snapshot = readSelection();
    if (snapshot) this.setSnapshot(snapshot, this.settings.selectionButtonEnabled);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && (this.panel.status !== 'closed' || this.showTrigger)) {
      this.close();
    }
  };

  private readonly handleScroll = (): void => {
    if (this.panel.status === 'closed') this.hide();
  };

  private readonly handleResize = (): void => {
    if (!this.snapshot) return;
    this.anchor = positionOverlay(this.snapshot.rect, this.panel.status);
    this.render();
  };

  private readonly handleThemeChange = (): void => {
    if (this.settings.theme === 'system') this.render();
  };

  private setSnapshot(snapshot: SelectionSnapshot, showTrigger: boolean): void {
    if (this.panel.status !== 'closed') {
      this.requestGeneration += 1;
      if (this.activeJobId) void cancelTranslation(this.activeJobId);
      this.activeJobId = null;
      this.panel = { status: 'closed' };
    }
    this.snapshot = snapshot;
    this.anchor = positionOverlay(snapshot.rect, this.panel.status);
    this.showTrigger = showTrigger;
    this.render();
  }

  private async translateSnapshot(): Promise<void> {
    if (!this.snapshot) return;
    if (this.activeJobId) void cancelTranslation(this.activeJobId);

    const generation = ++this.requestGeneration;
    const jobId = createJobId('selection');
    const sourceText = this.snapshot.text;
    this.activeJobId = jobId;
    this.showTrigger = false;
    this.panel = { status: 'loading' };
    this.anchor = positionOverlay(this.snapshot.rect, 'loading');
    this.render();

    try {
      const result = await requestTranslation(
        createSelectionTranslationRequest(this.settings, jobId, sourceText),
      );

      if (generation !== this.requestGeneration) return;
      const translation = result.translations.find((item) => item.id === 'selection-0')?.text;
      if (!translation) throw new Error('模型没有返回翻译内容');
      this.panel = { status: 'result', text: translation, sourceText };
      this.anchor = positionOverlay(this.snapshot.rect, 'result');
    } catch (error) {
      if (generation !== this.requestGeneration) return;
      const runtimeError = error as RuntimeError;
      this.panel = {
        status: 'error',
        ...selectionErrorState(runtimeError.payload, runtimeError.message),
      };
      this.anchor = positionOverlay(this.snapshot.rect, 'error');
    } finally {
      if (generation === this.requestGeneration) this.activeJobId = null;
      this.render();
    }
  }

  private close = (): void => {
    this.requestGeneration += 1;
    if (this.activeJobId) void cancelTranslation(this.activeJobId);
    this.activeJobId = null;
    this.panel = { status: 'closed' };
    this.showTrigger = false;
    this.snapshot = null;
    this.anchor = null;
    this.render();
  };

  private hide(): void {
    this.showTrigger = false;
    this.anchor = null;
    this.snapshot = null;
    this.render();
  }

  private render(): void {
    this.root.render(
      <SelectionOverlay
        anchor={this.anchor}
        panel={this.panel}
        showTrigger={this.showTrigger}
        theme={resolveTheme(this.settings.theme, this.colorScheme.matches)}
        targetLanguageLabel={languageLabel(this.settings.targetLanguage)}
        onTranslate={() => void this.translateSnapshot()}
        onClose={this.close}
        onRetry={() => void this.translateSnapshot()}
        onReload={() => window.location.reload()}
      />,
    );
  }
}

export function createSelectionTranslationRequest(
  settings: ExtensionSettings,
  jobId: string,
  sourceText: string,
): TranslationRequest {
  return {
    jobId,
    kind: 'selection',
    sourceLanguage: settings.sourceLanguage,
    targetLanguage: settings.targetLanguage,
    segments: [{ id: 'selection-0', text: sourceText }],
    ...(settings.selectionProfileId ? { profileId: settings.selectionProfileId } : {}),
  };
}

function readSelection(): SelectionSnapshot | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const text = selection.toString().replace(/\u00a0/g, ' ').trim();
  if (text.length < 1) return null;

  const range = selection.getRangeAt(0);
  const ancestor = range.commonAncestorContainer;
  const ancestorElement = ancestor instanceof Element ? ancestor : ancestor.parentElement;
  if (ancestorElement?.closest('[data-nira-root], input, textarea, [contenteditable="true"]')) return null;

  let rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    const rects = range.getClientRects();
    rect = rects.item(rects.length - 1) ?? rect;
  }
  if (rect.width === 0 && rect.height === 0) return null;

  return {
    text: text.slice(0, MAX_SELECTION_CHARACTERS),
    rect: new DOMRect(rect.x, rect.y, rect.width, rect.height),
  };
}

function positionOverlay(rect: DOMRect, status: OverlayPanel['status']): OverlayAnchor {
  const margin = 12;
  const triggerSize = 12;
  const panelWidth = Math.min(388, window.innerWidth - margin * 2);
  const estimatedHeight = status === 'loading' || status === 'closed' ? 150 : Math.min(380, window.innerHeight * 0.7);

  const preferredTriggerLeft = rect.right + 5;
  const triggerLeft = clamp(
    preferredTriggerLeft + triggerSize <= window.innerWidth - margin
      ? preferredTriggerLeft
      : rect.left - triggerSize - 5,
    margin,
    window.innerWidth - triggerSize - margin,
  );
  const triggerTop = clamp(rect.bottom + 5, margin, window.innerHeight - triggerSize - margin);

  const panelLeft = clamp(rect.left, margin, window.innerWidth - panelWidth - margin);
  const below = rect.bottom + 12;
  const panelTop = below + estimatedHeight <= window.innerHeight - margin
    ? below
    : clamp(rect.top - estimatedHeight - 12, margin, window.innerHeight - estimatedHeight - margin);

  return { triggerLeft, triggerTop, panelLeft, panelTop };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function resolveTheme(theme: ThemeMode, prefersDark: boolean): 'light' | 'dark' {
  if (theme === 'system') return prefersDark ? 'dark' : 'light';
  return theme;
}
