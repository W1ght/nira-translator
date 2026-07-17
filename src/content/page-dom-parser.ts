const EXCLUDED_TAGS = new Set([
  'BASE',
  'CANVAS',
  'EMBED',
  'HEAD',
  'IFRAME',
  'INPUT',
  'LINK',
  'META',
  'NOSCRIPT',
  'OBJECT',
  'OPTION',
  'SCRIPT',
  'SELECT',
  'STYLE',
  'SVG',
  'TEMPLATE',
  'TEXTAREA',
  'TITLE',
]);

const ATOMIC_TAGS = new Set([
  'CODE',
  'IMG',
  'KBD',
  'MATH',
  'SAMP',
  'SUB',
  'SUP',
  'TT',
]);
const ACTIVE_CLONE_TAGS = new Set([
  'A',
  'AUDIO',
  'BUTTON',
  'DETAILS',
  'EMBED',
  'FORM',
  'IFRAME',
  'INPUT',
  'LABEL',
  'OBJECT',
  'OPTION',
  'SELECT',
  'SUMMARY',
  'TEXTAREA',
  'VIDEO',
]);

const DEFAULT_INLINE_TAGS = new Set([
  'A',
  'ABBR',
  'ACRONYM',
  'AUDIO',
  'B',
  'BDI',
  'BDO',
  'BIG',
  'BR',
  'BUTTON',
  'CITE',
  'DATA',
  'DEL',
  'DFN',
  'EM',
  'FONT',
  'I',
  'IFRAME',
  'IMG',
  'INS',
  'KBD',
  'LABEL',
  'MARK',
  'OBJECT',
  'OUTPUT',
  'PICTURE',
  'Q',
  'RUBY',
  'S',
  'SAMP',
  'SMALL',
  'SPAN',
  'STRIKE',
  'STRONG',
  'SUB',
  'SUP',
  'TIME',
  'TT',
  'U',
  'VAR',
  'VIDEO',
  'WBR',
]);
const FORCED_PARAGRAPH_BOUNDARY_TAGS = new Set(['BUTTON']);

const EXPLICIT_BREAK_SENTINEL = '\u0000NIRA_BREAK\u0000';
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML';

export type PageToken = {
  id: string;
  kind: 'open' | 'close' | 'atomic' | 'break';
  template?: HTMLElement;
};

export interface ParsedParagraph {
  key: string;
  commonAncestor: HTMLElement;
  rootNodes: Node[];
  flatNodes: Node[];
  sourceTextNodes: Text[];
  sourceText: string;
  serializedText: string;
  tokens: Map<string, PageToken>;
  inline: boolean;
  preformatted: boolean;
  display: string;
}

type PageUnit = {
  node: Node;
  owner: HTMLElement | null;
  kind: 'text' | 'atomic' | 'break';
};

/**
 * Parse the visible DOM into paragraph-sized, ordered translation units.
 *
 * Like Immersive Translate's paragraph walk, this treats block elements as
 * boundaries while keeping consecutive text and inline siblings together. It
 * deliberately records DOM nodes instead of HTML strings so rendering can be
 * performed without injecting innerHTML.
 */
export function parsePageParagraphs(root: ParentNode): ParsedParagraph[] {
  if (root instanceof Element && isInsideExcludedTree(root)) return [];

  const units: PageUnit[] = [];
  const initialOwner = root instanceof HTMLElement
    ? (isPageBlockElement(root) ? root : nearestBlockAncestor(root.parentElement))
    : null;

  if (root instanceof Element) {
    walkChildren(root, initialOwner, units);
  } else {
    for (const child of root.childNodes) walkNode(child, initialOwner, units);
  }

  const groups: PageUnit[][] = [];
  let current: PageUnit[] = [];
  let currentOwner: HTMLElement | null | undefined;

  for (const unit of units) {
    if (current.length > 0 && unit.owner !== currentOwner) {
      groups.push(current);
      current = [];
    }
    if (current.length === 0) currentOwner = unit.owner;
    current.push(unit);
  }
  if (current.length > 0) groups.push(current);

  const paragraphs: ParsedParagraph[] = [];
  for (const group of groups) {
    const paragraph = buildParagraph(trimFormattingWhitespace(group));
    if (paragraph && isWorthTranslating(paragraph.sourceText)) paragraphs.push(paragraph);
  }
  return paragraphs;
}

