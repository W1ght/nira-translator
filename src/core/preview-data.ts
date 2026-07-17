import { DEFAULT_PROFILES, DEFAULT_PROMPTS, DEFAULT_SETTINGS } from '../constants/defaults';
import { getProviderDefinition } from '../constants/providers';
import type {
  ExtensionSettings,
  PageTranslationState,
  PromptTemplate,
  PublicModelProfile,
} from '../types/domain';

const now = Date.now();

export const PREVIEW_SETTINGS: ExtensionSettings = {
  ...DEFAULT_SETTINGS,
  activeProfileId: 'deepseek-default',
  selectionProfileId: 'openai-default',
};

export const PREVIEW_PROFILES: PublicModelProfile[] = DEFAULT_PROFILES.map((profile) => ({
  ...profile,
  model: profile.model || (getProviderDefinition(profile.preset).requiresModel ? '选择模型' : ''),
  createdAt: now,
  updatedAt: now,
  hasApiKey: profile.preset === 'openai' || profile.preset === 'deepseek',
}));

export const PREVIEW_PROMPTS: PromptTemplate = { ...DEFAULT_PROMPTS };

export const PREVIEW_PAGE_STATE: PageTranslationState = {
  enabled: true,
  mode: 'dual',
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  translatedCount: 14,
  pendingCount: 2,
  error: null,
};

export function isBrowserPreview(): boolean {
  return location.protocol.startsWith('http')
    && new URLSearchParams(location.search).has('preview');
}
