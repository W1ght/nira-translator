import type { PageToken, ParsedParagraph } from './page-dom-parser';

type PageDisplayMode = 'dual' | 'translation';
type RenderState = 'loading' | 'done';

interface TokenPiece {
  key: string;
  token: PageToken;
}

interface TextPiece {
  text: string;
}

type TranslationPiece = TokenPiece | TextPiece;

interface OpenElement {
  id: string;
  element: HTMLElement;
}

type StyleableElement = Element & { style: CSSStyleDeclaration };

interface DisplaySnapshot {
  value: string;
  priority: string;
}

const RTL_LANGUAGES = new Set([
  'ar',
  'arc',
  'ckb',
  'dv',
  'fa',
  'he',
  'iw',
  'ks',
  'ku',
  'nqo',
  'ps',
  'sd',
  'ug',
  'ur',
  'yi',
]);

const RTL_SCRIPTS = new Set(['adlm', 'arab', 'hebr', 'nkoo', 'rohg', 'thaa']);
const REMOVED_CLONE_TAGS = new Set(['BASE', 'EMBED', 'IFRAME', 'META', 'OBJECT', 'SCRIPT', 'STYLE']);
const ACTIVE_CLONE_TAGS = new Set([
  'A', 'AUDIO', 'BUTTON', 'DETAILS', 'FORM', 'INPUT', 'LABEL', 'OPTION', 'SELECT', 'SUMMARY', 'TEXTAREA', 'VIDEO',
]);
const SAFE_INLINE_CLONE_TAGS = new Set([
  'A', 'ABBR', 'ACRONYM', 'B', 'BDI', 'BDO', 'BIG', 'CITE', 'DATA', 'DEL', 'DFN', 'EM', 'FONT', 'I',
  'INS', 'MARK', 'Q', 'RUBY', 'S', 'SMALL', 'SPAN', 'STRIKE', 'STRONG', 'TIME', 'U', 'VAR',
]);
const GENERATED_TOKEN_PATTERN = /\{\{NIRA_(?:TAG_[^{}]+_(?:START|END)|ATOMIC_[^{}]+|BREAK_[^{}]+)\}\}/g;
const GENERATED_TOKEN_EXACT_PATTERN = /^\{\{NIRA_(?:TAG_[^{}]+_(?:START|END)|ATOMIC_[^{}]+|BREAK_[^{}]+)\}\}$/;
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML';
const suppressedSourceElements = new WeakMap<RenderedParagraph, Map<StyleableElement, DisplaySnapshot>>();
const decodedAllTokens = new WeakSet<HTMLElement>();

export interface RenderedParagraph {
  outer: HTMLElement;
  inner: HTMLElement;
  sourceSnapshot: Map<Text, string>;
  sourceSuppressed: boolean;
}

export function insertParagraphTranslation(
  paragraph: ParsedParagraph,
  translated: string,
  targetLanguage: string,
  state: RenderState,
  preserveStructure = true,
): RenderedParagraph {
  const document = paragraph.commonAncestor.ownerDocument;
  const outer = document.createElement('font');
  const inner = document.createElement('font');

  outer.setAttribute('data-nira-translation', '');
  inner.setAttribute('data-nira-translation-inner', '');
  outer.setAttribute('translate', 'no');
  inner.setAttribute('translate', 'no');
  outer.append(inner);

  const rendered: RenderedParagraph = {
    outer,
    inner,
    sourceSnapshot: new Map<Text, string>(paragraph.sourceTextNodes.map((node) => [node, node.data])),
    sourceSuppressed: false,
  };

  applyParagraphAttributes(rendered, paragraph, targetLanguage, state);
  renderTranslation(rendered.inner, paragraph, translated, state, preserveStructure);
  insertAfterParagraphRoots(paragraph, rendered.outer);

  return rendered;
}

export function updateParagraphTranslation(
  rendered: RenderedParagraph,
  paragraph: ParsedParagraph,
  translated: string,
  targetLanguage: string,
  preserveStructure = true,
): void {
  applyParagraphAttributes(rendered, paragraph, targetLanguage, 'done');
  renderTranslation(rendered.inner, paragraph, translated, 'done', preserveStructure);
  insertAfterParagraphRoots(paragraph, rendered.outer);
}

export function setParagraphDisplayMode(
  rendered: RenderedParagraph,
  paragraph: ParsedParagraph,
  mode: PageDisplayMode,
): void {
  if (mode === 'translation') {
    if (rendered.sourceSuppressed) return;

    for (const textNode of paragraph.sourceTextNodes) {
      rendered.sourceSnapshot.set(textNode, textNode.data);
      textNode.data = '';
    }
    suppressSourceElements(rendered, paragraph);
    rendered.sourceSuppressed = true;
    return;
  }

  restoreSourceText(rendered);
}

export function removeParagraphTranslation(
  rendered: RenderedParagraph,
  _paragraph: ParsedParagraph,
): void {
  restoreSourceText(rendered);
  rendered.outer.remove();
}

