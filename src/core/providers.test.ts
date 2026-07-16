import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelProfile } from '../types/domain';
import {
  PROVIDER_HARD_TIMEOUT_MS,
  requestAnthropicMessages,
  requestOpenAIChatCompletion,
} from './providers';

function profile(patch: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: 'profile-1',
    name: 'Test',
    preset: 'openai',
    protocol: 'openai-chat',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'test-key',
    model: 'gpt-test',
    temperature: null,
    maxOutputTokens: 2048,
    timeoutMs: 30_000,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('OpenAI Chat Completions adapter', () => {
  it('uses native extension fetch semantics and max_completion_tokens', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: '你好' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(requestOpenAIChatCompletion({
      profile: profile(),
      systemPrompt: 'system',
      userPrompt: 'user',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })).resolves.toBe('你好');

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init).toMatchObject({
      method: 'POST',
    });
    expect(init).not.toHaveProperty('redirect');
    expect(init).not.toHaveProperty('cache');
    expect(init).not.toHaveProperty('referrerPolicy');
    const body = JSON.parse(String((init as RequestInit | undefined)?.body)) as Record<string, unknown>;
    expect(body.max_completion_tokens).toBe(2048);
    expect(body).not.toHaveProperty('max_tokens');
    expect(body).not.toHaveProperty('temperature');
  });

  it('maps authentication failures to a structured non-retryable error', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      error: { message: 'Invalid API key' },
    }), { status: 401, headers: { 'Content-Type': 'application/json' } }));

    await expect(requestOpenAIChatCompletion({
      profile: profile(),
      systemPrompt: 'system',
      userPrompt: 'user',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })).rejects.toMatchObject({
      payload: {
        code: 'AUTH_FAILED',
        message: 'Invalid API key',
        status: 401,
        retryable: false,
      },
    });
  });

  it('explains client-side Chrome blocking when fetch has no HTTP response', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(requestOpenAIChatCompletion({
      profile: profile({
        preset: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
      }),
      systemPrompt: 'system',
      userPrompt: 'user',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })).rejects.toMatchObject({
      payload: {
        code: 'NETWORK_ERROR',
        retryable: true,
        message: expect.stringContaining('ERR_BLOCKED_BY_CLIENT'),
      },
    });
  });

  it('aborts at the 27 second hard deadline', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>(
      (_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      },
    ));

    const request = requestOpenAIChatCompletion({
      profile: profile({ timeoutMs: 90_000 }),
      systemPrompt: 'system',
      userPrompt: 'user',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const assertion = expect(request).rejects.toMatchObject({
      payload: { code: 'TIMEOUT', retryable: true },
    });
    await vi.advanceTimersByTimeAsync(PROVIDER_HARD_TIMEOUT_MS);
    await assertion;
  });
});

describe('Anthropic Messages adapter', () => {
  it('uses DeepSeek Anthropic endpoint, max_tokens and explicit disabled thinking', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      content: [
        { type: 'text', text: '你' },
        { type: 'text', text: '好' },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(requestAnthropicMessages({
      profile: profile({
        preset: 'deepseek',
        protocol: 'anthropic-messages',
        baseUrl: 'https://api.deepseek.com/anthropic',
        model: 'deepseek-v4-flash',
      }),
      systemPrompt: 'system',
      userPrompt: 'user',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })).resolves.toBe('你好');

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.deepseek.com/anthropic/v1/messages');
    const body = JSON.parse(String((init as RequestInit | undefined)?.body)) as Record<string, unknown>;
    expect(body.max_tokens).toBe(2048);
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body).not.toHaveProperty('max_completion_tokens');
    expect((init as RequestInit | undefined)?.headers).toMatchObject({
      'x-api-key': 'test-key',
      'anthropic-version': '2023-06-01',
    });
  });

  it('rejects a successful response without text blocks', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ content: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(requestAnthropicMessages({
      profile: profile({ protocol: 'anthropic-messages' }),
      systemPrompt: 'system',
      userPrompt: 'user',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })).rejects.toMatchObject({ payload: { code: 'INVALID_RESPONSE' } });
  });
});
