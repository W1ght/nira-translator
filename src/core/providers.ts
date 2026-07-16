import type { ModelProfile, TranslationErrorPayload } from '../types/domain';
import {
  createTranslationError,
  isAbortError,
  toTranslationErrorPayload,
  TranslationCoreError,
} from './errors';
import { buildProviderEndpoint, UnsafeProviderUrlError } from './url';

export const PROVIDER_HARD_TIMEOUT_MS = 27_000;

export interface ProviderTextRequest {
  profile: ModelProfile;
  systemPrompt: string;
  userPrompt: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

interface RequestContext {
  profile: ModelProfile;
  endpoint: string;
  signal?: AbortSignal;
  fetchImpl: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getNestedString(
  value: unknown,
  path: readonly string[],
): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return typeof current === 'string' ? current : undefined;
}

function validateProfile(profile: ModelProfile): void {
  if (!profile.apiKey.trim()) {
    throw createTranslationError('INVALID_PROFILE', '请先填写 API Key', false);
  }
  if (!profile.model.trim()) {
    throw createTranslationError('INVALID_PROFILE', '请先填写模型名称', false);
  }
  if (!Number.isInteger(profile.maxOutputTokens) || profile.maxOutputTokens <= 0) {
    throw createTranslationError('INVALID_PROFILE', '最大输出 Token 配置无效', false);
  }
  if (
    profile.temperature !== null
    && (!Number.isFinite(profile.temperature) || profile.temperature < 0 || profile.temperature > 2)
  ) {
    throw createTranslationError('INVALID_PROFILE', 'Temperature 必须在 0 到 2 之间', false);
  }
}

function resolveTimeout(profile: ModelProfile): number {
  if (!Number.isFinite(profile.timeoutMs) || profile.timeoutMs <= 0) {
    return PROVIDER_HARD_TIMEOUT_MS;
  }
  return Math.min(Math.floor(profile.timeoutMs), PROVIDER_HARD_TIMEOUT_MS);
}

async function readProviderError(response: Response): Promise<string> {
  try {
    const json: unknown = await response.clone().json();
    const message = getNestedString(json, ['error', 'message'])
      ?? getNestedString(json, ['message']);
    if (message) {
      return message.slice(0, 300);
    }
  } catch {
    // Fall through to a non-sensitive status-only message.
  }
  return `服务商返回 HTTP ${response.status}`;
}

function errorForStatus(status: number, message: string): TranslationCoreError {
  if (status === 401 || status === 403) {
    return createTranslationError('AUTH_FAILED', message || 'API Key 验证失败', false, status);
  }
  if (status === 402) {
    return createTranslationError('PROVIDER_ERROR', message || '账户余额不足，请充值后重试', false, status);
  }
  if (status === 422) {
    return createTranslationError('INVALID_PROFILE', message || '服务商无法处理当前参数', false, status);
  }
  if (status === 429) {
    return createTranslationError('RATE_LIMITED', message || '请求过于频繁', true, status);
  }
  if (status === 503) {
    return createTranslationError('PROVIDER_ERROR', message || '翻译服务暂时繁忙', true, status);
  }
  if (status === 408 || status === 504) {
    return createTranslationError('TIMEOUT', message || '翻译服务响应超时', true, status);
  }
  return createTranslationError(
    'PROVIDER_ERROR',
    message || `翻译服务返回 HTTP ${status}`,
    status >= 500,
    status,
  );
}

async function fetchWithDeadline(
  context: RequestContext,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  let cancelled = false;
  const onExternalAbort = (): void => {
    cancelled = true;
    controller.abort(context.signal?.reason);
  };

  if (context.signal?.aborted) {
    throw createTranslationError('CANCELLED', '翻译已取消', false);
  }
  context.signal?.addEventListener('abort', onExternalAbort, { once: true });

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('Provider request timed out', 'AbortError'));
  }, resolveTimeout(context.profile));

  try {
    // Keep this request intentionally close to the native fetch used by
    // Kiss Translator. Chrome's extension service worker owns the cross-origin
    // request; adding redirect/cache/referrer restrictions here can turn a
    // provider or proxy response into an opaque TypeError before any HTTP
    // status is observable.
    return await context.fetchImpl(context.endpoint, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) {
      throw createTranslationError('TIMEOUT', '翻译服务在 27 秒内未响应', true);
    }
    if (cancelled || context.signal?.aborted) {
      throw createTranslationError('CANCELLED', '翻译已取消', false);
    }
    if (isAbortError(error)) {
      throw createTranslationError('TIMEOUT', '翻译请求被中止', true);
    }
    const hostname = new URL(context.endpoint).hostname;
    throw createTranslationError(
      'NETWORK_ERROR',
      `无法连接 ${hostname}：请求未获得 HTTP 响应。请检查网络、代理或扩展权限，并确认已重新加载扩展`,
      true,
    );
  } finally {
    clearTimeout(timeoutId);
    context.signal?.removeEventListener('abort', onExternalAbort);
  }
}

