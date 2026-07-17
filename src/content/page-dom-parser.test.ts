import { beforeEach, describe, expect, it } from 'vitest';

import {
  isPageBlockElement,
  isPageExcludedElement,
  paragraphContainsNode,
  parsePageParagraphs,
} from './page-dom-parser';

describe('page DOM parser', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps adjacent inline siblings and their literal space in one paragraph', () => {
    document.body.innerHTML = '<p id="line"><span>Hello</span> <span>world</span></p>';

    const [paragraph] = parsePageParagraphs(document.body);

    expect(paragraph?.sourceText).toBe('Hello world');
    expect(paragraph?.commonAncestor).toBe(document.querySelector('#line'));
    expect(paragraph?.rootNodes).toHaveLength(3);
    expect(paragraph?.serializedText).toMatch(
      /^\{\{NIRA_TAG_0_START\}\}Hello\{\{NIRA_TAG_0_END\}\} \{\{NIRA_TAG_1_START\}\}world\{\{NIRA_TAG_1_END\}\}$/,
    );
    expect(paragraph?.tokens.size).toBe(4);
  });

  it('preserves BR as an explicit break token and source newline', () => {
    document.body.innerHTML = '<p>Hello<br>world</p>';

    const [paragraph] = parsePageParagraphs(document.body);

    expect(paragraph?.sourceText).toBe('Hello\nworld');
    expect(paragraph?.serializedText).toBe('Hello{{NIRA_BREAK_0}}world');
    expect(paragraph?.tokens.get('{{NIRA_BREAK_0}}')).toEqual({
      id: '{{NIRA_BREAK_0}}',
      kind: 'break',
    });
  });

  it('emits paired tokens and shallow templates for normal inline markup', () => {
    document.body.innerHTML = '<p><a href="/docs">Read</a> <em>carefully</em> <strong>now</strong></p>';

    const [paragraph] = parsePageParagraphs(document.body);

    expect(paragraph?.sourceText).toBe('Read carefully now');
    expect([...paragraph!.tokens.values()].map((token) => token.kind)).toEqual([
      'open', 'close', 'open', 'close', 'open', 'close',
    ]);
    const linkTemplate = paragraph?.tokens.get('{{NIRA_TAG_0_START}}')?.template;
    expect(linkTemplate?.tagName).toBe('A');
    expect(linkTemplate?.getAttribute('href')).toBe('/docs');
    expect(linkTemplate?.childNodes).toHaveLength(0);
  });

  it('represents code, image, sup and notranslate content as atomic variables', () => {
    document.body.innerHTML = `
      <p>Before <code><b>const x = 1</b></code><img alt="diagram"><sup>2</sup>
        <span class="notranslate"><i>Brand</i></span> after</p>
    `;

    const [paragraph] = parsePageParagraphs(document.body);
    const atomics = [...paragraph!.tokens.values()].filter((token) => token.kind === 'atomic');

    expect(paragraph?.sourceText).toBe('Before after');
    expect(atomics).toHaveLength(4);
    expect(atomics.map((token) => token.template?.tagName)).toEqual(['CODE', 'IMG', 'SUP', 'SPAN']);
    expect(atomics[0]?.template?.querySelector('b')?.textContent).toBe('const x = 1');
    expect(atomics[3]?.template?.querySelector('i')?.textContent).toBe('Brand');
  });

  it('does not snapshot active controls hidden inside a notranslate atomic container', () => {
    document.body.innerHTML = `
      <p>Before <span class="notranslate"><button type="submit">Do not clone</button></span> after</p>
    `;

    const [paragraph] = parsePageParagraphs(document.body);
    const atomic = [...paragraph!.tokens.values()].find((token) => token.kind === 'atomic');

    expect(atomic).toBeDefined();
    expect(atomic?.template).toBeUndefined();
  });

  it('excludes real SVG namespaces and keeps MathML as one atomic value', () => {
    document.body.innerHTML = `
      <p id="namespaces">Before <svg><text>Chart label</text></svg>
        <math><mi>x</mi><mo>+</mo><mn>1</mn></math> after</p>
    `;
    const svg = document.querySelector('svg')!;

    const [paragraph] = parsePageParagraphs(document.body);
    const atomics = [...paragraph!.tokens.values()].filter((token) => token.kind === 'atomic');

    expect(parsePageParagraphs(svg)).toEqual([]);
    expect(paragraph?.sourceText).toBe('Before after');
    expect(paragraph?.serializedText).not.toContain('Chart label');
    expect(atomics).toHaveLength(1);
    expect(atomics[0]?.template?.localName).toBe('math');
  });

  it('keeps direct text runs on either side of a nested block in DOM order', () => {
    document.body.innerHTML = `
      <div id="outer">Before <span>first</span><p>Nested text</p>After text</div>
    `;

    const paragraphs = parsePageParagraphs(document.querySelector('#outer')!);

    expect(paragraphs.map((paragraph) => paragraph.sourceText)).toEqual([
      'Before first',
      'Nested text',
      'After text',
    ]);
    expect(paragraphs[0]?.commonAncestor.id).toBe('outer');
    expect(paragraphs[1]?.commonAncestor.tagName).toBe('P');
    expect(paragraphs[2]?.commonAncestor.id).toBe('outer');
  });

  it('keeps repeated sibling runs uniquely keyed and ignores inserted target wrappers in the key', () => {
    document.body.innerHTML = '<div id="outer">Repeated text<p>Middle block</p>Repeated text</div>';
    const outer = document.querySelector('#outer')!;
    const before = parsePageParagraphs(outer);
    const repeated = before.filter((paragraph) => paragraph.sourceText === 'Repeated text');
    expect(repeated).toHaveLength(2);
    expect(repeated[0]?.key).not.toBe(repeated[1]?.key);

    const target = document.createElement('font');
    target.setAttribute('data-nira-translation', '');
    target.textContent = '译文';
    repeated[0]?.commonAncestor.insertBefore(target, repeated[0].rootNodes.at(-1)?.nextSibling ?? null);
    const after = parsePageParagraphs(outer);

    expect(after.filter((paragraph) => paragraph.sourceText === 'Repeated text').map((paragraph) => paragraph.key))
      .toEqual(repeated.map((paragraph) => paragraph.key));
  });

  it('chooses the lowest text-bearing span so inherited dark-page colors remain available', () => {
    document.body.innerHTML = `
      <div style="color:rgb(0, 0, 0);background:rgb(20, 20, 20)">
        <span id="light" style="color:rgb(242, 242, 242)">Readable text</span>
      </div>
    `;

    const [paragraph] = parsePageParagraphs(document.body);

    expect(paragraph?.commonAncestor).toBe(document.querySelector('#light'));
    expect(paragraph?.inline).toBe(true);
    expect(paragraph?.display).toBe('inline');
    expect(paragraphContainsNode(paragraph!, paragraph!.sourceTextNodes[0]!)).toBe(true);
  });

  it('translates semantic header, nav, footer and button content', () => {
    document.body.innerHTML = `
      <header>Header words</header>
      <nav>Navigation words</nav>
      <button>Button words</button>
      <footer>Footer words</footer>
    `;

    const paragraphs = parsePageParagraphs(document.body);

    expect(paragraphs.map((paragraph) => paragraph.sourceText)).toEqual([
      'Header words',
      'Navigation words',
      'Button words',
      'Footer words',
    ]);
    expect(isPageBlockElement(document.querySelector('nav')!)).toBe(true);
    expect(isPageExcludedElement(document.querySelector('button')!)).toBe(false);
  });

  it('keeps adjacent interactive buttons as separate paragraphs', () => {
    document.body.innerHTML = `
      <div style="display:flex">
        <button id="save">Save changes</button>
        <button id="cancel">Cancel changes</button>
      </div>
    `;

    const paragraphs = parsePageParagraphs(document.body);

    expect(paragraphs.map((paragraph) => paragraph.sourceText)).toEqual([
      'Save changes',
      'Cancel changes',
    ]);
    expect(paragraphs.map((paragraph) => paragraph.commonAncestor.id)).toEqual(['save', 'cancel']);
    expect(paragraphs.every((paragraph) => paragraph.tokens.size === 0)).toBe(true);
  });

  it('uses Immersive Translate style length thresholds for inline and block output', () => {
    document.body.innerHTML = `
      <p id="short">Short message</p>
      <span id="long">This inline source contains enough words to render its translation as a separate block</span>
      <div id="flex" style="display:flex">A long flex label that stays inline to avoid breaking the flex layout</div>
    `;

    const paragraphs = parsePageParagraphs(document.body);
    const byAncestor = new Map(paragraphs.map((paragraph) => [paragraph.commonAncestor.id, paragraph]));

    expect(byAncestor.get('short')?.inline).toBe(true);
    expect(byAncestor.get('long')?.inline).toBe(false);
    expect(byAncestor.get('flex')?.inline).toBe(true);
  });

  it('excludes editable, hidden and executable subtrees while filtering non-language noise', () => {
    document.body.innerHTML = `
      <div contenteditable="true">Editable words</div>
      <div hidden>Hidden words</div>
      <script>Script words</script>
      <iframe translate="no" src="https://example.invalid/active"></iframe>
      <object class="notranslate" data="https://example.invalid/active"></object>
      <textarea>Textarea words</textarea>
      <p>https://example.com/path</p>
      <p>person@example.com</p>
      <p>12345 !!!</p>
      <p id="valid">Visible words</p>
    `;

    const paragraphs = parsePageParagraphs(document.body);

    expect(paragraphs.map((paragraph) => paragraph.sourceText)).toEqual(['Visible words']);
    expect(isPageExcludedElement(document.querySelector('[contenteditable]')!)).toBe(true);
    expect(paragraphs[0]?.key).toBe(parsePageParagraphs(document.body)[0]?.key);
  });
});
