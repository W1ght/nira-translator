import type { PageToken } from './page-dom-parser';

export interface PageFragmentPlan {
  fragments: string[];
  joiners: string[];
  preserveStructure: boolean;
}

interface SafeRange {
  start: number;
  end: number;
}

interface TokenSyntax {
  kind: PageToken['kind'];
  structuralId: string;
}

interface ScannedStructure {
  valid: boolean;
  safeRanges: SafeRange[];
  safePoints: Set<number>;
}

interface Boundary {
  end: number;
  nextStart: number;
  joiner: string;
}

const TOKEN_CANDIDATE_PATTERN = /\{\{NIRA_[^{}\r\n]*\}\}/g;
const TOKEN_PREFIX = '{{NIRA_';
const TAG_TOKEN_PATTERN = /^\{\{NIRA_TAG_(\d+)_(START|END)\}\}$/;
const ATOMIC_TOKEN_PATTERN = /^\{\{NIRA_ATOMIC_(\d+)\}\}$/;
const BREAK_TOKEN_PATTERN = /^\{\{NIRA_BREAK_(\d+)\}\}$/;
const UNCONDITIONAL_SENTENCE_END = new Set(['!', '?', '\u3002', '\uff01', '\uff1f', '\u2026', '\uff1b']);

/**
 * Split a page paragraph for provider limits without cutting generated tokens
 * or leaving an inline element open across fragments.
 */
export function createPageFragmentPlan(
  serializedText: string,
  sourceText: string,
  tokens: ReadonlyMap<string, PageToken>,
  maxLength = 4_000,
): PageFragmentPlan {
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    throw new RangeError('maxLength must be a positive integer.');
  }

  const structure = scanStructure(serializedText, tokens);
  if (structure.valid) {
    if (serializedText.length <= maxLength) {
      return { fragments: [serializedText], joiners: [], preserveStructure: true };
    }

    const structured = splitWithSafeBoundaries(serializedText, maxLength, structure);
    if (structured) return { ...structured, preserveStructure: true };
  }

  const plain = splitPlainText(sourceText, maxLength);
  return { ...plain, preserveStructure: false };
}

function scanStructure(text: string, tokens: ReadonlyMap<string, PageToken>): ScannedStructure {
  for (const [key, token] of tokens) {
    const syntax = parseTokenSyntax(key);
    if (!syntax || token.id !== key || token.kind !== syntax.kind) return invalidStructure();
  }

  const safeRanges: SafeRange[] = [];
  const safePoints = new Set<number>([0]);
  const stack: string[] = [];
  const seen = new Set<string>();
  let cursor = 0;

  TOKEN_CANDIDATE_PATTERN.lastIndex = 0;
  for (let match = TOKEN_CANDIDATE_PATTERN.exec(text); match; match = TOKEN_CANDIDATE_PATTERN.exec(text)) {
    const key = match[0];
    const tokenStart = match.index;
    const tokenEnd = tokenStart + key.length;
    const plainText = text.slice(cursor, tokenStart);
    if (plainText.includes(TOKEN_PREFIX)) return invalidStructure();
    if (stack.length === 0) safeRanges.push({ start: cursor, end: tokenStart });

    const token = tokens.get(key);
    const syntax = parseTokenSyntax(key);
    if (!token || !syntax || token.kind !== syntax.kind || seen.has(key)) return invalidStructure();
    seen.add(key);

    if (syntax.kind === 'open') {
      if (stack.length === 0) safePoints.add(tokenStart);
      stack.push(syntax.structuralId);
    } else if (syntax.kind === 'close') {
      if (stack.at(-1) !== syntax.structuralId) return invalidStructure();
      stack.pop();
      if (stack.length === 0) safePoints.add(tokenEnd);
    } else if (stack.length === 0) {
      safePoints.add(tokenStart);
      safePoints.add(tokenEnd);
    }
    cursor = tokenEnd;
  }

  const tail = text.slice(cursor);
  if (tail.includes(TOKEN_PREFIX) || stack.length > 0 || seen.size !== tokens.size) {
    return invalidStructure();
  }
  safeRanges.push({ start: cursor, end: text.length });
  safePoints.add(text.length);

  return {
    valid: true,
    safeRanges: mergeSafeRanges(safeRanges),
    safePoints,
  };
}

function invalidStructure(): ScannedStructure {
  return { valid: false, safeRanges: [], safePoints: new Set() };
}

function parseTokenSyntax(key: string): TokenSyntax | null {
  const tag = key.match(TAG_TOKEN_PATTERN);
  if (tag) {
    return {
      kind: tag[2] === 'START' ? 'open' : 'close',
      structuralId: tag[1]!,
    };
  }
  const atomic = key.match(ATOMIC_TOKEN_PATTERN);
  if (atomic) return { kind: 'atomic', structuralId: atomic[1]! };
  const lineBreak = key.match(BREAK_TOKEN_PATTERN);
  if (lineBreak) return { kind: 'break', structuralId: lineBreak[1]! };
  return null;
}

function splitPlainText(text: string, maxLength: number): Omit<PageFragmentPlan, 'preserveStructure'> {
  if (text.length <= maxLength) return { fragments: [text], joiners: [] };
  const structure: ScannedStructure = {
    valid: true,
    safeRanges: [{ start: 0, end: text.length }],
    safePoints: new Set([0, text.length]),
  };
  return splitWithSafeBoundaries(text, maxLength, structure)
    ?? hardSplitText(text, maxLength);
}

