import type {
  PromptTemplate,
  TranslationRequest,
  TranslationSegment,
} from '../types/domain';
import { createTranslationError } from './errors';

const NONCE_PATTERN = /^[a-f0-9]{32}$/;
const ANY_PROTOCOL_MARKER = '<<<LIUYI:';

export interface PromptVariables {
  sourceLanguage: string;
  targetLanguage: string;
  text: string;
}

export interface SegmentProtocol {
  nonce: string;
  segmentIds: string[];
  serializedText: string;
}

export interface BuiltTranslationPrompt {
  system: string;
  user: string;
  segmentIds: string[];
  protocol?: SegmentProtocol;
}

function marker(nonce: string, index: number, boundary: 'BEGIN' | 'END'): string {
  return `<<<LIUYI:${nonce}:SEGMENT:${index}:${boundary}>>>`;
}

function assertNonce(nonce: string): void {
  if (!NONCE_PATTERN.test(nonce)) {
    throw new Error('Segment protocol nonce must be 32 lowercase hexadecimal characters');
  }
}

export function createSegmentNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createSegmentProtocol(
  segments: readonly TranslationSegment[],
  nonce = createSegmentNonce(),
): SegmentProtocol {
  assertNonce(nonce);
  if (segments.length === 0) {
    throw new Error('At least one translation segment is required');
  }

  const ids = new Set<string>();
  const serialized: string[] = [];

  segments.forEach((segment, index) => {
    if (!segment.id || ids.has(segment.id)) {
      throw new Error('Translation segment IDs must be non-empty and unique');
    }
    ids.add(segment.id);

    const begin = marker(nonce, index, 'BEGIN');
    const end = marker(nonce, index, 'END');
    if (segment.text.includes(begin) || segment.text.includes(end)) {
      throw new Error('Translation text collides with the generated segment protocol');
    }
    serialized.push(`${begin}\n${segment.text}\n${end}`);
  });

  return {
    nonce,
    segmentIds: segments.map((segment) => segment.id),
    serializedText: serialized.join('\n'),
  };
}

export function renderPromptTemplate(
  template: string,
  variables: PromptVariables,
): string {
  return template.replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g, (_match, key: string) => {
    if (!(key in variables)) {
      throw new Error(`Unknown prompt variable: ${key}`);
    }
    return variables[key as keyof PromptVariables];
  });
}

export function buildTranslationPrompt(
  templates: PromptTemplate,
  request: TranslationRequest,
  nonce?: string,
): BuiltTranslationPrompt {
  if (request.segments.length === 0) {
    throw createTranslationError('INVALID_PROFILE', '没有可翻译的文本', false);
  }

  const isPage = request.kind === 'page';
  const protocol = isPage ? createSegmentProtocol(request.segments, nonce) : undefined;
  const text = protocol?.serializedText
    ?? request.segments.map((segment) => segment.text).join('\n\n');
  const variables: PromptVariables = {
    sourceLanguage: request.sourceLanguage,
    targetLanguage: request.targetLanguage,
    text,
  };
  const systemTemplate = isPage ? templates.pageSystem : templates.selectionSystem;
  const userTemplate = isPage ? templates.pageUser : templates.selectionUser;
  const system = renderPromptTemplate(systemTemplate, variables);
  const user = renderPromptTemplate(userTemplate, variables);

  if (!protocol) {
    return {
      system,
      user,
      segmentIds: request.segments.map((segment) => segment.id),
    };
  }

  return {
    system: `${system}\n\nThe marker protocol is mandatory. Copy each BEGIN and END marker byte-for-byte, exactly once, in ascending segment order. Put only that segment's translation between its markers. Do not emit any text outside the markers.`,
    user,
    segmentIds: [...protocol.segmentIds],
    protocol,
  };
}

function consumeWhitespace(value: string, from: number): number {
  let cursor = from;
  while (cursor < value.length && /\s/u.test(value[cursor] ?? '')) {
    cursor += 1;
  }
  return cursor;
}

export function parseSegmentResponse(
  response: string,
  protocol: SegmentProtocol,
): TranslationSegment[] {
  assertNonce(protocol.nonce);
  let cursor = consumeWhitespace(response, 0);
  const translations: TranslationSegment[] = [];

  protocol.segmentIds.forEach((id, index) => {
    const begin = marker(protocol.nonce, index, 'BEGIN');
    const end = marker(protocol.nonce, index, 'END');

    if (!response.startsWith(begin, cursor)) {
      throw createTranslationError(
        'INVALID_RESPONSE',
        `模型响应缺少第 ${index + 1} 段的起始标记`,
        true,
      );
    }

    const contentStart = cursor + begin.length;
    const contentEnd = response.indexOf(end, contentStart);
    if (contentEnd < 0) {
      throw createTranslationError(
        'INVALID_RESPONSE',
        `模型响应缺少第 ${index + 1} 段的结束标记`,
        true,
      );
    }

    const content = response.slice(contentStart, contentEnd).trim();
    if (!content || content.includes(ANY_PROTOCOL_MARKER)) {
      throw createTranslationError(
        'INVALID_RESPONSE',
        `模型响应的第 ${index + 1} 段为空或包含非法标记`,
        true,
      );
    }

    translations.push({ id, text: content });
    cursor = consumeWhitespace(response, contentEnd + end.length);
  });

  if (cursor !== response.length) {
    throw createTranslationError(
      'INVALID_RESPONSE',
      '模型响应包含协议之外的额外内容或重复段落',
      true,
    );
  }

  return translations;
}

export function parseTranslationResponse(
  response: string,
  prompt: BuiltTranslationPrompt,
): TranslationSegment[] {
  if (prompt.protocol) {
    return parseSegmentResponse(response, prompt.protocol);
  }

  if (prompt.segmentIds.length !== 1 || !response.trim()) {
    throw createTranslationError(
      'INVALID_RESPONSE',
      '划词翻译响应为空或包含无法对应的多个段落',
      true,
    );
  }

  return [{ id: prompt.segmentIds[0] ?? '', text: response.trim() }];
}
