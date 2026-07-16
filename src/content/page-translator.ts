import type {
  ExtensionSettings,
  PageDisplayMode,
  PageTranslationState,
  TranslationErrorPayload,
  TranslationSegment,
} from '../types/domain';
import { cancelTranslation, createJobId, requestTranslation } from './messaging';

const BLOCK_SELECTOR = [
  'p',
  'li',
  'blockquote',
  'figcaption',
  'dd',
  'dt',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
].join(',');

const EXCLUDED_SELECTOR = [
  '[data-liuyi-root]',
  '[data-liuyi-translation]',
  '[translate="no"]',
  '[hidden]',
  '[inert]',
  '[aria-hidden="true"]',
  '[contenteditable="true"]',
  'script',
  'style',
  'noscript',
  'template',
  'textarea',
  'input',
  'select',
  'option',
  'button',
  'nav',
  'header',
  'footer',
  'aside',
  'code',
  'pre',
  'kbd',
  'samp',
  'svg',
  'canvas',
  'math',
].join(',');

const MAX_BATCH_SEGMENTS = 4;
const MAX_BATCH_CHARACTERS = 4_000;
const CHUNK_SIZE = 3_850;
const MAX_CONCURRENCY = 2;

type BlockStatus = 'observed' | 'queued' | 'translating' | 'translated';

interface BlockRecord {
  element: HTMLElement;
  id: string;
  sourceText: string;
  chunks: string[];
  translations: Array<string | undefined>;
  status: BlockStatus;
  translationElement: HTMLElement | null;
  generation: number;
}

interface WorkItem {
  record: BlockRecord;
  chunkIndex: number;
  segment: TranslationSegment;
}

interface RuntimeError extends Error {
  payload?: TranslationErrorPayload;
}

export class PageTranslator {
  private settings: ExtensionSettings;
  private readonly records = new Map<HTMLElement, BlockRecord>();
  private readonly queue: WorkItem[] = [];
  private readonly queuedIds = new Set<string>();
  private readonly activeJobs = new Set<string>();
  private intersectionObserver: IntersectionObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private mutationTimer: number | null = null;
  private enabled = false;
  private inFlight = 0;
  private generation = 0;
  private nextBlockId = 0;
  private lastError: TranslationErrorPayload | null = null;

