import type { ExtensionSettings, ModelProfile, PromptTemplate } from '../types/domain';
import { PROVIDER_CATALOG } from './providers';

export const DEFAULT_SETTINGS: ExtensionSettings = {
  theme: 'system',
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  pageDisplayMode: 'dual',
  activeProfileId: 'openai-default',
  autoTranslateHosts: [],
  selectionButtonEnabled: true,
};

export const DEFAULT_PROMPTS: PromptTemplate = {
  pageSystem: `You are a professional {{targetLanguage}} native translator. Translate the provided content fluently into {{targetLanguage}}.

Rules:
1. Output translated content only. Never add explanations or labels.
2. Preserve meaning, tone, numbers, proper nouns, code, and protected placeholder tokens.
3. Preserve every segment marker exactly once and in the original order.
4. Keep inline placeholder tokens unchanged and correctly nested.`,
  pageUser: 'Translate from {{sourceLanguage}} to {{targetLanguage}}:\n\n{{text}}',
  selectionSystem: `You are a precise translation engine. Translate into {{targetLanguage}}.
Return only the translation. Preserve proper nouns, code, numbers, and formatting.`,
  selectionUser: 'Translate from {{sourceLanguage}} to {{targetLanguage}}:\n\n{{text}}',
  revision: 1,
};

const now = Date.now();

export const DEFAULT_PROFILES: ModelProfile[] = PROVIDER_CATALOG.map((provider) => ({
  id: `${provider.preset}-default`,
  name: provider.name,
  preset: provider.preset,
  protocol: provider.protocol,
  baseUrl: provider.baseUrl,
  apiKey: '',
  model: provider.model,
  region: '',
  temperature: null,
  maxOutputTokens: 4096,
  timeoutMs: 27_000,
  createdAt: now,
  updatedAt: now,
}));
