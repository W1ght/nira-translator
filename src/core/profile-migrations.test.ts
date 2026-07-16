import { describe, expect, it } from 'vitest';

import { migrateDeepSeekProfiles } from './profile-migrations';

describe('DeepSeek profile migration', () => {
  it('moves old forced Anthropic profiles to the official OpenAI endpoint', () => {
    expect(migrateDeepSeekProfiles([{
      preset: 'deepseek' as const,
      protocol: 'anthropic-messages' as const,
      baseUrl: 'https://api.deepseek.com/anthropic',
      model: 'deepseek-v4-flash',
      id: 'deepseek-default',
    }])).toEqual([{
      preset: 'deepseek',
      protocol: 'openai-chat',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      id: 'deepseek-default',
    }]);
  });

  it('upgrades legacy model aliases while preserving unrelated profiles', () => {
    const openai = {
      preset: 'openai' as const,
      protocol: 'openai-chat' as const,
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-test',
    };
    const result = migrateDeepSeekProfiles([
      openai,
      {
        preset: 'deepseek' as const,
        protocol: 'anthropic-messages' as const,
        baseUrl: 'https://api.deepseek.com/anthropic',
        model: 'deepseek-chat',
      },
    ]);
    expect(result[0]).toBe(openai);
    expect(result[1]?.model).toBe('deepseek-v4-flash');
  });
});
