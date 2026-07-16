import { describe, expect, it, vi } from 'vitest';

import type { ModelProfile } from '../types/domain';
import { requestOpenAIChatCompletion } from './providers';

const deepSeekProfile: ModelProfile = {
  id: 'deepseek-default',
  name: 'DeepSeek',
  preset: 'deepseek',
  protocol: 'openai-chat',
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'sk-test-not-a-real-secret',
  model: 'deepseek-v4-flash',
  temperature: null,
  maxOutputTokens: 4096,
  timeoutMs: 27_000,
  createdAt: 1,
  updatedAt: 1,
};

describe('DeepSeek OpenAI-compatible adapter', () => {
  it('uses the official endpoint, Bearer auth, max_tokens and disabled thinking', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: '你好' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(requestOpenAIChatCompletion({
      profile: deepSeekProfile,
      systemPrompt: 'system',
      userPrompt: 'user',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })).resolves.toBe('你好');

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect((init as RequestInit | undefined)?.headers).toMatchObject({
      Authorization: 'Bearer sk-test-not-a-real-secret',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(String((init as RequestInit | undefined)?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'deepseek-v4-flash',
      max_tokens: 4096,
      stream: false,
      thinking: { type: 'disabled' },
    });
    expect(body).not.toHaveProperty('max_completion_tokens');
  });

  it('reports insufficient balance with the provider response intact', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      error: { message: 'Insufficient Balance' },
    }), { status: 402, headers: { 'Content-Type': 'application/json' } }));

    await expect(requestOpenAIChatCompletion({
      profile: deepSeekProfile,
      systemPrompt: 'system',
      userPrompt: 'user',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })).rejects.toMatchObject({
      payload: {
        code: 'PROVIDER_ERROR',
        message: 'Insufficient Balance',
        status: 402,
        retryable: false,
      },
    });
  });
});
