import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_PROFILES } from '../constants/defaults';
import type { ModelProfile } from '../types/domain';
import { requestDirectTranslations } from './direct-providers';

function profile(preset: ModelProfile['preset']): ModelProfile {
  return structuredClone(DEFAULT_PROFILES.find((item) => item.preset === preset)!);
}

describe('direct translation providers', () => {
  it('maps Google responses back to the original segment ids', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ sentences: [{ trans: '你好' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sentences: [{ trans: '世界' }] }), { status: 200 }));
    const result = await requestDirectTranslations({
      profile: profile('google'),
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      segments: [{ id: 'a', text: 'hello' }, { id: 'b', text: 'world' }],
      fetchImpl,
    });
    expect(result).toEqual([{ id: 'a', text: '你好' }, { id: 'b', text: '世界' }]);
    expect(new URL(fetchImpl.mock.calls[0]![0] as string).searchParams.get('q')).toBe('hello');
  });

  it('uses DeepL official batch format and auth header', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      translations: [{ text: '你好' }, { text: '世界' }],
    }), { status: 200 }));
    await requestDirectTranslations({
      profile: { ...profile('deepl'), apiKey: 'deepl-key' },
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      segments: [{ id: 'a', text: 'hello' }, { id: 'b', text: 'world' }],
      fetchImpl,
    });
    const [, init] = fetchImpl.mock.calls[0]!;
    expect((init?.headers as Record<string, string>).Authorization).toBe('DeepL-Auth-Key deepl-key');
    expect(JSON.parse(String(init?.body))).toMatchObject({ text: ['hello', 'world'], source_lang: 'EN', target_lang: 'ZH' });
  });

  it('maps Chinese language codes for Azure Translator', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([
      { translations: [{ text: '你好' }] },
    ]), { status: 200 }));
    await requestDirectTranslations({
      profile: { ...profile('azure'), apiKey: 'azure-key', region: 'eastasia' },
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      segments: [{ id: 'a', text: 'hello' }],
      fetchImpl,
    });
    const url = new URL(fetchImpl.mock.calls[0]![0] as string);
    expect(url.searchParams.get('from')).toBe('en');
    expect(url.searchParams.get('to')).toBe('zh-Hans');
  });

  it('maps DeepLX and Volcengine target language codes', async () => {
    const deeplxFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: '你好' }), { status: 200 }));
    await requestDirectTranslations({
      profile: profile('deeplx'),
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      segments: [{ id: 'a', text: 'hello' }],
      fetchImpl: deeplxFetch,
    });
    expect(JSON.parse(String(deeplxFetch.mock.calls[0]![1]?.body))).toMatchObject({ source_lang: 'EN', target_lang: 'ZH' });

    const volcengineFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ translation: '你好' }), { status: 200 }));
    await requestDirectTranslations({
      profile: profile('volcengine'),
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      segments: [{ id: 'a', text: 'hello' }],
      fetchImpl: volcengineFetch,
    });
    expect(JSON.parse(String(volcengineFetch.mock.calls[0]![1]?.body))).toMatchObject({ source_language: 'en', target_language: 'zh' });
  });

  it('accepts the documented custom JSON batch response', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      translations: [{ text: '一' }, { text: '二' }],
    }), { status: 200 }));
    const result = await requestDirectTranslations({
      profile: { ...profile('custom'), protocol: 'custom-json', baseUrl: 'https://translator.example/api', apiKey: 'token', model: '' },
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      segments: [{ id: '1', text: 'one' }, { id: '2', text: 'two' }],
      fetchImpl,
    });
    expect(result.map((item) => item.text)).toEqual(['一', '二']);
  });
});