  constructor(settings: ExtensionSettings) {
    this.settings = settings;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  updateSettings(settings: ExtensionSettings): void {
    const previousMode = this.settings.pageDisplayMode;
    this.settings = settings;
    if (previousMode !== settings.pageDisplayMode) {
      this.setMode(settings.pageDisplayMode);
    }
  }

  getState(): PageTranslationState {
    let translatedCount = 0;
    let pendingCount = 0;

    for (const record of this.records.values()) {
      if (record.status === 'translated') translatedCount += 1;
      else pendingCount += 1;
    }

    return {
      enabled: this.enabled,
      mode: this.settings.pageDisplayMode,
      sourceLanguage: this.settings.sourceLanguage,
      targetLanguage: this.settings.targetLanguage,
      translatedCount,
      pendingCount,
      error: this.lastError,
    };
  }

  setEnabled(enabled: boolean): PageTranslationState {
    if (enabled === this.enabled) return this.getState();
    if (enabled) this.start();
    else this.stop();
    return this.getState();
  }

  setMode(mode: PageDisplayMode): PageTranslationState {
    this.settings = { ...this.settings, pageDisplayMode: mode };
    for (const record of this.records.values()) {
      this.applyDisplayMode(record);
    }
    return this.getState();
  }

  destroy(): void {
    this.stop();
  }

  private start(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.generation += 1;
    this.lastError = null;

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => viewportDistance(a.boundingClientRect) - viewportDistance(b.boundingClientRect));

        for (const entry of visible) {
          const record = this.records.get(entry.target as HTMLElement);
          if (record) this.enqueueRecord(record);
        }
      },
      { rootMargin: '800px 0px', threshold: 0.01 },
    );

    this.mutationObserver = new MutationObserver((mutations) => {
      if (!this.enabled) return;
      if (this.mutationTimer !== null) window.clearTimeout(this.mutationTimer);
      this.mutationTimer = window.setTimeout(() => {
        this.mutationTimer = null;
        this.handleMutations(mutations);
      }, 180);
    });

    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    this.scan(document.body);
  }

  private stop(): void {
    if (!this.enabled && this.records.size === 0) return;
    this.enabled = false;
    this.generation += 1;
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;

    if (this.mutationTimer !== null) {
      window.clearTimeout(this.mutationTimer);
      this.mutationTimer = null;
    }

    this.queue.length = 0;
    this.queuedIds.clear();

    for (const jobId of this.activeJobs) void cancelTranslation(jobId);
    this.activeJobs.clear();

    for (const record of this.records.values()) {
      record.translationElement?.remove();
      record.element.removeAttribute('data-liuyi-source-hidden');
    }
    this.records.clear();
    this.lastError = null;
  }

  private scan(root: ParentNode): void {
    if (!this.enabled) return;
    const candidates: HTMLElement[] = [];

    if (root instanceof HTMLElement && root.matches(BLOCK_SELECTOR)) candidates.push(root);
    for (const element of root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)) candidates.push(element);

    for (const element of candidates) {
      if (this.records.has(element) || !this.isCandidate(element)) continue;
      const sourceText = readableText(element);
      if (sourceText.length < 2) continue;

      const id = `block-${++this.nextBlockId}`;
      const chunks = splitText(sourceText, CHUNK_SIZE);
      const record: BlockRecord = {
        element,
        id,
        sourceText,
        chunks,
        translations: new Array<string | undefined>(chunks.length),
        status: 'observed',
        translationElement: null,
        generation: this.generation,
      };
      this.records.set(element, record);
      this.intersectionObserver?.observe(element);

      if (isNearViewport(element)) this.enqueueRecord(record);
    }

    this.pruneDetachedRecords();
  }

  private isCandidate(element: HTMLElement): boolean {
    if (!element.isConnected || element.closest(EXCLUDED_SELECTOR)) return false;

    const nestedBlock = element.querySelector<HTMLElement>(BLOCK_SELECTOR);
    if (nestedBlock && readableText(nestedBlock).length >= 2) return false;

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;

    return true;
  }

  private enqueueRecord(record: BlockRecord): void {
    if (!this.enabled || record.status !== 'observed' || record.generation !== this.generation) return;
    record.status = 'queued';

    record.chunks.forEach((text, chunkIndex) => {
      const id = `${record.id}-chunk-${chunkIndex}`;
      if (this.queuedIds.has(id)) return;
      this.queuedIds.add(id);
      this.queue.push({
        record,
        chunkIndex,
        segment: { id, text },
      });
    });

    this.renderLoading(record);
    this.pump();
  }

  private pump(): void {
    while (this.enabled && this.inFlight < MAX_CONCURRENCY && this.queue.length > 0) {
      const batch = this.takeBatch();
      if (batch.length === 0) return;
      this.inFlight += 1;
      void this.translateBatch(batch);
    }
  }

  private takeBatch(): WorkItem[] {
    const batch: WorkItem[] = [];
    let characters = 0;

    while (this.queue.length > 0 && batch.length < MAX_BATCH_SEGMENTS) {
      const next = this.queue[0];
      if (!next) break;
      const nextLength = next.segment.text.length;
      if (batch.length > 0 && characters + nextLength > MAX_BATCH_CHARACTERS) break;
      this.queue.shift();
      this.queuedIds.delete(next.segment.id);
      if (!next.record.element.isConnected || next.record.generation !== this.generation) continue;
      batch.push(next);
      characters += nextLength;
      next.record.status = 'translating';
    }

    return batch;
  }

  private async translateBatch(batch: WorkItem[]): Promise<void> {
    const requestGeneration = this.generation;
    const jobId = createJobId('page');
    this.activeJobs.add(jobId);

    try {
      const result = await requestTranslation({
        jobId,
        kind: 'page',
        sourceLanguage: this.settings.sourceLanguage,
        targetLanguage: this.settings.targetLanguage,
        segments: batch.map((item) => item.segment),
      });

      if (!this.enabled || requestGeneration !== this.generation) return;
      const byId = new Map(result.translations.map((segment) => [segment.id, segment.text]));
      for (const item of batch) {
        const translated = byId.get(item.segment.id);
        if (translated === undefined) continue;
        item.record.translations[item.chunkIndex] = translated;
        this.renderIfComplete(item.record);
      }
      this.lastError = null;
    } catch (error) {
      if (!this.enabled || requestGeneration !== this.generation) return;
      const runtimeError = error as RuntimeError;
      this.lastError = runtimeError.payload ?? {
        code: 'NETWORK_ERROR',
        message: runtimeError.message || '页面翻译失败',
        retryable: true,
      };

      for (const item of batch) {
        if (item.record.status === 'translating') item.record.status = 'observed';
        if (item.record.translationElement) item.record.translationElement.remove();
        item.record.translationElement = null;
      }
    } finally {
      this.activeJobs.delete(jobId);
      this.inFlight = Math.max(0, this.inFlight - 1);
      this.pump();
    }
  }

  private renderLoading(record: BlockRecord): void {
    if (!record.element.isConnected || record.translationElement) return;
    const translationElement = createTranslationElement(record.element);
    translationElement.dataset.liuyiState = 'loading';
    translationElement.textContent = '正在翻译';
    record.element.insertAdjacentElement('afterend', translationElement);
    record.translationElement = translationElement;
    this.applyDisplayMode(record);
  }

  private renderIfComplete(record: BlockRecord): void {
    if (record.translations.some((translation) => translation === undefined)) return;
    const text = record.translations.join('\n');
    const translationElement = record.translationElement ?? createTranslationElement(record.element);
    if (!translationElement.isConnected) record.element.insertAdjacentElement('afterend', translationElement);
    translationElement.dataset.liuyiState = 'done';
    translationElement.lang = this.settings.targetLanguage;
    translationElement.textContent = text;
    record.translationElement = translationElement;
    record.status = 'translated';
    this.intersectionObserver?.unobserve(record.element);
    this.applyDisplayMode(record);
  }

  private applyDisplayMode(record: BlockRecord): void {
    if (!record.translationElement) return;
    if (this.settings.pageDisplayMode === 'translation' && record.status === 'translated') {
      record.element.setAttribute('data-liuyi-source-hidden', '');
    } else {
      record.element.removeAttribute('data-liuyi-source-hidden');
    }
  }

  private handleMutations(mutations: MutationRecord[]): void {
    const roots = new Set<ParentNode>();
    for (const mutation of mutations) {
      if (mutation.target instanceof Element && mutation.target.closest('[data-liuyi-root]')) continue;
      if (mutation.type === 'characterData') {
        const parent = mutation.target.parentElement?.closest<HTMLElement>(BLOCK_SELECTOR);
        if (parent && !parent.closest('[data-liuyi-root]')) this.refreshRecord(parent);
        continue;
      }

      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement && !node.closest('[data-liuyi-root]')) roots.add(node);
      }
    }

    for (const root of roots) this.scan(root);
    this.pruneDetachedRecords();
  }

  private refreshRecord(element: HTMLElement): void {
    const record = this.records.get(element);
    if (!record || record.translationElement?.contains(document.activeElement)) return;
    const nextText = readableText(element);
    if (nextText === record.sourceText || nextText.length < 2) return;

    this.intersectionObserver?.unobserve(element);
    record.translationElement?.remove();
    element.removeAttribute('data-liuyi-source-hidden');
    this.records.delete(element);
    this.scan(element);
  }

  private pruneDetachedRecords(): void {
    for (const [element, record] of this.records) {
      if (element.isConnected) continue;
      this.intersectionObserver?.unobserve(element);
      record.translationElement?.remove();
      this.records.delete(element);
    }
  }
}

