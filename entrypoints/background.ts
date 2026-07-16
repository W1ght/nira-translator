import { browser } from 'wxt/browser';

import { createTranslationError, TranslationCoreError } from '../src/core/errors';
import {
  buildTranslationPrompt,
  parseTranslationResponse,
} from '../src/core/prompts';
import { normalizeProviderError, requestProviderText } from '../src/core/providers';
import { isTrustedExtensionPage } from '../src/core/runtime-auth';
import {
  createTranslationCacheKey,
  SessionLruCache,
} from '../src/core/session-cache';
import {
  deleteProfile,
  getProfile,
  getPrompts,
  getSettings,
  initializeStorage,
  listProfiles,
  resetPrompts,
  saveProfile,
  updatePrompts,
  updateSettings,
} from '../src/core/storage';
import { getProviderOriginPattern } from '../src/core/url';
import type {
  ExtensionSettings,
  PromptTemplate,
  TranslationRequest,
  TranslationResult,
  TranslationSegment,
} from '../src/types/domain';
import type { ModelProfileInput } from '../src/types/profile';

interface MessageSenderLike {
  id?: string;
  url?: string;
  tab?: { id?: number };
  frameId?: number;
  documentId?: string;
}

interface RuntimeMessage {
  type?: string;
  patch?: Partial<ExtensionSettings>;
  prompts?: PromptTemplate;
  profile?: ModelProfileInput;
  profileId?: string;
  baseUrl?: string;
  request?: TranslationRequest;
  jobId?: string;
}

let storageReady: Promise<void> = Promise.resolve();
const abortControllers = new Map<string, AbortController>();
const translationCache = new SessionLruCache<TranslationSegment[]>(browser.storage.session, {
  maxEntries: 500,
  maxBytes: 5 * 1024 * 1024,
});

export default defineBackground(() => {
  storageReady = initializeStorage();

  browser.runtime.onInstalled.addListener(() => {
    storageReady = storageReady.then(() => initializeStorage());
  });

  browser.runtime.onMessage.addListener((message, sender) => (
    handleMessage(message, sender as MessageSenderLike)
  ));

  browser.commands.onCommand.addListener((command) => {
    void handleCommand(command);
  });
});

async function handleMessage(raw: unknown, sender: MessageSenderLike): Promise<unknown> {
  if (sender.id && sender.id !== browser.runtime.id) return failure('PERMISSION_DENIED', '消息来源无效');
  if (!raw || typeof raw !== 'object') return failure('INVALID_PROFILE', '消息格式无效');
  const message = raw as RuntimeMessage;
  if (typeof message.type !== 'string') return failure('INVALID_PROFILE', '消息缺少类型');

  try {
    await storageReady;
    switch (message.type) {
      case 'settings:get':
        return { ok: true, settings: await getSettings() };
      case 'settings:update': {
        assertExtensionPage(sender);
        if (!message.patch || typeof message.patch !== 'object') {
          throw createTranslationError('INVALID_PROFILE', '设置内容无效', false);
        }
        const settings = await updateSettings(sanitizeSettingsPatch(message.patch));
        await broadcastSettings(settings);
        return { ok: true, settings };
      }
      case 'prompts:get':
        assertExtensionPage(sender);
        return { ok: true, prompts: await getPrompts() };
      case 'prompts:update':
        assertExtensionPage(sender);
        if (!isPromptTemplate(message.prompts)) {
          throw createTranslationError('INVALID_PROFILE', 'Prompt 模板格式无效', false);
        }
        return { ok: true, prompts: await updatePrompts(message.prompts) };
      case 'prompts:reset':
        assertExtensionPage(sender);
        return { ok: true, prompts: await resetPrompts() };
      case 'profiles:list':
        assertExtensionPage(sender);
        return { ok: true, profiles: await listProfiles() };
      case 'profiles:save': {
        assertExtensionPage(sender);
        if (!isProfileInput(message.profile)) {
          throw createTranslationError('INVALID_PROFILE', '模型配置格式无效', false);
        }
        const profiles = await saveProfile(message.profile);
        const settings = await getSettings();
        await broadcastSettings(settings);
        return { ok: true, profiles, settings };
      }
      case 'profiles:delete': {
        assertExtensionPage(sender);
        if (!message.profileId) throw createTranslationError('INVALID_PROFILE', '缺少配置 ID', false);
        const profiles = await deleteProfile(message.profileId);
        const settings = await getSettings();
        await broadcastSettings(settings);
        return { ok: true, profiles, settings };
      }
      case 'profiles:test': {
        assertExtensionPage(sender);
        if (!message.profileId) throw createTranslationError('INVALID_PROFILE', '缺少配置 ID', false);
        return { ok: true, ...(await testProfile(message.profileId)) };
      }
      case 'permissions:request-api': {
        assertExtensionPage(sender);
        if (!message.baseUrl) throw createTranslationError('INVALID_PROFILE', '缺少 API 地址', false);
        const origin = getProviderOriginPattern(message.baseUrl);
        const granted = await browser.permissions.request({ origins: [origin] });
        return { ok: true, granted };
      }
      case 'translate':
        assertContentScript(sender);
        if (!isTranslationRequest(message.request)) {
          throw createTranslationError('INVALID_PROFILE', '翻译请求格式无效', false);
        }
        return { ok: true, result: await translate(message.request, sender) };
      case 'translate:cancel':
        assertContentScript(sender);
        if (message.jobId) abortControllers.get(jobKey(sender, message.jobId))?.abort();
        return { ok: true };
      case 'cache:clear':
        assertExtensionPage(sender);
        await translationCache.clear();
        return { ok: true };
      default:
        return failure('INVALID_PROFILE', '不支持的消息类型');
    }
  } catch (error) {
    return { ok: false, error: normalizeProviderError(error) };
  }
}

