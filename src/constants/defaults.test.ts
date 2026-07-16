import { describe, expect, it } from 'vitest';

import { DEFAULT_PROFILES } from './defaults';

describe('default provider profiles', () => {
  it('uses DeepSeek official OpenAI-compatible defaults', () => {
    const deepseek = DEFAULT_PROFILES.find((profile) => profile.preset === 'deepseek');
    expect(deepseek).toMatchObject({
      protocol: 'openai-chat',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
    });
  });
});
