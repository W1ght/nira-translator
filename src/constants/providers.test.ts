import { describe, expect, it } from 'vitest';

import { DEFAULT_PROFILES } from './defaults';
import { profileIsReady, PROVIDER_CATALOG } from './providers';

describe('provider catalog', () => {
  it('matches every translation service type exposed by KISS Translator', () => {
    expect(PROVIDER_CATALOG.map((provider) => provider.preset)).toEqual([
      'builtin-ai', 'google', 'google-html', 'microsoft', 'azure', 'deepseek',
      'opencode-go', 'siliconflow', 'xiaomi-mimo', 'aliyun-bailian', 'cerebras',
      'zai', 'tencent', 'volcengine', 'deepl', 'deepl-free', 'deeplx', 'ephone-ai',
      'openai', 'gemini', 'gemini-openai', 'claude', 'cloudflare-ai', 'ollama',
      'openrouter', 'custom',
    ]);
    expect(DEFAULT_PROFILES).toHaveLength(PROVIDER_CATALOG.length);
  });

  it('allows keyless providers to become ready without a fake credential', () => {
    const google = DEFAULT_PROFILES.find((profile) => profile.preset === 'google')!;
    const openai = DEFAULT_PROFILES.find((profile) => profile.preset === 'openai')!;
    expect(profileIsReady(google)).toBe(true);
    expect(profileIsReady(openai)).toBe(false);
    expect(profileIsReady({ ...openai, apiKey: 'sk-test' })).toBe(true);
  });
});