async function translate(
  request: TranslationRequest,
  sender: MessageSenderLike,
): Promise<TranslationResult> {
  validateTranslationLimits(request);
  const [profile, prompts] = await Promise.all([
    getProfile(request.profileId),
    getPrompts(),
  ]);
  if (!profile) throw createTranslationError('NO_PROFILE', '请先选择模型配置', false);
  if (!profile.apiKey) {
    throw createTranslationError(
      'INVALID_PROFILE',
      '当前模型没有保存 API Key。请在设置中输入密钥并点击“保存配置”',
      false,
    );
  }

  const cacheKey = await createTranslationCacheKey({
    profileId: `${profile.id}:${profile.updatedAt}`,
    model: profile.model,
    promptRevision: prompts.revision,
    kind: request.kind,
    sourceLanguage: request.sourceLanguage,
    targetLanguage: request.targetLanguage,
    segments: request.segments,
  });
  const cached = await translationCache.get(cacheKey);
  if (cached) {
    return {
      jobId: request.jobId,
      translations: cached,
      durationMs: 0,
      model: profile.model,
      cached: true,
    };
  }

  const controller = new AbortController();
  const key = jobKey(sender, request.jobId);
  abortControllers.set(key, controller);
  const startedAt = performance.now();
  try {
    const translations = await translateWithFallback(request, prompts, profile, controller.signal);
    await translationCache.set(cacheKey, translations);
    return {
      jobId: request.jobId,
      translations,
      durationMs: Math.round(performance.now() - startedAt),
      model: profile.model,
      cached: false,
    };
  } finally {
    abortControllers.delete(key);
  }
}

async function translateWithFallback(
  request: TranslationRequest,
  prompts: PromptTemplate,
  profile: NonNullable<Awaited<ReturnType<typeof getProfile>>>,
  signal: AbortSignal,
): Promise<TranslationSegment[]> {
  try {
    return await performProviderTranslation(request, prompts, profile, signal);
  } catch (error) {
    const invalidBatch = error instanceof TranslationCoreError
      && error.payload.code === 'INVALID_RESPONSE'
      && request.kind === 'page'
      && request.segments.length > 1;
    if (!invalidBatch) throw error;

    const results: TranslationSegment[] = [];
    for (const segment of request.segments) {
      const single = await performProviderTranslation(
        { ...request, jobId: `${request.jobId}:${segment.id}`, segments: [segment] },
        prompts,
        profile,
        signal,
      );
      results.push(...single);
    }
    return results;
  }
}

async function performProviderTranslation(
  request: TranslationRequest,
  prompts: PromptTemplate,
  profile: NonNullable<Awaited<ReturnType<typeof getProfile>>>,
  signal: AbortSignal,
): Promise<TranslationSegment[]> {
  const built = buildTranslationPrompt(prompts, request);
  const response = await requestProviderText({
    profile,
    systemPrompt: built.system,
    userPrompt: built.user,
    signal,
  });
  return parseTranslationResponse(response, built);
}

async function testProfile(profileId: string): Promise<{
  durationMs: number;
  output: string;
  actualModel: string;
}> {
  const profile = await getProfile(profileId);
  if (!profile) throw createTranslationError('NO_PROFILE', '找不到模型配置', false);
  const startedAt = performance.now();
  const output = await requestProviderText({
    profile,
    systemPrompt: 'You are a translation API connection test. Return only the translation.',
    userPrompt: 'Translate “hello” to Simplified Chinese.',
  });
  return {
    durationMs: Math.round(performance.now() - startedAt),
    output: output.slice(0, 120),
    actualModel: profile.model,
  };
}