function createContext(request: ProviderTextRequest): RequestContext {
  validateProfile(request.profile);

  let endpoint: string;
  try {
    endpoint = buildProviderEndpoint(request.profile.baseUrl, request.profile.protocol);
  } catch (error) {
    if (error instanceof UnsafeProviderUrlError) {
      throw createTranslationError('INVALID_PROFILE', error.message, false);
    }
    throw error;
  }

  const context: RequestContext = {
    profile: request.profile,
    endpoint,
    fetchImpl: request.fetchImpl ?? fetch,
  };
  if (request.signal) {
    context.signal = request.signal;
  }
  return context;
}

export async function requestOpenAIChatCompletion(
  request: ProviderTextRequest,
): Promise<string> {
  const context = createContext(request);
  const body: Record<string, unknown> = {
    model: request.profile.model.trim(),
    messages: [
      { role: 'system', content: request.systemPrompt },
      { role: 'user', content: request.userPrompt },
    ],
    stream: false,
  };
  if (request.profile.preset === 'openai') {
    body.max_completion_tokens = request.profile.maxOutputTokens;
  } else if (request.profile.preset === 'deepseek') {
    body.max_tokens = request.profile.maxOutputTokens;
    body.thinking = { type: 'disabled' };
  }
  if (request.profile.temperature !== null) {
    body.temperature = request.profile.temperature;
  }

  const response = await fetchWithDeadline(context, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${request.profile.apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw errorForStatus(response.status, await readProviderError(response));
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw createTranslationError('INVALID_RESPONSE', 'OpenAI 响应不是有效的 JSON', true);
  }

  const providerName = request.profile.preset === 'deepseek' ? 'DeepSeek' : 'OpenAI';
  const choices = isRecord(json) ? json.choices : undefined;
  const firstChoice = Array.isArray(choices) ? choices[0] : undefined;
  const finishReason = getNestedString(firstChoice, ['finish_reason']);
  const refusal = getNestedString(firstChoice, ['message', 'refusal']);
  if (finishReason === 'length') {
    throw createTranslationError('OUTPUT_TRUNCATED', `${providerName} 输出达到长度上限，请缩短内容后重试`, true);
  }
  if (finishReason === 'content_filter' || refusal) {
    throw createTranslationError('REFUSED', `${providerName} 拒绝了这次翻译请求`, false);
  }
  if (finishReason === 'insufficient_system_resource') {
    throw createTranslationError('PROVIDER_ERROR', `${providerName} 推理资源暂时不足，请稍后重试`, true, 503);
  }
  const content = getNestedString(firstChoice, ['message', 'content']);
  if (!content?.trim()) {
    throw createTranslationError('INVALID_RESPONSE', `${providerName} 响应缺少翻译文本`, true);
  }
  return content;
}

export async function requestAnthropicMessages(
  request: ProviderTextRequest,
): Promise<string> {
  const context = createContext(request);
  const body: Record<string, unknown> = {
    model: request.profile.model.trim(),
    system: request.systemPrompt,
    messages: [{ role: 'user', content: request.userPrompt }],
    max_tokens: request.profile.maxOutputTokens,
    stream: false,
  };
  if (request.profile.preset === 'deepseek') {
    body.thinking = { type: 'disabled' };
  }
  if (request.profile.temperature !== null) {
    body.temperature = request.profile.temperature;
  }

  const response = await fetchWithDeadline(context, {
    method: 'POST',
    headers: {
      'x-api-key': request.profile.apiKey.trim(),
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw errorForStatus(response.status, await readProviderError(response));
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw createTranslationError('INVALID_RESPONSE', 'Anthropic 响应不是有效的 JSON', true);
  }

  const stopReason = getNestedString(json, ['stop_reason']);
  if (stopReason === 'max_tokens') {
    throw createTranslationError('OUTPUT_TRUNCATED', '模型输出达到长度上限，请缩短内容后重试', true);
  }
  const content = isRecord(json) ? json.content : undefined;
  const text = Array.isArray(content)
    ? content
      .map((block) => getNestedString(block, ['text']))
      .filter((part): part is string => Boolean(part))
      .join('')
    : '';
  if (!text.trim()) {
    throw createTranslationError('INVALID_RESPONSE', 'Anthropic 响应缺少翻译文本', true);
  }
  return text;
}

export async function requestProviderText(request: ProviderTextRequest): Promise<string> {
  if (request.profile.protocol === 'openai-chat') {
    return requestOpenAIChatCompletion(request);
  }
  if (request.profile.protocol === 'anthropic-messages') {
    return requestAnthropicMessages(request);
  }
  throw createTranslationError('INVALID_PROFILE', '不支持的模型协议', false);
}

export function normalizeProviderError(error: unknown): TranslationErrorPayload {
  return toTranslationErrorPayload(error);
}
