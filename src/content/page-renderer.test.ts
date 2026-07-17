import { afterEach, describe, expect, it } from 'vitest';

import type { PageToken, ParsedParagraph } from './page-dom-parser';
import {
  insertParagraphTranslation,
  isNiraTranslationNode,
  removeParagraphTranslation,
  setParagraphDisplayMode,
  updateParagraphTranslation,
} from './page-renderer';

const OPEN = '{{NIRA_TAG_1_START}}';
const CLOSE = '{{NIRA_TAG_1_END}}';
const ATOMIC = '{{NIRA_ATOMIC_2}}';
const BREAK = '{{NIRA_BREAK_3}}';

afterEach(() => {
  document.body.replaceChildren();
});

describe('page translation renderer', () => {
  it('rebuilds allowed inline, atomic, and break tokens with DOM clones', () => {
    const host = document.createElement('p');
    const leading = document.createTextNode('Hello ');
    const emphasis = document.createElement('em');
    emphasis.className = 'source-emphasis';
    const emphasizedText = document.createTextNode('world');
    emphasis.append(emphasizedText);
    const image = document.createElement('img');
    image.alt = 'wave';
    image.setAttribute('data-source-asset', '');
    const sourceBreak = document.createElement('br');
    const trailing = document.createTextNode('Next line');
    host.style.color = 'rgb(242, 242, 242)';
    host.append(leading, emphasis, image, sourceBreak, trailing);
    document.body.append(host);

    const paragraph = makeParagraph(host, {
      sourceTextNodes: [leading, emphasizedText, trailing],
      tokens: new Map<string, PageToken>([
        [OPEN, { id: OPEN, kind: 'open', template: emphasis.cloneNode(true) as HTMLElement }],
        [CLOSE, { id: CLOSE, kind: 'close' }],
        [ATOMIC, { id: ATOMIC, kind: 'atomic', template: image.cloneNode(true) as HTMLElement }],
        [BREAK, { id: BREAK, kind: 'break' }],
      ]),
    });

    const rendered = insertParagraphTranslation(
      paragraph,
      `你好${OPEN}世界${CLOSE}${ATOMIC}${BREAK}下一行`,
      'zh-CN',
      'done',
    );

    expect(rendered.outer.tagName).toBe('FONT');
    expect(rendered.inner.tagName).toBe('FONT');
    expect(rendered.outer.parentNode).toBe(host);
    expect(rendered.outer.previousSibling).toBe(trailing);
    expect(rendered.inner.textContent).toBe('你好世界下一行');
    expect(rendered.inner.querySelector('em')?.textContent).toBe('世界');
    expect(rendered.inner.querySelector('em')?.className).toBe('source-emphasis');
    expect(rendered.inner.querySelector('em')).not.toBe(emphasis);
    expect(rendered.inner.querySelector('img')?.alt).toBe('wave');
    expect(rendered.inner.querySelector('img')).not.toBe(image);
    expect(rendered.inner.querySelectorAll('br')).toHaveLength(1);
    expect(rendered.outer.style.userSelect).toBe('text');
    expect(getComputedStyle(rendered.outer).color).toBe('rgb(242, 242, 242)');
    expect(isNiraTranslationNode(rendered.inner.firstChild as Node)).toBe(true);
    expect(isNiraTranslationNode(leading)).toBe(false);
  });

  it.each([
    ['missing', `译${CLOSE}文`],
    ['out of order', `${CLOSE}译${OPEN}文`],
    ['duplicated', `${OPEN}${OPEN}译${CLOSE}文`],
  ])('falls back to token-free plain text for %s tokens', (_label, translated) => {
    const host = document.createElement('p');
    const text = document.createTextNode('source');
    host.append(text);
    document.body.append(host);
    const template = document.createElement('strong');
    const paragraph = makeParagraph(host, {
      sourceTextNodes: [text],
      tokens: new Map<string, PageToken>([
        [OPEN, { id: OPEN, kind: 'open', template }],
        [CLOSE, { id: CLOSE, kind: 'close' }],
      ]),
    });

    const rendered = insertParagraphTranslation(paragraph, translated, 'zh-CN', 'done');

    expect(rendered.inner.textContent).toBe('译文');
    expect(rendered.inner.children).toHaveLength(0);
  });

  it('removes executable attributes from cloned source markup', () => {
    const host = document.createElement('p');
    const source = document.createTextNode('source');
    host.append(source);
    document.body.append(host);
    const link = document.createElement('a');
    link.id = 'duplicated-id';
    link.setAttribute('onclick', 'window.__unsafe = true');
    link.href = '/safe';
    const atomic = document.createElement('span');
    atomic.className = 'notranslate';
    atomic.innerHTML = '<b>Brand</b>';
    const paragraph = makeParagraph(host, {
      sourceTextNodes: [source],
      tokens: new Map<string, PageToken>([
        [OPEN, { id: OPEN, kind: 'open', template: link }],
        [CLOSE, { id: CLOSE, kind: 'close' }],
        [ATOMIC, { id: ATOMIC, kind: 'atomic', template: atomic }],
      ]),
    });

    const rendered = insertParagraphTranslation(
      paragraph,
      `${OPEN}Safe link${CLOSE}${ATOMIC}`,
      'en',
      'done',
    );

    const clonedLink = rendered.inner.querySelector('a');
    expect(clonedLink?.getAttribute('href')).toContain('/safe');
    expect(clonedLink?.hasAttribute('id')).toBe(false);
    expect(clonedLink?.hasAttribute('onclick')).toBe(false);
    expect(rendered.inner.querySelector('script')).toBeNull();
    expect(rendered.inner.querySelector('b')?.textContent).toBe('Brand');
  });

  it('refuses an unsafe atomic root instead of cloning active embedded content', () => {
    const host = document.createElement('p');
    const source = document.createTextNode('source');
    host.append(source);
    document.body.append(host);
    const iframe = document.createElement('iframe');
    iframe.src = 'https://example.invalid/active';
    const paragraph = makeParagraph(host, {
      sourceTextNodes: [source],
      tokens: new Map<string, PageToken>([
        [ATOMIC, { id: ATOMIC, kind: 'atomic', template: iframe }],
      ]),
    });

    const rendered = insertParagraphTranslation(paragraph, `safe${ATOMIC}`, 'en', 'done');

    expect(rendered.inner.textContent).toBe('safe');
    expect(rendered.inner.querySelector('iframe')).toBeNull();
  });

  it('refuses active descendants inside a notranslate atomic clone', () => {
    const host = document.createElement('p');
    const source = document.createTextNode('source');
    host.append(source);
    document.body.append(host);
    const atomic = document.createElement('span');
    atomic.className = 'notranslate';
    atomic.innerHTML = '<script>window.__unsafe = true</script><button type="submit">Active control</button>';
    const paragraph = makeParagraph(host, {
      sourceTextNodes: [source],
      tokens: new Map<string, PageToken>([
        [ATOMIC, { id: ATOMIC, kind: 'atomic', template: atomic }],
      ]),
    });

    const rendered = insertParagraphTranslation(paragraph, `safe${ATOMIC}`, 'en', 'done');

    expect(rendered.inner.textContent).toBe('safe');
    expect(rendered.inner.querySelector('script')).toBeNull();
    expect(rendered.inner.querySelector('button')).toBeNull();
  });

  it('inserts immediately after the paragraph root range, before later siblings', () => {
    const host = document.createElement('p');
    const first = document.createTextNode('first ');
    const lastRoot = document.createElement('span');
    const nested = document.createTextNode('second');
    lastRoot.append(nested);
    const unrelated = document.createElement('button');
    unrelated.textContent = 'later control';
    host.append(first, lastRoot, unrelated);
    document.body.append(host);
    const paragraph = makeParagraph(host, {
      rootNodes: [first, lastRoot],
      sourceTextNodes: [first, nested],
    });

    const rendered = insertParagraphTranslation(paragraph, '译文', 'zh-CN', 'done');

    expect([...host.childNodes]).toEqual([first, lastRoot, rendered.outer, unrelated]);
  });

  it.each(['td', 'li', 'flex'] as const)('keeps a %s translation inside its structural host', (kind) => {
    const host = createStructuralHost(kind);
    const source = document.createTextNode(`${kind} source`);
    host.append(source);
    const paragraph = makeParagraph(host, { sourceTextNodes: [source], inline: false });

    const rendered = insertParagraphTranslation(paragraph, `${kind} translated`, 'en', 'done');

    expect(rendered.outer.parentNode).toBe(host);
    expect(rendered.outer.closest('td, li, [data-flex-host]')).toBe(host);
    expect(rendered.outer.getAttribute('data-nira-display')).toBe('block');
    expect(host.parentNode?.childNodes).not.toContain(rendered.outer);
  });

  it('suppresses only source text and restores it across display-mode changes', () => {
    const host = document.createElement('p');
    const first = document.createTextNode('before ');
    const emphasis = document.createElement('em');
    const nested = document.createTextNode('inside');
    emphasis.append(nested);
    const image = document.createElement('img');
    image.alt = 'retained atomic';
    image.style.setProperty('display', 'inline-block', 'important');
    const last = document.createTextNode(' after');
    host.append(first, emphasis, image, last);
    document.body.append(host);
    const paragraph = makeParagraph(host, {
      sourceTextNodes: [first, nested, last],
      tokens: new Map<string, PageToken>([
        [ATOMIC, { id: ATOMIC, kind: 'atomic', template: image.cloneNode(true) as HTMLElement }],
      ]),
    });
    const rendered = insertParagraphTranslation(paragraph, `translated${ATOMIC}`, 'en', 'done');

    setParagraphDisplayMode(rendered, paragraph, 'translation');

    expect([first.data, nested.data, last.data]).toEqual(['', '', '']);
    expect(image.isConnected).toBe(true);
    expect(image.style.getPropertyValue('display')).toBe('none');
    expect(image.style.getPropertyPriority('display')).toBe('important');
    expect(rendered.inner.querySelector('img')).not.toBe(image);
    expect(rendered.inner.querySelector('img')?.isConnected).toBe(true);
    expect(rendered.inner.textContent).toBe('translated');
    expect(host.hasAttribute('data-nira-source-hidden')).toBe(false);
    expect(rendered.sourceSuppressed).toBe(true);

    setParagraphDisplayMode(rendered, paragraph, 'dual');

    expect([first.data, nested.data, last.data]).toEqual(['before ', 'inside', ' after']);
    expect(image.style.getPropertyValue('display')).toBe('inline-block');
    expect(image.style.getPropertyPriority('display')).toBe('important');
    expect(rendered.sourceSuppressed).toBe(false);

    first.data = 'changed ';
    setParagraphDisplayMode(rendered, paragraph, 'translation');
    setParagraphDisplayMode(rendered, paragraph, 'dual');
    expect(first.data).toBe('changed ');

    setParagraphDisplayMode(rendered, paragraph, 'translation');
    removeParagraphTranslation(rendered, paragraph);
    expect(image.style.getPropertyValue('display')).toBe('inline-block');
    expect(image.style.getPropertyPriority('display')).toBe('important');
  });

  it('keeps source atomic elements visible when a provider damages their placeholder', () => {
    const host = document.createElement('p');
    const source = document.createTextNode('before ');
    const image = document.createElement('img');
    image.alt = 'must remain visible';
    host.append(source, image);
    document.body.append(host);
    const paragraph = makeParagraph(host, {
      rootNodes: [source, image],
      flatNodes: [source, image],
      sourceTextNodes: [source],
      tokens: new Map<string, PageToken>([
        [ATOMIC, { id: ATOMIC, kind: 'atomic', template: image.cloneNode(true) as HTMLElement }],
      ]),
    });
    const rendered = insertParagraphTranslation(paragraph, '安全降级译文', 'zh-CN', 'done');

    setParagraphDisplayMode(rendered, paragraph, 'translation');

    expect(source.data).toBe('');
    expect(image.style.getPropertyValue('display')).toBe('');
    expect(rendered.inner.textContent).toBe('安全降级译文');
  });

  it('restores source text before completely removing a translation', () => {
    const host = document.createElement('p');
    const source = document.createTextNode('restore me');
    host.append(source);
    document.body.append(host);
    const paragraph = makeParagraph(host, { sourceTextNodes: [source] });
    const rendered = insertParagraphTranslation(paragraph, 'translation', 'en', 'done');
    setParagraphDisplayMode(rendered, paragraph, 'translation');

    removeParagraphTranslation(rendered, paragraph);

    expect(source.data).toBe('restore me');
    expect(rendered.sourceSuppressed).toBe(false);
    expect(rendered.outer.isConnected).toBe(false);
    expect(host.querySelector('[data-nira-translation]')).toBeNull();
  });

  it('sets RTL metadata and updates it when the target language changes', () => {
    const host = document.createElement('p');
    const source = document.createTextNode('source');
    host.append(source);
    document.body.append(host);
    const paragraph = makeParagraph(host, { sourceTextNodes: [source], inline: true });
    const rendered = insertParagraphTranslation(paragraph, 'ترجمة', 'ar-EG', 'done');

    expect(rendered.outer.lang).toBe('ar-EG');
    expect(rendered.outer.dir).toBe('rtl');
    expect(rendered.inner.lang).toBe('ar-EG');
    expect(rendered.inner.dir).toBe('rtl');
    expect(rendered.outer.getAttribute('data-nira-display')).toBe('inline');

    updateParagraphTranslation(rendered, paragraph, 'translation', 'en-US');

    expect(rendered.outer.lang).toBe('en-US');
    expect(rendered.outer.dir).toBe('ltr');
    expect(rendered.inner.dir).toBe('ltr');
    expect(rendered.outer.getAttribute('data-nira-state')).toBe('done');
  });

  it('renders loading text literally without decoding placeholder tokens', () => {
    const host = document.createElement('p');
    const source = document.createTextNode('source');
    host.append(source);
    document.body.append(host);
    const template = document.createElement('em');
    const paragraph = makeParagraph(host, {
      sourceTextNodes: [source],
      tokens: new Map<string, PageToken>([
        [OPEN, { id: OPEN, kind: 'open', template }],
        [CLOSE, { id: CLOSE, kind: 'close' }],
      ]),
    });
    const loading = `${OPEN}正在翻译${CLOSE}`;

    const rendered = insertParagraphTranslation(paragraph, loading, 'zh-CN', 'loading');

    expect(rendered.inner.textContent).toBe(loading);
    expect(rendered.inner.children).toHaveLength(0);
    expect(rendered.outer.getAttribute('data-nira-state')).toBe('loading');
  });
});

