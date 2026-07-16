import type { ProviderPreset, ProviderProtocol } from '../types/domain';

export const DEEPSEEK_OPENAI_MIGRATION_VERSION = 2;

interface MigratableProfile {
  preset: ProviderPreset;
  protocol: ProviderProtocol;
  baseUrl: string;
  model: string;
}

/**
 * Older releases forced every DeepSeek preset through the Anthropic-compatible
 * endpoint. DeepSeek's primary OpenAI-compatible endpoint is a better default
 * for a browser extension, while the Anthropic option remains available in UI.
 */
export function migrateDeepSeekProfiles<T extends MigratableProfile>(
  profiles: readonly T[],
): T[] {
  return profiles.map((profile) => {
    if (profile.preset !== 'deepseek') return profile;
    const legacyModel = profile.model === 'deepseek-chat'
      || profile.model === 'deepseek-reasoner'
      || !profile.model.trim();
    return {
      ...profile,
      protocol: 'openai-chat',
      baseUrl: 'https://api.deepseek.com',
      model: legacyModel ? 'deepseek-v4-flash' : profile.model,
    };
  });
}
