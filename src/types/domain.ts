export type ProviderProtocol =
  | 'openai-chat'
  | 'anthropic-messages'
  | 'gemini-generate'
  | 'builtin-translator'
  | 'google-translate'
  | 'google-html'
  | 'microsoft-translator'
  | 'azure-translator'
  | 'deepl'
  | 'deepl-free'
  | 'deeplx'
  | 'tencent-translator'
  | 'volcengine-translator'
  | 'cloudflare-ai'
  | 'custom-json';

export type ProviderPreset =
  | 'builtin-ai'
  | 'google'
  | 'google-html'
  | 'microsoft'
  | 'azure'
  | 'deepseek'
  | 'opencode-go'
  | 'siliconflow'
  | 'xiaomi-mimo'
  | 'aliyun-bailian'
  | 'cerebras'
  | 'zai'
  | 'tencent'
  | 'volcengine'
  | 'deepl'
  | 'deepl-free'
  | 'deeplx'
  | 'ephone-ai'
  | 'openai'
  | 'gemini'
  | 'gemini-openai'
  | 'claude'
  | 'cloudflare-ai'
  | 'ollama'
  | 'openrouter'
  | 'custom';
export type ThemeMode = 'system' | 'light' | 'dark';
export type PageDisplayMode = 'dual' | 'translation';
export type TranslationKind = 'page' | 'selection' | 'connection-test';

export interface ModelProfile {
  id: string;
  name: string;
  preset: ProviderPreset;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  region?: string;
  temperature: number | null;
  maxOutputTokens: number;
  timeoutMs: number;
  createdAt: number;
  updatedAt: number;
}

export interface PublicModelProfile extends Omit<ModelProfile, 'apiKey'> {
  hasApiKey: boolean;
}

export interface PromptTemplate {
  pageSystem: string;
  pageUser: string;
  selectionSystem: string;
  selectionUser: string;
  revision: number;
}

export interface ExtensionSettings {
  theme: ThemeMode;
  sourceLanguage: string;
  targetLanguage: string;
  pageDisplayMode: PageDisplayMode;
  activeProfileId: string | null;
  autoTranslateHosts: string[];
  selectionButtonEnabled: boolean;
}

export interface TranslationSegment {
  id: string;
  text: string;
}

export interface TranslationRequest {
  jobId: string;
  kind: TranslationKind;
  sourceLanguage: string;
  targetLanguage: string;
  segments: TranslationSegment[];
  profileId?: string;
}

export interface TranslationResult {
  jobId: string;
  translations: TranslationSegment[];
  durationMs: number;
  model: string;
  cached: boolean;
}

export type TranslationErrorCode =
  | 'NO_PROFILE'
  | 'INVALID_PROFILE'
  | 'PERMISSION_DENIED'
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'PROVIDER_ERROR'
  | 'OUTPUT_TRUNCATED'
  | 'REFUSED'
  | 'INVALID_RESPONSE'
  | 'CANCELLED';

export interface TranslationErrorPayload {
  code: TranslationErrorCode;
  message: string;
  status?: number;
  retryable: boolean;
}

export interface PageTranslationState {
  enabled: boolean;
  mode: PageDisplayMode;
  sourceLanguage: string;
  targetLanguage: string;
  translatedCount: number;
  pendingCount: number;
  error: TranslationErrorPayload | null;
}