function splitWithSafeBoundaries(
  text: string,
  maxLength: number,
  structure: ScannedStructure,
): Omit<PageFragmentPlan, 'preserveStructure'> | null {
  const fragments: string[] = [];
  const joiners: string[] = [];
  let start = 0;

  while (text.length - start > maxLength) {
    const boundary = findPreferredBoundary(text, start, maxLength, structure);
    if (!boundary || boundary.end <= start || boundary.nextStart <= start) return null;

    const fragment = text.slice(start, boundary.end);
    if (fragment.length === 0 || fragment.length > maxLength) return null;
    fragments.push(fragment);
    joiners.push(boundary.joiner);
    start = boundary.nextStart;
  }

  const finalFragment = text.slice(start);
  if (finalFragment.length > maxLength) return null;
  fragments.push(finalFragment);
  return { fragments, joiners };
}

function findPreferredBoundary(
  text: string,
  start: number,
  maxLength: number,
  structure: ScannedStructure,
): Boundary | null {
  const limit = Math.min(text.length - 1, start + maxLength);

  const sentence = findSentenceBoundary(text, start, limit, structure);
  if (sentence) return sentence;

  const newline = findWhitespaceBoundary(text, start, limit, structure, true);
  if (newline) return newline;

  const whitespace = findWhitespaceBoundary(text, start, limit, structure, false);
  if (whitespace) return whitespace;

  for (let position = start + maxLength; position > start; position -= 1) {
    if (position >= text.length || !isSafeBoundary(position, structure)) continue;
    if (splitsSurrogatePair(text, position) && position - start > 1) continue;
    return { end: position, nextStart: position, joiner: '' };
  }
  return null;
}

function findSentenceBoundary(
  text: string,
  start: number,
  limit: number,
  structure: ScannedStructure,
): Boundary | null {
  for (let position = limit; position > start; position -= 1) {
    if (!isSafeBoundary(position, structure)) continue;
    const punctuation = text[position - 1] ?? '';
    const next = text[position] ?? '';
    const isSentenceEnd = UNCONDITIONAL_SENTENCE_END.has(punctuation)
      || (punctuation === '.' && /\s/.test(next));
    if (!isSentenceEnd) continue;

    const whitespace = whitespaceRunAfter(text, position, structure);
    if (whitespace) {
      if (whitespace.end >= text.length) continue;
      return {
        end: position,
        nextStart: whitespace.end,
        joiner: whitespace.joiner,
      };
    }
    return { end: position, nextStart: position, joiner: '' };
  }
  return null;
}

function findWhitespaceBoundary(
  text: string,
  start: number,
  limit: number,
  structure: ScannedStructure,
  requireNewline: boolean,
): Boundary | null {
  for (let position = limit; position > start; position -= 1) {
    const character = text[position - 1] ?? '';
    if (!/\s/.test(character) || !isSafeBoundary(position, structure)) continue;

    let runStart = position - 1;
    while (
      runStart > start
      && /\s/.test(text[runStart - 1] ?? '')
      && isSafeBoundary(runStart, structure)
    ) runStart -= 1;

    let runEnd = position;
    while (
      runEnd < text.length
      && /\s/.test(text[runEnd] ?? '')
      && isSafeBoundary(runEnd + 1, structure)
    ) runEnd += 1;

    if (runStart <= start || runEnd >= text.length) continue;
    const whitespace = text.slice(runStart, runEnd);
    const hasNewline = /[\r\n]/.test(whitespace);
    if (requireNewline !== hasNewline && requireNewline) continue;
    return {
      end: runStart,
      nextStart: runEnd,
      joiner: whitespace,
    };
  }
  return null;
}

function whitespaceRunAfter(
  text: string,
  start: number,
  structure: ScannedStructure,
): { end: number; joiner: string } | null {
  if (!/\s/.test(text[start] ?? '') || !isSafeBoundary(start, structure)) return null;
  let end = start;
  while (
    end < text.length
    && /\s/.test(text[end] ?? '')
    && isSafeBoundary(end + 1, structure)
  ) end += 1;
  const whitespace = text.slice(start, end);
  return { end, joiner: whitespace };
}

function isSafeBoundary(position: number, structure: ScannedStructure): boolean {
  if (structure.safePoints.has(position)) return true;
  let low = 0;
  let high = structure.safeRanges.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const range = structure.safeRanges[middle]!;
    if (position < range.start) high = middle - 1;
    else if (position > range.end) low = middle + 1;
    else return true;
  }
  return false;
}

function mergeSafeRanges(ranges: SafeRange[]): SafeRange[] {
  const merged: SafeRange[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function hardSplitText(text: string, maxLength: number): Omit<PageFragmentPlan, 'preserveStructure'> {
  const fragments: string[] = [];
  const joiners: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxLength);
    if (end < text.length && splitsSurrogatePair(text, end) && end - start > 1) end -= 1;
    fragments.push(text.slice(start, end));
    start = end;
    if (start < text.length) joiners.push('');
  }
  if (fragments.length === 0) fragments.push('');
  return { fragments, joiners };
}

function splitsSurrogatePair(text: string, position: number): boolean {
  const before = text.charCodeAt(position - 1);
  const after = text.charCodeAt(position);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}