export function isNiraTranslationNode(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE
    ? node as Element
    : node.parentElement;
  return Boolean(element?.closest('[data-nira-translation], [data-nira-translation-inner]'));
}

function applyParagraphAttributes(
  rendered: RenderedParagraph,
  paragraph: ParsedParagraph,
  targetLanguage: string,
  state: RenderState,
): void {
  const display = paragraph.inline ? 'inline' : 'block';
  rendered.outer.setAttribute('data-nira-display', display);
  rendered.outer.setAttribute('data-nira-state', state);
  rendered.outer.toggleAttribute('data-nira-preformatted', paragraph.preformatted);
  for (const element of [rendered.outer, rendered.inner]) {
    element.lang = targetLanguage;
    element.dir = directionForLanguage(targetLanguage);
    element.style.userSelect = 'text';
    element.style.setProperty('-webkit-user-select', 'text');
    element.style.setProperty('color', 'inherit', 'important');
    element.style.setProperty('font', 'inherit', 'important');
    element.style.setProperty('line-height', 'inherit', 'important');
    element.style.setProperty('letter-spacing', 'inherit', 'important');
  }
  rendered.outer.style.display = display;
  rendered.outer.style.boxSizing = 'border-box';
  rendered.outer.style.maxWidth = '100%';
  rendered.outer.style.pointerEvents = 'auto';
  rendered.outer.style.whiteSpace = paragraph.preformatted ? 'pre-wrap' : 'normal';
  if (display === 'block') {
    rendered.outer.style.marginBlock = '0.38em 0.56em';
    rendered.outer.style.removeProperty('margin-inline-start');
  } else {
    rendered.outer.style.marginInlineStart = '0.38em';
    rendered.outer.style.removeProperty('margin-block');
  }
}

function renderTranslation(
  target: HTMLElement,
  paragraph: ParsedParagraph,
  translated: string,
  state: RenderState,
  preserveStructure: boolean,
): void {
  if (state === 'loading') {
    decodedAllTokens.delete(target);
    target.replaceChildren(target.ownerDocument.createTextNode(translated));
    return;
  }

  const decoded = preserveStructure ? decodeTranslation(paragraph, translated) : null;
  if (decoded) {
    decodedAllTokens.add(target);
    target.replaceChildren(decoded);
    return;
  }

  decodedAllTokens.delete(target);
  target.replaceChildren(target.ownerDocument.createTextNode(stripGeneratedTokens(translated, paragraph.tokens)));
}

function decodeTranslation(paragraph: ParsedParagraph, translated: string): DocumentFragment | null {
  const pieces = splitTranslation(translated, paragraph.tokens);
  if (!pieces) return null;

  const document = paragraph.commonAncestor.ownerDocument;
  const fragment = document.createDocumentFragment();
  const stack: OpenElement[] = [];
  const opened = new Set<string>();
  const closed = new Set<string>();
  const standalone = new Set<string>();
  let parent: Node = fragment;

  for (const piece of pieces) {
    if ('text' in piece) {
      if (piece.text) parent.appendChild(document.createTextNode(piece.text));
      continue;
    }

    const { key, token } = piece;
    if (token.kind === 'open') {
      const id = structuralTokenId(key, token.kind);
      if (!id || opened.has(id) || closed.has(id) || standalone.has(id) || !token.template) return null;
      const clone = token.template.cloneNode(false);
      if (clone.nodeType !== Node.ELEMENT_NODE) return null;
      if (!sanitizeClonedElement(clone as HTMLElement, 'inline')) return null;
      parent.appendChild(clone);
      opened.add(id);
      stack.push({ id, element: clone as HTMLElement });
      parent = clone;
      continue;
    }

    if (token.kind === 'close') {
      const id = structuralTokenId(key, token.kind);
      const open = stack.at(-1);
      if (!id || !open || open.id !== id || closed.has(id)) return null;
      stack.pop();
      closed.add(id);
      parent = stack.at(-1)?.element ?? fragment;
      continue;
    }

    const id = token.id || key;
    if (standalone.has(id) || opened.has(id) || closed.has(id)) return null;
    standalone.add(id);

    if (token.kind === 'atomic') {
      if (!token.template) return null;
      const clone = token.template.cloneNode(true);
      if (clone.nodeType !== Node.ELEMENT_NODE) return null;
      if (!sanitizeClonedElement(clone as HTMLElement, 'atomic')) return null;
      parent.appendChild(clone);
    } else {
      parent.appendChild(document.createElement('br'));
    }
  }

  if (stack.length > 0 || opened.size !== closed.size) return null;
  return fragment;
}

