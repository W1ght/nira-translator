import { describe, expect, it } from 'vitest';
import {
  buildProviderEndpoint,
  getProviderOriginPattern,
  validateProviderBaseUrl,
} from './url';

describe('provider URL handling', () => {
  it('appends OpenAI and Anthropic endpoints exactly once', () => {
    expect(buildProviderEndpoint('https://api.openai.com/v1', 'openai-chat'))
      .toBe('https://api.openai.com/v1/chat/completions');
    expect(buildProviderEndpoint('https://api.openai.com/v1/chat/completions', 'openai-chat'))
      .toBe('https://api.openai.com/v1/chat/completions');
    expect(buildProviderEndpoint('https://api.deepseek.com/anthropic/', 'anthropic-messages'))
      .toBe('https://api.deepseek.com/anthropic/v1/messages');
  });

  it('derives a permission pattern from the validated origin', () => {
    expect(getProviderOriginPattern('https://gateway.example.com/api/v1'))
      .toBe('https://gateway.example.com/*');
  });

  it('rejects credentials, queries, unsafe protocols and remote HTTP', () => {
    expect(() => validateProviderBaseUrl('https://user:secret@example.com/v1')).toThrow(/用户名/);
    expect(() => validateProviderBaseUrl('https://example.com/v1?token=secret')).toThrow(/查询参数/);
    expect(() => validateProviderBaseUrl('javascript:alert(1)')).toThrow(/HTTPS/);
    expect(() => validateProviderBaseUrl('http://example.com/v1')).toThrow(/必须使用 HTTPS/);
  });

  it('allows loopback HTTP for local model gateways', () => {
    expect(validateProviderBaseUrl('http://127.0.0.1:11434/v1').origin)
      .toBe('http://127.0.0.1:11434');
    expect(validateProviderBaseUrl('http://localhost:8080/v1').origin)
      .toBe('http://localhost:8080');
  });
});
