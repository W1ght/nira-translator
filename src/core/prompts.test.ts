import { describe, expect, it } from 'vitest';
import { DEFAULT_PROMPTS } from '../constants/defaults';
import type { TranslationRequest } from '../types/domain';
import {
  buildTranslationPrompt,
  createSegmentProtocol,
  parseSegmentResponse,
  parseTranslationResponse,
  renderPromptTemplate,
} from './prompts';

const NONCE = '0123456789abcdef0123456789abcdef';

describe('prompt rendering', () => {
  it('renders the supported variables and rejects unknown ones', () => {
    expect(renderPromptTemplate('{{sourceLanguage}} -> {{targetLanguage}}: {{text}}', {
      sourceLanguage: 'English',
      targetLanguage: 'Chinese',
      text: 'Hello',
    })).toBe('English -> Chinese: Hello');

    expect(() => renderPromptTemplate('{{unknown}}', {
      sourceLanguage: 'English',
      targetLanguage: 'Chinese',
      text: 'Hello',
    })).toThrow(/Unknown prompt variable/);
  });
});

describe('nonce segment protocol', () => {
  const segments = [
    { id: 'first', text: 'Hello' },
    { id: 'second', text: 'World' },
  ];

  it('serializes and strictly parses segments in order', () => {
    const protocol = createSegmentProtocol(segments, NONCE);
    const response = [
      `<<<LIUYI:${NONCE}:SEGMENT:0:BEGIN>>>`,
      '你好',
      `<<<LIUYI:${NONCE}:SEGMENT:0:END>>>`,
      `<<<LIUYI:${NONCE}:SEGMENT:1:BEGIN>>>`,
      '世界',
      `<<<LIUYI:${NONCE}:SEGMENT:1:END>>>`,
    ].join('\n');

    expect(parseSegmentResponse(response, protocol)).toEqual([
      { id: 'first', text: '你好' },
      { id: 'second', text: '世界' },
    ]);
  });

  it('rejects reordered, duplicated, empty, or out-of-protocol output', () => {
    const protocol = createSegmentProtocol(segments, NONCE);
    const secondFirst = [
      `<<<LIUYI:${NONCE}:SEGMENT:1:BEGIN>>>世界<<<LIUYI:${NONCE}:SEGMENT:1:END>>>`,
      `<<<LIUYI:${NONCE}:SEGMENT:0:BEGIN>>>你好<<<LIUYI:${NONCE}:SEGMENT:0:END>>>`,
    ].join('\n');
    const emptyFirst = [
      `<<<LIUYI:${NONCE}:SEGMENT:0:BEGIN>>><<<LIUYI:${NONCE}:SEGMENT:0:END>>>`,
      `<<<LIUYI:${NONCE}:SEGMENT:1:BEGIN>>>世界<<<LIUYI:${NONCE}:SEGMENT:1:END>>>`,
    ].join('\n');

    expect(() => parseSegmentResponse(secondFirst, protocol)).toThrow(/起始标记/);
    expect(() => parseSegmentResponse(emptyFirst, protocol)).toThrow(/为空或包含非法标记/);
    expect(() => parseSegmentResponse(`${protocol.serializedText}\nextra`, protocol)).toThrow();
  });

  it('rejects duplicate source IDs and nonce collisions', () => {
    expect(() => createSegmentProtocol([
      { id: 'same', text: 'one' },
      { id: 'same', text: 'two' },
    ], NONCE)).toThrow(/unique/);

    expect(() => createSegmentProtocol([{
      id: 'x',
      text: `<<<LIUYI:${NONCE}:SEGMENT:0:BEGIN>>>`,
    }], NONCE)).toThrow(/collides/);
  });
});

describe('translation prompt assembly', () => {
  it('locks the page protocol and maps the parsed result back to segment IDs', () => {
    const request: TranslationRequest = {
      jobId: 'job-1',
      kind: 'page',
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      segments: [{ id: 'node-4', text: 'Settings' }],
    };
    const prompt = buildTranslationPrompt(DEFAULT_PROMPTS, request, NONCE);
    expect(prompt.system).toContain('marker protocol is mandatory');
    expect(prompt.user).toContain(`<<<LIUYI:${NONCE}:SEGMENT:0:BEGIN>>>`);

    expect(parseTranslationResponse([
      `<<<LIUYI:${NONCE}:SEGMENT:0:BEGIN>>>`,
      '设置',
      `<<<LIUYI:${NONCE}:SEGMENT:0:END>>>`,
    ].join('\n'), prompt)).toEqual([{ id: 'node-4', text: '设置' }]);
  });

  it('accepts one plain-text selection response only', () => {
    const request: TranslationRequest = {
      jobId: 'job-2',
      kind: 'selection',
      sourceLanguage: 'auto',
      targetLanguage: 'zh-CN',
      segments: [{ id: 'selection', text: 'Hello' }],
    };
    const prompt = buildTranslationPrompt(DEFAULT_PROMPTS, request);
    expect(parseTranslationResponse('  你好  ', prompt)).toEqual([
      { id: 'selection', text: '你好' },
    ]);
  });
});