function trimFormattingWhitespace(units: PageUnit[]): PageUnit[] {
  let start = 0;
  let end = units.length;
  while (start < end && isWhitespaceUnit(units[start]!)) start += 1;
  while (end > start && isWhitespaceUnit(units[end - 1]!)) end -= 1;
  return units.slice(start, end);
}

function isWhitespaceUnit(unit: PageUnit): boolean {
  return unit.kind === 'text' && !(unit.node as Text).data.trim();
}

/** Returns whether the element establishes a visual paragraph boundary. */
export function isPageBlockElement(element: HTMLElement): boolean {
  const tag = normalizedTagName(element);
  if (FORCED_PARAGRAPH_BOUNDARY_TAGS.has(tag)) return true;
  const display = computedDisplay(element);
  if (display === 'none' || display === 'contents') return false;
  if (display) {
    const outerDisplay = display.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? '';
    return !outerDisplay.startsWith('inline') && !outerDisplay.startsWith('ruby');
  }
  return !DEFAULT_INLINE_TAGS.has(tag);
}

/** Returns whether this element and its descendants must be omitted entirely. */
export function isPageExcludedElement(element: Element): boolean {
  const tag = normalizedTagName(element);
  if (element.namespaceURI && element.namespaceURI !== HTML_NAMESPACE
    && !(element.namespaceURI === MATHML_NAMESPACE && tag === 'MATH')) return true;
  if (EXCLUDED_TAGS.has(tag)) return true;
  if (element.hasAttribute('hidden') || element.hasAttribute('inert')) return true;
  if (element.getAttribute('aria-hidden')?.toLowerCase() === 'true') return true;
  if (element.hasAttribute('data-nira-root')
    || element.hasAttribute('data-nira-translation')
    || element.hasAttribute('data-nira-translation-inner')) return true;
  if (hasEnabledContentEditable(element)) return true;

  if (element instanceof HTMLElement) {
    const style = getComputedStyleSafe(element);
    if (style?.display === 'none') return true;
    if (style?.opacity === '0') return true;
    if (style?.visibility === 'hidden' || style?.visibility === 'collapse') return true;
  }
  return false;
}

/** Fast overlap check used by mutation handling. */
export function paragraphContainsNode(paragraph: ParsedParagraph, node: Node): boolean {
  if (paragraph.commonAncestor === node) return true;
  return paragraph.rootNodes.some((rootNode) => rootNode === node || rootNode.contains(node));
}

function walkChildren(element: Element, owner: HTMLElement | null, units: PageUnit[]): void {
  if (isPageExcludedElement(element) || isAtomicElement(element)) return;
  for (const child of element.childNodes) walkNode(child, owner, units);
}

