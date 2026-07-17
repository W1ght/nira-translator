import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '../constants/defaults';
import type { TranslationRequest } from '../types/domain';
import { PageTranslator } from './page-translator';
import pageCss from './page.css?inline';
import { createJobId, requestTranslation } from './messaging';

vi.mock('./messaging', () => ({
  cancelTranslation: vi.fn(async () => undefined),
  createJobId: vi.fn(() => 'page-test-job'),
  requestTranslation: vi.fn(),
}));

const requestTranslationMock = vi.mocked(requestTranslation);
const createJobIdMock = vi.mocked(createJobId);
const activeTranslators = new Set<PageTranslator>();

async function settleTranslation(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function createTranslator(): PageTranslator {
  const translator = new PageTranslator(DEFAULT_SETTINGS);
  activeTranslators.add(translator);
  translator.setEnabled(true);
  return translator;
}

describe('PageTranslator', () => {
  beforeEach(() => {
    document.head.innerHTML = `<style>${pageCss}</style>`;
    document.body.innerHTML = '';
    requestTranslationMock.mockReset();
    createJobIdMock.mockReset();
    let jobOrdinal = 0;
    createJobIdMock.mockImplementation(() => `page-test-job-${++jobOrdinal}`);
    requestTranslationMock.mockImplementation(async (request: TranslationRequest) => ({
      jobId: request.jobId,
      translations: request.segments.map((segment) => ({
        id: segment.id,
        text: `译：${segment.text}`,
      })),
      durationMs: 1,
      model: 'test',
      cached: false,
    }));
  });

  afterEach(() => {
    for (const translator of activeTranslators) translator.destroy();
    activeTranslators.clear();
  });

  it('translates text-bearing div containers without merging nested blocks', async () => {
    document.body.innerHTML = `
      <main>
        <div id="first">First <em>message</em></div>
        <div id="second"><span>Second message</span></div>
      </main>
    `;

    const translator = createTranslator();
    await settleTranslation();

    const translations = [...document.querySelectorAll<HTMLElement>('[data-nira-translation]')];
    expect(translations.map((element) => element.textContent)).toEqual([
      '译：First message',
      '译：Second message',
    ]);
    expect(requestTranslationMock).toHaveBeenCalledTimes(1);
    expect(requestTranslationMock.mock.calls[0]?.[0].segments).toHaveLength(2);
    translator.destroy();
  });

  it('uses the actual text-bearing descendant color and keeps translations selectable', async () => {
    document.body.innerHTML = `
      <div style="color: rgb(0, 0, 0); background: rgb(20, 20, 20)">
        <span style="color: rgb(242, 242, 242)">Readable on dark background</span>
      </div>
    `;

    const translator = createTranslator();
    await settleTranslation();

    const translation = document.querySelector<HTMLElement>('[data-nira-translation]');
    expect(translation ? getComputedStyle(translation).color : '').toBe('rgb(242, 242, 242)');
    expect(translation?.style.getPropertyValue('user-select')).toBe('text');

    const translatedText = translation?.querySelector('[data-nira-translation-inner]')?.firstChild;
    const selection = window.getSelection();
    if (translatedText && selection) {
      const range = document.createRange();
      range.selectNodeContents(translatedText);
      selection.removeAllRanges();
      selection.addRange(range);
      expect(selection.toString()).toBe('译：Readable on dark background');
    }
    translator.destroy();
  });

  it('rebuilds inline formatting and atomic content inside the source paragraph', async () => {
    document.body.innerHTML = `
      <p id="rich">Read <a href="/guide"><em>this guide</em></a> and run
        <code>pnpm test</code> now.</p>
    `;

    const translator = createTranslator();
    await settleTranslation();

    const source = document.querySelector('#rich')!;
    const translation = source.querySelector<HTMLElement>(':scope > [data-nira-translation]');
    expect(translation?.parentElement).toBe(source);
    expect(translation?.querySelector('a')?.getAttribute('href')).toBe('/guide');
    expect(translation?.querySelector('a em')?.textContent).toBe('this guide');
    expect(translation?.querySelector('code')?.textContent).toBe('pnpm test');
    expect(document.body.querySelector(':scope > [data-nira-translation]')).toBeNull();
    translator.destroy();
  });

  it('keeps source structure intact in translation-only mode and restores it in dual mode', async () => {
    document.body.innerHTML = '<p id="mode">Before <strong>inside</strong><img alt="asset"> after</p>';
    const translator = createTranslator();
    await settleTranslation();

    const source = document.querySelector<HTMLElement>('#mode')!;
    const image = source.querySelector<HTMLImageElement>('img')!;
    translator.setMode('translation');

    expect(source.isConnected).toBe(true);
    expect(source.hasAttribute('data-nira-source-hidden')).toBe(false);
    expect(source.querySelector('[data-nira-translation]')?.textContent).toContain('译：Before inside');
    expect([...source.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)).toEqual(['', '']);
    expect(image.style.getPropertyValue('display')).toBe('none');

    translator.setMode('dual');
    expect(source.textContent).toContain('Before inside after');
    expect(image.style.getPropertyValue('display')).toBe('');
    translator.destroy();
  });

  it('hides styled source inline roots in translation-only mode to avoid duplicate controls', async () => {
    document.body.innerHTML = `
      <p id="styled-link">Read <a href="/source" style="display:inline-block;padding:8px">this guide</a> now</p>
    `;
    const translator = createTranslator();
    await settleTranslation();
    const host = document.querySelector<HTMLElement>('#styled-link')!;
    const sourceLink = host.querySelector<HTMLAnchorElement>(':scope > a')!;

    translator.setMode('translation');

    const translatedLink = host.querySelector<HTMLAnchorElement>('[data-nira-translation] a')!;
    expect(sourceLink.style.getPropertyValue('display')).toBe('none');
    expect(translatedLink).not.toBe(sourceLink);
    expect(translatedLink.getAttribute('href')).toBe('/source');

    translator.setMode('dual');
    expect(sourceLink.style.getPropertyValue('display')).toBe('inline-block');
    translator.destroy();
  });

  it('does not resurrect text that the page clears while translation-only mode is active', async () => {
    document.body.innerHTML = '<p id="site-clear">Site-owned source text</p>';
    const translator = createTranslator();
    await settleTranslation();
    const source = document.querySelector<HTMLElement>('#site-clear')!;
    const sourceText = source.firstChild as Text;
    translator.setMode('translation');
    expect(sourceText.data).toBe('');

    sourceText.data = '';
    await new Promise((resolve) => window.setTimeout(resolve, 90));
    await settleTranslation();
    translator.setMode('dual');

    expect(sourceText.data).toBe('');
    expect(source.textContent).not.toContain('Site-owned source text');
    translator.destroy();
  });

  it('restores the latest site text when dual mode is selected before the mutation flush', async () => {
    document.body.innerHTML = '<p id="site-fast">Original site text</p>';
    const translator = createTranslator();
    await settleTranslation();
    const source = document.querySelector<HTMLElement>('#site-fast')!;
    const sourceText = source.firstChild as Text;
    translator.setMode('translation');

    sourceText.data = 'Updated by the site';
    await Promise.resolve();
    translator.setMode('dual');

    expect(sourceText.data).toBe('Updated by the site');
    await new Promise((resolve) => window.setTimeout(resolve, 90));
    expect(source.textContent).not.toContain('Original site text');
    translator.destroy();
  });

  it('translates content inside an open shadow root', async () => {
    const host = document.createElement('section');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<p>Words inside a web component</p>';
    document.body.append(host);

    const translator = createTranslator();
    await settleTranslation();

    const translation = shadow.querySelector<HTMLElement>('[data-nira-translation]');
    expect(translation?.textContent).toBe('译：Words inside a web component');
    expect(translation?.style.userSelect).toBe('text');
    translator.destroy();
  });

  it('rescans an open shadow root when its host is removed and reattached', async () => {
    const host = document.createElement('section');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<p>Reusable component text</p>';
    document.body.append(host);
    const translator = createTranslator();
    await settleTranslation();
    expect(shadow.querySelector('[data-nira-translation]')?.textContent)
      .toBe('译：Reusable component text');

    host.remove();
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    document.body.append(host);
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    await settleTranslation();

    await vi.waitFor(() => {
      expect(shadow.querySelectorAll('[data-nira-translation]')).toHaveLength(1);
      expect(shadow.querySelector('[data-nira-translation]')?.textContent)
        .toBe('译：Reusable component text');
    }, { timeout: 2_000, interval: 25 });
    translator.destroy();
  });

  it('rescans content inserted by a dynamic page', async () => {
    document.body.innerHTML = '<main id="feed"><div>Initial message</div></main>';
    const translator = createTranslator();
    await settleTranslation();

    const dynamic = document.createElement('div');
    dynamic.textContent = 'Message loaded later';
    document.querySelector('#feed')?.append(dynamic);
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    await settleTranslation();

    expect([...document.querySelectorAll('[data-nira-translation]')].map((node) => node.textContent))
      .toContain('译：Message loaded later');
    translator.destroy();
  });

  it('replaces a stale translation when a dynamic page edits source text', async () => {
    document.body.innerHTML = '<main><div id="editable">Original dynamic message</div></main>';
    const translator = createTranslator();
    await settleTranslation();

    const source = document.querySelector<HTMLElement>('#editable')!;
    source.firstChild!.textContent = 'Updated dynamic message';
    await new Promise((resolve) => window.setTimeout(resolve, 90));
    await settleTranslation();

    const translations = [...source.querySelectorAll('[data-nira-translation]')];
    expect(translations).toHaveLength(1);
    expect(translations[0]?.textContent).toBe('译：Updated dynamic message');
    expect(source.textContent).not.toContain('译：Original dynamic message');
    translator.destroy();
  });

  it('repairs a translated wrapper removed by a client-side renderer', async () => {
    document.body.innerHTML = '<div id="framework">Framework managed content</div>';
    const translator = createTranslator();
    await settleTranslation();

    document.querySelector('[data-nira-translation]')?.remove();
    await settleTranslation();

    expect(document.querySelector('#framework [data-nira-translation]')?.textContent)
      .toBe('译：Framework managed content');
    translator.destroy();
  });

  it('repairs a translated inner node removed by a client-side renderer', async () => {
    document.body.innerHTML = '<div id="framework-inner">Framework managed inner content</div>';
    const translator = createTranslator();
    await settleTranslation();

    document.querySelector('[data-nira-translation-inner]')?.remove();
    await settleTranslation();

    expect(document.querySelectorAll('#framework-inner [data-nira-translation]')).toHaveLength(1);
    expect(document.querySelector('#framework-inner [data-nira-translation]')?.textContent)
      .toBe('译：Framework managed inner content');
    translator.destroy();
  });

  it('restores source state before repairing a wrapper removed in translation-only mode', async () => {
    document.body.innerHTML = '<p id="repair-mode">Original <img alt="asset"> source text</p>';
    const translator = createTranslator();
    await settleTranslation();
    translator.setMode('translation');

    const source = document.querySelector<HTMLElement>('#repair-mode')!;
    const image = source.querySelector<HTMLImageElement>('img')!;
    expect(image.style.getPropertyValue('display')).toBe('none');
    source.querySelector('[data-nira-translation]')?.remove();
    await settleTranslation();

    expect(source.querySelectorAll('[data-nira-translation]')).toHaveLength(1);
    translator.setMode('dual');
    expect(source.textContent).toContain('Original');
    expect(source.textContent).toContain('source text');
    expect(image.style.getPropertyValue('display')).toBe('');
    translator.destroy();
  });

  it('drops an in-flight response after the source paragraph changes', async () => {
    type Pending = {
      request: TranslationRequest;
      resolve: (result: Awaited<ReturnType<typeof requestTranslation>>) => void;
    };
    const pending: Pending[] = [];
    requestTranslationMock.mockImplementation((request: TranslationRequest) => new Promise((resolve) => {
      pending.push({ request, resolve });
    }));
    document.body.innerHTML = '<div id="stream">First streaming value</div>';
    const translator = createTranslator();
    await settleTranslation();
    expect(pending).toHaveLength(1);

    document.querySelector('#stream')!.firstChild!.textContent = 'Second streaming value';
    await Promise.resolve();

    const first = pending[0]!;
    first.resolve({
      jobId: first.request.jobId,
      translations: first.request.segments.map((segment) => ({ id: segment.id, text: '过期译文' })),
      durationMs: 1,
      model: 'test',
      cached: false,
    });
    await settleTranslation();
    expect(document.querySelector('#stream')?.textContent).not.toContain('过期译文');

    await new Promise((resolve) => window.setTimeout(resolve, 90));
    await settleTranslation();
    expect(pending).toHaveLength(2);

    const second = pending[1]!;
    second.resolve({
      jobId: second.request.jobId,
      translations: second.request.segments.map((segment) => ({ id: segment.id, text: '最新译文' })),
      durationMs: 1,
      model: 'test',
      cached: false,
    });
    await settleTranslation();
    expect(document.querySelector('#stream [data-nira-translation]')?.textContent).toBe('最新译文');
    translator.destroy();
  });

  it('releases both concurrency slots when two in-flight batches become stale', async () => {
    type Pending = {
      request: TranslationRequest;
      resolve: (result: Awaited<ReturnType<typeof requestTranslation>>) => void;
    };
    const pending: Pending[] = [];
    requestTranslationMock.mockImplementation((request: TranslationRequest) => new Promise((resolve) => {
      pending.push({ request, resolve });
    }));
    document.body.innerHTML = Array.from(
      { length: 8 },
      (_, index) => `<p id="stale-${index}">Streaming paragraph ${index}</p>`,
    ).join('');
    const translator = createTranslator();
    await settleTranslation();
    expect(pending).toHaveLength(2);

    document.querySelector('#stale-0')!.firstChild!.textContent = 'Updated first batch';
    document.querySelector('#stale-4')!.firstChild!.textContent = 'Updated second batch';
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 90));
    await settleTranslation();

    expect(pending.length).toBeGreaterThan(2);
    expect(pending.slice(2).flatMap((item) => item.request.segments.map((segment) => segment.text)))
      .toEqual(expect.arrayContaining(['Updated first batch', 'Updated second batch']));
    translator.destroy();
  });

  it('observes and translates a replacement document body', async () => {
    document.body.innerHTML = '<p>Body before replacement</p>';
    const translator = createTranslator();
    await settleTranslation();

    const replacement = document.createElement('body');
    replacement.innerHTML = '<main><p id="replacement">Body after replacement</p></main>';
    document.documentElement.replaceChild(replacement, document.body);
    await new Promise((resolve) => window.setTimeout(resolve, 90));
    await settleTranslation();

    await vi.waitFor(() => {
      expect(document.querySelector('#replacement [data-nira-translation]')?.textContent)
        .toBe('译：Body after replacement');
    }, { timeout: 2_000, interval: 25 });
    translator.destroy();
  });

  it('retranslates existing paragraphs when the target language changes', async () => {
    requestTranslationMock.mockImplementation(async (request: TranslationRequest) => ({
      jobId: request.jobId,
      translations: request.segments.map((segment) => ({
        id: segment.id,
        text: `${request.targetLanguage}:${segment.text}`,
      })),
      durationMs: 1,
      model: 'test',
      cached: false,
    }));
    document.body.innerHTML = '<p>Language setting changes</p>';
    const translator = createTranslator();
    await settleTranslation();

    translator.updateSettings({ ...DEFAULT_SETTINGS, targetLanguage: 'ja' });
    await settleTranslation();

    const translation = document.querySelector<HTMLElement>('[data-nira-translation]');
    expect(translation?.textContent).toBe('ja:Language setting changes');
    expect(translation?.lang).toBe('ja');
    expect(requestTranslationMock).toHaveBeenCalledTimes(2);
    translator.destroy();
  });

  it('does not insert a duplicate target when the provider returns unchanged source text', async () => {
    requestTranslationMock.mockImplementation(async (request: TranslationRequest) => ({
      jobId: request.jobId,
      translations: request.segments.map((segment) => ({ id: segment.id, text: segment.text })),
      durationMs: 1,
      model: 'test',
      cached: false,
    }));
    document.body.innerHTML = '<p id="unchanged">已经是目标语言的文本</p>';

    const translator = createTranslator();
    await settleTranslation();

    expect(document.querySelector('#unchanged [data-nira-translation]')).toBeNull();
    expect(document.querySelector('#unchanged')?.textContent).toBe('已经是目标语言的文本');
    expect(translator.getState()).toMatchObject({ translatedCount: 1, pendingCount: 0 });
    translator.destroy();
  });

  it('retries a segment by itself when a provider omits it', async () => {
    requestTranslationMock
      .mockResolvedValueOnce({
        jobId: 'page-test-job',
        translations: [],
        durationMs: 1,
        model: 'test',
        cached: false,
      })
      .mockImplementation(async (request: TranslationRequest) => ({
        jobId: request.jobId,
        translations: request.segments.map((segment) => ({ id: segment.id, text: '补全译文' })),
        durationMs: 1,
        model: 'test',
        cached: false,
      }));
    document.body.innerHTML = '<div>Provider may omit this segment</div>';

    const translator = createTranslator();
    await settleTranslation();

    expect(requestTranslationMock).toHaveBeenCalledTimes(2);
    expect(requestTranslationMock.mock.calls[1]?.[0].segments).toHaveLength(1);
    expect(document.querySelector('[data-nira-translation]')?.textContent).toBe('补全译文');
    translator.destroy();
  });

  it('retries a transient provider error and completes without another intersection event', async () => {
    const transient = Object.assign(new Error('temporary outage'), {
      payload: { code: 'NETWORK_ERROR', message: 'temporary outage', retryable: true },
    });
    requestTranslationMock
      .mockRejectedValueOnce(transient)
      .mockImplementation(async (request: TranslationRequest) => ({
        jobId: request.jobId,
        translations: request.segments.map((segment) => ({ id: segment.id, text: '重试成功' })),
        durationMs: 1,
        model: 'test',
        cached: false,
      }));
    document.body.innerHTML = '<p>Retry this transient failure</p>';

    const translator = createTranslator();
    await settleTranslation();

    expect(requestTranslationMock).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-nira-translation]')?.textContent).toBe('重试成功');
    expect(translator.getState().error).toBeNull();
    translator.destroy();
  });

  it('never sends more than the background page request limits', async () => {
    document.body.innerHTML = Array.from(
      { length: 9 },
      (_, index) => `<p>Batch paragraph number ${index + 1}</p>`,
    ).join('');

    const translator = createTranslator();
    await settleTranslation();

    expect(requestTranslationMock).toHaveBeenCalledTimes(3);
    for (const [request] of requestTranslationMock.mock.calls) {
      expect(request.segments.length).toBeLessThanOrEqual(4);
      expect(request.segments.reduce((sum, segment) => sum + segment.text.length, 0))
        .toBeLessThanOrEqual(4_000);
    }
    expect(translator.getState()).toMatchObject({ translatedCount: 9, pendingCount: 0 });
    translator.destroy();
  });

  it('translates an oversized rich paragraph in token-safe sequential fragments', async () => {
    const longText = Array.from({ length: 1_100 }, (_, index) => `word${index}.`).join(' ');
    document.body.innerHTML = `<p id="long">Start <em>${longText}</em> finish.</p>`;

    const translator = createTranslator();
    for (let index = 0; index < 30; index += 1) await Promise.resolve();

    expect(requestTranslationMock.mock.calls.length).toBeGreaterThan(1);
    for (const [request] of requestTranslationMock.mock.calls) {
      expect(request.segments).toHaveLength(1);
      expect(request.segments[0]!.text.length).toBeLessThanOrEqual(4_000);
      expect(request.segments[0]!.text).not.toContain('{{NIRA_TAG_');
    }
    const translation = document.querySelector<HTMLElement>('#long > [data-nira-translation]');
    expect(translation?.querySelector('em')).toBeNull();
    expect(translation?.textContent).toContain('word1099.');
    expect(translator.getState()).toMatchObject({ translatedCount: 1, pendingCount: 0 });
    translator.destroy();
  });

  it('surfaces an incomplete-response error after bounded retries', async () => {
    requestTranslationMock.mockImplementation(async (request: TranslationRequest) => ({
      jobId: request.jobId,
      translations: [],
      durationMs: 1,
      model: 'test',
      cached: false,
    }));
    document.body.innerHTML = '<div>This segment is always omitted</div>';

    const translator = createTranslator();
    await settleTranslation();

    expect(requestTranslationMock).toHaveBeenCalledTimes(3);
    expect(translator.getState().error).toMatchObject({
      code: 'INVALID_RESPONSE',
      retryable: true,
    });
    expect(document.querySelector('[data-nira-translation]')).toBeNull();
    translator.destroy();
  });
});
