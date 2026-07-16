import { describe, expect, it, vi } from 'vitest';

import type { ModelProfile } from '../types/domain';
import {
  requestAnthropicMessages,
  requestOpenAIChatCompletion,
} from './providers';

const baseProfile: ModelProfile = {
  id: 'test',
  name: 'Test',
  preset: 'openai',
  protocol: 'openai-chat',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'test-key',
  model: 'test-model',
  temperature: null,
  maxOutputTokens: 512,
  timeoutMs: 1_000,
  createdAt: 1,
  updatedAt: 1,
};

describe('provider response edge cases', () => {
  it('maps OpenAI length finishes to OUTPUT_TRUNCATED', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => (
      new Response(JSON.stringify({
        choices: [{ finish_reason: 'length', message: { content: 'partial' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    ));

    await expect(requestOpenAIChatCompletion({
      profile: baseProfile,
      systemPrompt: 'system',
      userPrompt: 'user',
      fetchImpl: fetchMock as typeof fetch,
    })).rejects.toMatchObject({ payload: { code: 'OUTPUT_TRUNCATED' } });
  });

  it('maps Anthropic max_tokens stops to OUTPUT_TRUNCATED', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => (
      new Response(JSON.stringify({
        stop_reason: 'max_tokens',
        content: [{ type: 'text', text: 'partial' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    ));

    await expect(requestAnthropicMessages({
      profile: {
        ...baseProfile,
        preset: 'deepseek',
        protocol: 'anthropic-messages',
        baseUrl: 'https://api.deepseek.com/anthropic',
      },
      systemPrompt: 'system',
      userPrompt: 'user',
      fetchImpl: fetchMock as typeof fetch,
    })).rejects.toMatchObject({ payload: { code: 'OUTPUT_TRUNCATED' } });
  });

  it('omits OpenAI-specific token fields for custom compatible services', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => (
      new Response(JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: '译文' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    ));

    await requestOpenAIChatCompletion({
      profile: {
        ...baseProfile,
        preset: 'custom',
        baseUrl: 'https://example.com/v1',
      },
      systemPrompt: 'system',
      userPrompt: 'user',
      fetchImpl: fetchMock as typeof fetch,
    });

    const call = fetchMock.mock.calls[0];
    const body = JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty('max_completion_tokens');
    expect(body).not.toHaveProperty('max_tokens');
  });
});

