import type { ProviderPreset, ProviderProtocol } from '../types/domain';

export type ProviderCategory = 'ai' | 'machine' | 'local' | 'custom';

export interface ProviderDefinition {
  preset: ProviderPreset;
  name: string;
  description: string;
  category: ProviderCategory;
  protocol: ProviderProtocol;
  baseUrl: string;
  model: string;
  requiresApiKey: boolean;
  requiresModel: boolean;
  supportsRegion?: boolean;
  editableUrl?: boolean;
}

export const PROVIDER_CATALOG: readonly ProviderDefinition[] = [
  { preset: 'builtin-ai', name: 'Chrome 内置翻译', description: 'Chrome 138+ 本地 Translator API', category: 'local', protocol: 'builtin-translator', baseUrl: 'https://localhost', model: '', requiresApiKey: false, requiresModel: false },
  { preset: 'google', name: 'Google 翻译', description: 'Google 免费翻译接口', category: 'machine', protocol: 'google-translate', baseUrl: 'https://translate.googleapis.com/translate_a/single', model: '', requiresApiKey: false, requiresModel: false },
  { preset: 'google-html', name: 'Google 网页翻译', description: 'Google Translate HTML 批量接口', category: 'machine', protocol: 'google-html', baseUrl: 'https://translate-pa.googleapis.com/v1/translateHtml', model: '', requiresApiKey: false, requiresModel: false },
  { preset: 'microsoft', name: '微软翻译', description: 'Microsoft Edge 翻译服务', category: 'machine', protocol: 'microsoft-translator', baseUrl: 'https://api-edge.cognitive.microsofttranslator.com', model: '', requiresApiKey: false, requiresModel: false },
  { preset: 'azure', name: 'Azure 翻译', description: 'Azure AI Translator', category: 'machine', protocol: 'azure-translator', baseUrl: 'https://api.cognitive.microsofttranslator.com', model: '', requiresApiKey: true, requiresModel: false, supportsRegion: true, editableUrl: true },
  { preset: 'deepseek', name: 'DeepSeek', description: 'DeepSeek 官方模型', category: 'ai', protocol: 'openai-chat', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', requiresApiKey: true, requiresModel: true },
  { preset: 'opencode-go', name: 'OpenCode Go', description: 'OpenCode Go AI 翻译订阅', category: 'ai', protocol: 'openai-chat', baseUrl: 'https://opencode.ai/zen/go/v1', model: 'deepseek-v4-flash', requiresApiKey: true, requiresModel: true },
  { preset: 'siliconflow', name: '硅基流动', description: 'SiliconFlow OpenAI 兼容接口', category: 'ai', protocol: 'openai-chat', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Pro/zai-org/GLM-4.7', requiresApiKey: true, requiresModel: true },
  { preset: 'xiaomi-mimo', name: '小米 MiMo', description: 'Xiaomi MiMo OpenAI 兼容接口', category: 'ai', protocol: 'openai-chat', baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5-pro', requiresApiKey: true, requiresModel: true },
  { preset: 'aliyun-bailian', name: '阿里云百炼', description: 'DashScope OpenAI 兼容接口', category: 'ai', protocol: 'openai-chat', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', requiresApiKey: true, requiresModel: true },
  { preset: 'cerebras', name: 'Cerebras', description: 'Cerebras 高速推理', category: 'ai', protocol: 'openai-chat', baseUrl: 'https://api.cerebras.ai/v1', model: 'gpt-oss-120b', requiresApiKey: true, requiresModel: true },
  { preset: 'zai', name: '智谱 AI', description: '智谱开放平台', category: 'ai', protocol: 'openai-chat', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.1', requiresApiKey: true, requiresModel: true },
  { preset: 'tencent', name: '腾讯翻译', description: '腾讯交互翻译接口', category: 'machine', protocol: 'tencent-translator', baseUrl: 'https://transmart.qq.com/api/imt', model: '', requiresApiKey: false, requiresModel: false },
  { preset: 'volcengine', name: '火山翻译', description: '火山翻译浏览器接口', category: 'machine', protocol: 'volcengine-translator', baseUrl: 'https://translate.volcengine.com/crx/translate/v1', model: '', requiresApiKey: false, requiresModel: false },
  { preset: 'deepl', name: 'DeepL API', description: 'DeepL 官方 API', category: 'machine', protocol: 'deepl', baseUrl: 'https://api-free.deepl.com/v2/translate', model: '', requiresApiKey: true, requiresModel: false, editableUrl: true },
  { preset: 'deepl-free', name: 'DeepL Free', description: 'DeepL 免费网页接口', category: 'machine', protocol: 'deepl-free', baseUrl: 'https://www2.deepl.com/jsonrpc', model: '', requiresApiKey: false, requiresModel: false },
  { preset: 'deeplx', name: 'DeepLX', description: '自托管 DeepLX', category: 'local', protocol: 'deeplx', baseUrl: 'http://localhost:1188', model: '', requiresApiKey: false, requiresModel: false, editableUrl: true },
  { preset: 'ephone-ai', name: 'ePhone AI', description: 'ePhone AI OpenAI 兼容接口', category: 'ai', protocol: 'openai-chat', baseUrl: 'https://api.ephone.ai/v1', model: '', requiresApiKey: true, requiresModel: true },
  { preset: 'openai', name: 'OpenAI', description: 'OpenAI 官方 API', category: 'ai', protocol: 'openai-chat', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini', requiresApiKey: true, requiresModel: true },
  { preset: 'gemini', name: 'Google Gemini', description: 'Gemini 原生 generateContent', category: 'ai', protocol: 'gemini-generate', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash', requiresApiKey: true, requiresModel: true },
  { preset: 'gemini-openai', name: 'Gemini OpenAI', description: 'Gemini OpenAI 兼容接口', category: 'ai', protocol: 'openai-chat', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash', requiresApiKey: true, requiresModel: true },
  { preset: 'claude', name: 'Anthropic Claude', description: 'Anthropic Messages API', category: 'ai', protocol: 'anthropic-messages', baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-haiku-latest', requiresApiKey: true, requiresModel: true },
  { preset: 'cloudflare-ai', name: 'Cloudflare AI', description: 'Workers AI 翻译模型', category: 'ai', protocol: 'cloudflare-ai', baseUrl: 'https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/ai/run/@cf/meta/m2m100-1.2b', model: '', requiresApiKey: true, requiresModel: false, editableUrl: true },
  { preset: 'ollama', name: 'Ollama', description: '本机或局域网 Ollama', category: 'local', protocol: 'openai-chat', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', requiresApiKey: false, requiresModel: true, editableUrl: true },
  { preset: 'openrouter', name: 'OpenRouter', description: 'OpenRouter 多模型聚合', category: 'ai', protocol: 'openai-chat', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o', requiresApiKey: true, requiresModel: true },
  { preset: 'custom', name: '自定义服务', description: 'OpenAI、Anthropic 或 JSON 接口', category: 'custom', protocol: 'openai-chat', baseUrl: 'https://', model: '', requiresApiKey: true, requiresModel: true, editableUrl: true },
] as const;

const PROVIDER_MAP = new Map(PROVIDER_CATALOG.map((provider) => [provider.preset, provider]));

export function getProviderDefinition(preset: ProviderPreset): ProviderDefinition {
  return PROVIDER_MAP.get(preset) ?? PROVIDER_CATALOG[PROVIDER_CATALOG.length - 1]!;
}

export function profileIsReady(profile: { preset: ProviderPreset; hasApiKey?: boolean; apiKey?: string; model: string; region?: string }): boolean {
  const provider = getProviderDefinition(profile.preset);
  const hasCredential = 'hasApiKey' in profile ? Boolean(profile.hasApiKey) : Boolean(profile.apiKey?.trim());
  return (!provider.requiresApiKey || hasCredential)
    && (!provider.requiresModel || Boolean(profile.model.trim()))
    && (!provider.supportsRegion || Boolean(profile.region?.trim()));
}

export function isAiProtocol(protocol: ProviderProtocol): boolean {
  return protocol === 'openai-chat' || protocol === 'anthropic-messages' || protocol === 'gemini-generate';
}
