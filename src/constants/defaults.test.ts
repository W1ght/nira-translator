import { describe, expect, it } from 'vitest';

import { DEFAULT_PROFILES, DEFAULT_SETTINGS } from './defaults';

describe('default provider profiles', () => {
  it('shows the page translation floating ball by default', () => {
    expect(DEFAULT_SETTINGS.pageFloatingBallEnabled).toBe(true);
  });

  it('defines separate page and selection model slots', () => {
    expect(DEFAULT_SETTINGS.activeProfileId).toBeTruthy();
    expect(DEFAULT_SETTINGS.selectionProfileId).toBeTruthy();
  });

  it('uses DeepSeek official OpenAI-compatible defaults', () => {
    const deepseek = DEFAULT_PROFILES.find((profile) => profile.preset === 'deepseek');
    expect(deepseek).toMatchObject({
      protocol: 'openai-chat',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
    });
  });
});