function makeParagraph(
  commonAncestor: HTMLElement,
  patch: Partial<ParsedParagraph> = {},
): ParsedParagraph {
  const rootNodes = patch.rootNodes ?? [...commonAncestor.childNodes];
  const sourceTextNodes = patch.sourceTextNodes ?? rootNodes.filter((node): node is Text => node.nodeType === Node.TEXT_NODE);
  const sourceText = sourceTextNodes.map((node) => node.data).join('');
  return {
    key: 'paragraph-test',
    commonAncestor,
    rootNodes,
    flatNodes: rootNodes,
    sourceTextNodes,
    sourceText,
    serializedText: sourceText,
    tokens: new Map(),
    inline: false,
    preformatted: false,
    display: patch.inline ? 'inline' : 'block',
    ...patch,
  };
}

function createStructuralHost(kind: 'td' | 'li' | 'flex'): HTMLElement {
  if (kind === 'td') {
    const table = document.createElement('table');
    const row = table.insertRow();
    const cell = row.insertCell();
    document.body.append(table);
    return cell;
  }

  if (kind === 'li') {
    const list = document.createElement('ul');
    const item = document.createElement('li');
    list.append(item);
    document.body.append(list);
    return item;
  }

  const flex = document.createElement('div');
  flex.style.display = 'flex';
  flex.setAttribute('data-flex-host', '');
  document.body.append(flex);
  return flex;
}
