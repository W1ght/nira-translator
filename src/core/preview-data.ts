import { DEFAULT_PROMPTS, DEFAULT_SETTINGS } from '../constants/defaults';
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
};

export const PREVIEW_PROFILES: PublicModelProfile[] = [
  {
    id: 'openai-default',
    name: 'OpenAI',
    preset: 'openai',
    protocol: 'openai-chat',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5-mini',
    temperature: null,
    maxOutputTokens: 4096,
    timeoutMs: 27_000,
    createdAt: now,
    updatedAt: now,
    hasApiKey: true,
  },
  {
    id: 'deepseek-default',
    name: 'DeepSeek',
    preset: 'deepseek',
    protocol: 'openai-chat',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    temperature: null,
    maxOutputTokens: 4096,
    timeoutMs: 27_000,
    createdAt: now,
    updatedAt: now,
    hasApiKey: true,
  },
];

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