function readableText(element: HTMLElement): string {
  return (element.textContent ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n+ */g, '\n')
    .trim();
}

function splitText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    const windowText = remaining.slice(0, maxLength + 1);
    const candidates = [
      windowText.lastIndexOf('\n'),
      windowText.lastIndexOf('。'),
      windowText.lastIndexOf('. '),
      windowText.lastIndexOf('! '),
      windowText.lastIndexOf('? '),
      windowText.lastIndexOf(' '),
    ];
    const splitAt = Math.max(...candidates);
    const end = splitAt > maxLength * 0.55 ? splitAt + 1 : maxLength;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

function isNearViewport(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.bottom >= -800 && rect.top <= window.innerHeight + 800;
}

function viewportDistance(rect: DOMRectReadOnly): number {
  if (rect.bottom >= 0 && rect.top <= window.innerHeight) return 0;
  return rect.top > window.innerHeight ? rect.top - window.innerHeight : Math.abs(rect.bottom);
}

function createTranslationElement(source: HTMLElement): HTMLElement {
  const element = document.createElement(source.tagName === 'LI' ? 'li' : 'div');
  element.setAttribute('data-liuyi-translation', '');
  const sourceStyle = window.getComputedStyle(source);
  for (const property of [
    'font-family',
    'font-size',
    'font-style',
    'font-weight',
    'line-height',
    'letter-spacing',
    'color',
    'text-align',
    'direction',
  ]) {
    const value = sourceStyle.getPropertyValue(property);
    if (value) element.style.setProperty(property, value, 'important');
  }
  return element;
}