function sanitizeClonedElement(root: HTMLElement, mode: 'inline' | 'atomic'): boolean {
  const rootTag = normalizedTagName(root);
  if (mode === 'inline' && root.namespaceURI !== HTML_NAMESPACE) return false;
  if (mode === 'atomic' && root.namespaceURI !== HTML_NAMESPACE && root.namespaceURI !== MATHML_NAMESPACE) return false;
  if (REMOVED_CLONE_TAGS.has(rootTag)) return false;
  if (rootTag.includes('-')) return false;
  if (mode === 'inline' && !SAFE_INLINE_CLONE_TAGS.has(rootTag)) return false;
  for (const element of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    const tag = normalizedTagName(element);
    if (tag.includes('-') || element.hasAttribute('contenteditable') || element.hasAttribute('tabindex')) {
      return false;
    }
    if (mode === 'atomic' && ACTIVE_CLONE_TAGS.has(tag)) return false;
    if (element !== root && REMOVED_CLONE_TAGS.has(tag)) {
      if (mode === 'atomic') return false;
      element.remove();
      continue;
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name === 'id' || name === 'autofocus' || name === 'srcdoc' || name.startsWith('on')) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return true;
}

function splitTranslation(translated: string, tokens: Map<string, PageToken>): TranslationPiece[] | null {
  if (tokens.size === 0) return [{ text: translated }];
  const tokenKeys = [...tokens.keys()];
  if (tokenKeys.some((key) => !GENERATED_TOKEN_EXACT_PATTERN.test(key))) return null;

  const pieces: TranslationPiece[] = [];
  const counts = new Map<string, number>();
  let cursor = 0;

  GENERATED_TOKEN_PATTERN.lastIndex = 0;
  for (let match = GENERATED_TOKEN_PATTERN.exec(translated); match; match = GENERATED_TOKEN_PATTERN.exec(translated)) {
    const key = match[0];
    if (match.index > cursor) pieces.push({ text: translated.slice(cursor, match.index) });
    const token = tokens.get(key);
    if (!token) return null;
    pieces.push({ key, token });
    counts.set(key, (counts.get(key) ?? 0) + 1);
    cursor = match.index + key.length;
  }
  if (cursor < translated.length) pieces.push({ text: translated.slice(cursor) });
  for (const key of tokenKeys) {
    if (counts.get(key) !== 1) return null;
  }

  return pieces;
}

function structuralTokenId(key: string, kind: 'open' | 'close'): string | null {
  const suffix = kind === 'open' ? 'START' : 'END';
  const match = key.match(new RegExp(`^\\{\\{NIRA_TAG_([^{}]+)_${suffix}\\}\\}$`));
  return match?.[1] ?? null;
}

function stripGeneratedTokens(translated: string, _tokens: Map<string, PageToken>): string {
  GENERATED_TOKEN_PATTERN.lastIndex = 0;
  return translated.replace(GENERATED_TOKEN_PATTERN, '');
}

function insertAfterParagraphRoots(paragraph: ParsedParagraph, translation: HTMLElement): void {
  const lastRoot = [...paragraph.rootNodes]
    .reverse()
    .find((node) => node.parentNode === paragraph.commonAncestor);
  const reference = lastRoot?.nextSibling ?? null;
  if (translation.parentNode === paragraph.commonAncestor && translation === reference) return;
  paragraph.commonAncestor.insertBefore(translation, reference);
}

function restoreSourceText(rendered: RenderedParagraph): void {
  if (!rendered.sourceSuppressed) return;
  for (const [textNode, text] of rendered.sourceSnapshot) textNode.data = text;
  restoreSourceElements(rendered);
  rendered.sourceSuppressed = false;
}

function suppressSourceElements(rendered: RenderedParagraph, paragraph: ParsedParagraph): void {
  if (!decodedAllTokens.has(rendered.inner)) return;
  const elements = paragraph.rootNodes.filter(hasInlineStyle);
  if (elements.length === 0) return;
  const snapshots = suppressedSourceElements.get(rendered) ?? new Map<StyleableElement, DisplaySnapshot>();

  for (const element of elements) {
    if (!snapshots.has(element)) {
      snapshots.set(element, {
        value: element.style.getPropertyValue('display'),
        priority: element.style.getPropertyPriority('display'),
      });
    }
    element.style.setProperty('display', 'none', 'important');
  }

  suppressedSourceElements.set(rendered, snapshots);
}

function restoreSourceElements(rendered: RenderedParagraph): void {
  const snapshots = suppressedSourceElements.get(rendered);
  if (!snapshots) return;

  for (const [element, snapshot] of snapshots) {
    if (snapshot.value) element.style.setProperty('display', snapshot.value, snapshot.priority);
    else element.style.removeProperty('display');
  }
  suppressedSourceElements.delete(rendered);
}

function hasInlineStyle(node: Node): node is StyleableElement {
  return node.nodeType === Node.ELEMENT_NODE && 'style' in node;
}

function normalizedTagName(element: Element): string {
  return element.localName.toUpperCase();
}

function directionForLanguage(language: string): 'ltr' | 'rtl' {
  const subtags = language.toLowerCase().split(/[-_]/).filter(Boolean);
  if (subtags.some((subtag) => RTL_SCRIPTS.has(subtag))) return 'rtl';
  return RTL_LANGUAGES.has(subtags[0] ?? '') ? 'rtl' : 'ltr';
}