function validateTranslationLimits(request: TranslationRequest): void {
  const maxSegments = request.kind === 'selection' ? 1 : 4;
  const maxCharacters = request.kind === 'selection' ? 16_000 : 4_000;
  const total = request.segments.reduce((sum, segment) => sum + segment.text.length, 0);
  if (request.segments.length < 1 || request.segments.length > maxSegments || total > maxCharacters) {
    throw createTranslationError('INVALID_PROFILE', '翻译内容超出单次请求限制', false);
  }
}

function assertContentScript(sender: MessageSenderLike): void {
  if (!sender.tab?.id || sender.frameId !== 0) {
    throw createTranslationError('PERMISSION_DENIED', '此操作只允许当前网页的主框架调用', false);
  }
}

function assertExtensionPage(sender: MessageSenderLike): void {
  const prefix = browser.runtime.getURL('');
  if (!isTrustedExtensionPage(sender, prefix, browser.runtime.id)) {
    throw createTranslationError('PERMISSION_DENIED', '此操作只允许扩展页面调用', false);
  }
}

function jobKey(sender: MessageSenderLike, jobId: string): string {
  return `${sender.tab?.id ?? 'extension'}:${sender.documentId ?? 'document'}:${jobId}`;
}

function isTranslationRequest(value: unknown): value is TranslationRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<TranslationRequest>;
  return typeof request.jobId === 'string'
    && ['page', 'selection', 'connection-test'].includes(request.kind ?? '')
    && typeof request.sourceLanguage === 'string'
    && typeof request.targetLanguage === 'string'
    && Array.isArray(request.segments)
    && request.segments.every((segment) => (
      segment
      && typeof segment.id === 'string'
      && typeof segment.text === 'string'
    ));
}

function isPromptTemplate(value: unknown): value is PromptTemplate {
  if (!value || typeof value !== 'object') return false;
  const prompt = value as Partial<PromptTemplate>;
  return typeof prompt.pageSystem === 'string'
    && typeof prompt.pageUser === 'string'
    && typeof prompt.selectionSystem === 'string'
    && typeof prompt.selectionUser === 'string'
    && typeof prompt.revision === 'number';
}

function isProfileInput(value: unknown): value is ModelProfileInput {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Partial<ModelProfileInput>;
  return typeof profile.id === 'string'
    && typeof profile.name === 'string'
    && ['openai', 'deepseek', 'custom'].includes(profile.preset ?? '')
    && ['openai-chat', 'anthropic-messages'].includes(profile.protocol ?? '')
    && typeof profile.baseUrl === 'string'
    && typeof profile.model === 'string'
    && ['keep', 'replace', 'clear'].includes(profile.credentialAction ?? '');
}

function sanitizeSettingsPatch(patch: Partial<ExtensionSettings>): Partial<ExtensionSettings> {
  const result: Partial<ExtensionSettings> = {};
  const theme = patch.theme;
  if (theme && ['system', 'light', 'dark'].includes(theme)) result.theme = theme;
  if (typeof patch.sourceLanguage === 'string') result.sourceLanguage = patch.sourceLanguage;
  if (typeof patch.targetLanguage === 'string') result.targetLanguage = patch.targetLanguage;
  const displayMode = patch.pageDisplayMode;
  if (displayMode && ['dual', 'translation'].includes(displayMode)) {
    result.pageDisplayMode = displayMode;
  }
  if (typeof patch.activeProfileId === 'string' || patch.activeProfileId === null) {
    result.activeProfileId = patch.activeProfileId;
  }
  if (Array.isArray(patch.autoTranslateHosts)) {
    result.autoTranslateHosts = patch.autoTranslateHosts
      .filter((host): host is string => typeof host === 'string')
      .slice(0, 500);
  }
  if (typeof patch.selectionButtonEnabled === 'boolean') {
    result.selectionButtonEnabled = patch.selectionButtonEnabled;
  }
  return result;
}

async function broadcastSettings(settings: ExtensionSettings): Promise<void> {
  const tabs = await browser.tabs.query({});
  await Promise.allSettled(tabs
    .filter((tab) => tab.id != null)
    .map((tab) => browser.tabs.sendMessage(tab.id!, { type: 'settings:changed', settings })));
}

async function handleCommand(command: string): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) return;
  if (command === 'toggle-page-translation') {
    await browser.tabs.sendMessage(tab.id, { type: 'page:toggle' }).catch(() => undefined);
  } else if (command === 'translate-selection') {
    await browser.tabs.sendMessage(tab.id, { type: 'selection:translate-current' }).catch(() => undefined);
  }
}

function failure(code: 'INVALID_PROFILE' | 'PERMISSION_DENIED', message: string) {
  return { ok: false, error: { code, message, retryable: false } };
}