function walkNode(node: Node, owner: HTMLElement | null, units: PageUnit[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node as Text;
    if (text.data.length > 0) units.push({ node: text, owner, kind: 'text' });
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const element = node as Element;
  if (isPageExcludedElement(element)) return;
  if (isAtomicElement(element)) {
    units.push({ node: element, owner, kind: 'atomic' });
    return;
  }
  if (normalizedTagName(element) === 'BR') {
    units.push({ node: element, owner, kind: 'break' });
    return;
  }

  const nextOwner = element instanceof HTMLElement && isPageBlockElement(element) ? element : owner;
  for (const child of element.childNodes) walkNode(child, nextOwner, units);
}

function buildParagraph(units: PageUnit[]): ParsedParagraph | null {
  if (units.length === 0) return null;
  const commonAncestor = lowestCommonHtmlAncestor(units.map((unit) => unit.node));
  if (!commonAncestor) return null;

  const firstRoot = directChildUnder(commonAncestor, units[0]!.node);
  const lastRoot = directChildUnder(commonAncestor, units.at(-1)!.node);
  if (!firstRoot || !lastRoot) return null;

  const children: Node[] = [...commonAncestor.childNodes];
  const firstIndex = children.indexOf(firstRoot);
  const lastIndex = children.indexOf(lastRoot);
  if (firstIndex < 0 || lastIndex < firstIndex) return null;
  const rootNodes = children.slice(firstIndex, lastIndex + 1);

  const unitNodes = new Set(units.map((unit) => unit.node));
  const relevantNodes = new Set<Node>();
  for (const unit of units) {
    let current: Node | null = unit.node;
    while (current && current !== commonAncestor) {
      relevantNodes.add(current);
      current = current.parentNode;
    }
  }

  const display = computedDisplay(commonAncestor);
  const preformatted = isPreformatted(commonAncestor);
  const tokens = new Map<string, PageToken>();
  const flatNodes: Node[] = [];
  const sourceTextNodes: Text[] = [];
  const sourceParts: string[] = [];
  const serializedParts: string[] = [];
  let tokenIndex = 0;

  const serialize = (node: Node): void => {
    if (!relevantNodes.has(node)) return;

    if (node.nodeType === Node.TEXT_NODE) {
      if (!unitNodes.has(node)) return;
      const text = node as Text;
      flatNodes.push(text);
      sourceTextNodes.push(text);
      sourceParts.push(text.data);
      serializedParts.push(text.data);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as Element;
    flatNodes.push(element);

    if (isAtomicElement(element)) {
      const id = `{{NIRA_ATOMIC_${tokenIndex++}}}`;
      tokens.set(id, {
        id,
        kind: 'atomic',
        ...(isSafeAtomicClone(element)
          ? { template: element instanceof HTMLElement ? element : element.cloneNode(true) as HTMLElement }
          : {}),
      });
      serializedParts.push(id);
      return;
    }
    if (normalizedTagName(element) === 'BR') {
      const id = `{{NIRA_BREAK_${tokenIndex++}}}`;
      tokens.set(id, { id, kind: 'break' });
      sourceParts.push(EXPLICIT_BREAK_SENTINEL);
      serializedParts.push(id);
      return;
    }

    const index = tokenIndex++;
    const openId = `{{NIRA_TAG_${index}_START}}`;
    const closeId = `{{NIRA_TAG_${index}_END}}`;
    tokens.set(openId, {
      id: openId,
      kind: 'open',
      template: element.cloneNode(false) as HTMLElement,
    });
    tokens.set(closeId, { id: closeId, kind: 'close' });
    serializedParts.push(openId);
    for (const child of element.childNodes) serialize(child);
    serializedParts.push(closeId);
  };

  for (const rootNode of rootNodes) serialize(rootNode);

  const sourceText = normalizeSourceText(sourceParts.join(''), preformatted);
  const serializedText = normalizeSerializedText(serializedParts.join(''), preformatted);
  const stableChildren = children.filter((node) => (
    !(node instanceof Element && node.hasAttribute('data-nira-translation'))
  ));
  const rootPosition = stableChildren.indexOf(firstRoot);
  const structure = `${rootPosition}|${rootNodes.map(nodeShape).join(',')}|${serializedText}`;

  return {
    key: `nira-${stableHash(`${sourceText}\u001f${structure}`)}`,
    commonAncestor,
    rootNodes,
    flatNodes,
    sourceTextNodes,
    sourceText,
    serializedText,
    tokens,
    inline: shouldRenderInline(sourceText, display),
    preformatted,
    display,
  };
}

function shouldRenderInline(text: string, display: string): boolean {
  if (display.includes('flex')) return true;
  const compact = text.replace(/\s+/g, ' ').trim();
  const wordCount = compact.match(/\p{L}[\p{L}\p{M}\p{N}'\u2019-]*/gu)?.length ?? 0;
  const characterCount = Array.from(compact.replace(/\s/g, '')).length;
  return !compact.includes('\n') && wordCount <= 4 && characterCount <= 24;
}

function isAtomicElement(element: Element): boolean {
  return ATOMIC_TAGS.has(normalizedTagName(element))
    || element.getAttribute('translate')?.toLowerCase() === 'no'
    || element.classList.contains('notranslate');
}

function isSafeAtomicClone(element: Element): boolean {
  const expectedNamespace = element.namespaceURI === MATHML_NAMESPACE ? MATHML_NAMESPACE : HTML_NAMESPACE;
  for (const candidate of [element, ...element.querySelectorAll('*')]) {
    const tag = normalizedTagName(candidate);
    if (candidate.namespaceURI !== expectedNamespace) return false;
    if (ACTIVE_CLONE_TAGS.has(tag)) return false;
    if (tag.includes('-')) return false;
    if (candidate.hasAttribute('contenteditable') || candidate.hasAttribute('tabindex')) return false;
  }
  return true;
}

function hasEnabledContentEditable(element: Element): boolean {
  if (!element.hasAttribute('contenteditable')) return false;
  return element.getAttribute('contenteditable')?.toLowerCase() !== 'false';
}

function isInsideExcludedTree(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (isPageExcludedElement(current)) return true;
    if (current !== element && isAtomicElement(current)) return true;
    current = current.parentElement;
  }
  return false;
}

function nearestBlockAncestor(element: HTMLElement | null): HTMLElement | null {
  let current = element;
  while (current) {
    if (isPageExcludedElement(current) || isAtomicElement(current)) return null;
    if (isPageBlockElement(current)) return current;
    current = current.parentElement;
  }
  return null;
}

function lowestCommonHtmlAncestor(nodes: Node[]): HTMLElement | null {
  const first = nodes[0];
  if (!first) return null;
  let candidate = first.parentElement;
  while (candidate) {
    const current = candidate;
    if (nodes.every((node) => current === node.parentElement || current.contains(node))) return current;
    candidate = candidate.parentElement;
  }
  return null;
}

function directChildUnder(ancestor: HTMLElement, node: Node): Node | null {
  let current: Node | null = node;
  while (current && current.parentNode !== ancestor) current = current.parentNode;
  return current?.parentNode === ancestor ? current : null;
}

function isPreformatted(element: HTMLElement): boolean {
  if (element.closest('pre')) return true;
  const whiteSpace = getComputedStyleSafe(element)?.whiteSpace.toLowerCase() ?? '';
  return whiteSpace === 'pre' || whiteSpace === 'pre-wrap' || whiteSpace === 'break-spaces';
}

function computedDisplay(element: HTMLElement): string {
  const value = getComputedStyleSafe(element)?.display.trim().toLowerCase();
  if (value) return value;
  return DEFAULT_INLINE_TAGS.has(normalizedTagName(element)) ? 'inline' : 'block';
}

function getComputedStyleSafe(element: HTMLElement): CSSStyleDeclaration | null {
  try {
    return element.ownerDocument.defaultView?.getComputedStyle(element) ?? null;
  } catch {
    return null;
  }
}

function normalizeSourceText(value: string, preformatted: boolean): string {
  if (preformatted) {
    return value
      .split(EXPLICIT_BREAK_SENTINEL).join('\n')
      .replace(/\r\n?/g, '\n')
      .trim();
  }
  return value
    .split(EXPLICIT_BREAK_SENTINEL)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .join('\n')
    .trim();
}

function normalizeSerializedText(value: string, preformatted: boolean): string {
  if (preformatted) return value.replace(/\r\n?/g, '\n').trim();
  return value.replace(/\s+/g, ' ').trim();
}

function isWorthTranslating(text: string): boolean {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (Array.from(compact.replace(/\s/g, '')).length < 2) return false;
  if (/^(?:(?:https?|ftp):\/\/|www\.)\S+$/iu.test(compact)) return false;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(compact)) return false;
  if (!/\p{L}/u.test(compact)) return false;
  return (compact.match(/\p{L}[\p{L}\p{M}\p{N}'\u2019-]*/gu)?.length ?? 0) >= 1;
}

function nodeShape(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return '#text';
  if (node.nodeType === Node.COMMENT_NODE) return '#comment';
  if (node instanceof Element) {
    return `${node.localName.toLowerCase()}(${[...node.childNodes].map(nodeShape).join(',')})`;
  }
  return `#${node.nodeType}`;
}

function normalizedTagName(element: Element): string {
  return element.localName.toUpperCase();
}

function stableHash(value: string): string {
  let primary = 0x811c9dc5;
  let secondary = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    primary ^= code;
    primary = Math.imul(primary, 0x01000193);
    secondary ^= code + index;
    secondary = Math.imul(secondary, 0x85ebca6b);
  }
  return `${(primary >>> 0).toString(36)}${(secondary >>> 0).toString(36)}`;
}
