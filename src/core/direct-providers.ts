import type { ModelProfile, TranslationSegment } from '../types/domain';
import { createTranslationError, isAbortError, TranslationCoreError } from './errors';
import { validateProviderBaseUrl } from './url';

interface DirectTranslationRequest {
  profile: ModelProfile;
  sourceLanguage: string;
  targetLanguage: string;
  segments: TranslationSegment[];
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null ? value as JsonRecord : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function endpoint(profile: ModelProfile, suffix = ''): string {
  const url = validateProviderBaseUrl(profile.baseUrl);
  if (suffix && !url.pathname.toLowerCase().endsWith(suffix.toLowerCase())) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`;
  }
  return url.toString();
}

async function fetchJson(
  request: DirectTranslationRequest,
  url: string,
  init: RequestInit = {},
): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort(request.signal?.reason);
  request.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.min(Math.max(request.profile.timeoutMs || 27_000, 1), 27_000));
  try {
    const fetchImpl = request.fetchImpl ?? fetch;
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      let detail = '';
      try {
        const body = record(await response.clone().json());
        detail = String(record(body?.error)?.message ?? body?.message ?? '');
      } catch { /* status-only fallback */ }
      const code = response.status === 401 || response.status === 403 ? 'AUTH_FAILED' : response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_ERROR';
      throw createTranslationError(code, detail || `服务商返回 HTTP ${response.status}`, response.status >= 500, response.status);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof TranslationCoreError) throw error;
    if (timedOut) throw createTranslationError('TIMEOUT', '翻译服务在 27 秒内未响应', true);
    if (request.signal?.aborted) throw createTranslationError('CANCELLED', '翻译已取消', false);
    if (isAbortError(error)) throw createTranslationError('TIMEOUT', '翻译请求被中止', true);
    throw createTranslationError('NETWORK_ERROR', `无法连接 ${new URL(url).hostname}`, true);
  } finally {
    clearTimeout(timeout);
    request.signal?.removeEventListener('abort', abort);
  }
}

function source(language: string): string {
  return language === 'auto' ? 'auto' : language;
}

function mappedLanguage(protocol: ModelProfile['protocol'], language: string): string {
  if (protocol === 'builtin-translator') {
    if (language === 'zh-CN') return 'zh-Hans';
    if (language === 'zh-TW') return 'zh-Hant';
  }
  if (protocol === 'microsoft-translator' || protocol === 'azure-translator') {
    if (language === 'auto') return '';
    if (language === 'zh-CN') return 'zh-Hans';
    if (language === 'zh-TW') return 'zh-Hant';
  }
  if (protocol === 'tencent-translator' || protocol === 'volcengine-translator' || protocol === 'cloudflare-ai') {
    if (language === 'zh-CN') return 'zh';
    if (language === 'zh-TW') return protocol === 'volcengine-translator' ? 'zh-Hant' : 'zh';
  }
  if (protocol === 'cloudflare-ai' && language === 'auto') return 'en';
  return source(language);
}

function deeplLanguage(language: string): string {
  if (language === 'auto') return '';
  if (language.toLowerCase() === 'zh-cn' || language.toLowerCase() === 'zh-tw') return 'ZH';
  return language.toUpperCase();
}

async function google(request: DirectTranslationRequest): Promise<string[]> {
  return Promise.all(request.segments.map(async ({ text }) => {
    const url = new URL(endpoint(request.profile));
    url.search = new URLSearchParams({ client: 'gtx', dt: 't', dj: '1', ie: 'UTF-8', sl: source(request.sourceLanguage), tl: request.targetLanguage, q: text }).toString();
    const json = record(await fetchJson(request, url.toString(), { method: 'GET' }));
    const sentences = Array.isArray(json?.sentences) ? json.sentences : [];
    return sentences.map((item) => String(record(item)?.trans ?? '')).join(' ');
  }));
}

async function googleHtml(request: DirectTranslationRequest): Promise<string[]> {
  const json = await fetchJson(request, endpoint(request.profile), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json+protobuf', 'X-Goog-API-Key': 'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520' },
    body: JSON.stringify([[request.segments.map((segment) => segment.text), source(request.sourceLanguage), request.targetLanguage], 'wt_lib']),
  });
  return Array.isArray(json) && Array.isArray(json[0]) ? strings(json[0]) : [];
}

let microsoftToken: { value: string; expiresAt: number } | null = null;
async function getMicrosoftToken(request: DirectTranslationRequest): Promise<string> {
  if (microsoftToken && microsoftToken.expiresAt > Date.now() + 5_000) return microsoftToken.value;
  const fetchImpl = request.fetchImpl ?? fetch;
  const response = await fetchImpl('https://edge.microsoft.com/translate/auth');
  if (!response.ok) throw createTranslationError('AUTH_FAILED', '无法获取微软翻译令牌', true, response.status);
  const value = await response.text();
  let expiresAt = Date.now() + 8 * 60_000;
  try {
    const payload = JSON.parse(atob(value.split('.')[1] ?? '')) as { exp?: number };
    if (payload.exp) expiresAt = payload.exp * 1000;
  } catch { /* use short-lived fallback */ }
  microsoftToken = { value, expiresAt };
  return value;
}

function parseMicrosoft(json: unknown): string[] {
  return Array.isArray(json) ? json.map((item) => {
    const translations = record(item)?.translations;
    return Array.isArray(translations) ? translations.map((entry) => String(record(entry)?.text ?? '')).join(' ') : '';
  }) : [];
}

async function microsoft(request: DirectTranslationRequest, azure: boolean): Promise<string[]> {
  const url = new URL(endpoint(request.profile, 'translate'));
  url.searchParams.set('api-version', '3.0');
  const from = mappedLanguage(request.profile.protocol, request.sourceLanguage);
  if (from) url.searchParams.set('from', from);
  url.searchParams.set('to', mappedLanguage(request.profile.protocol, request.targetLanguage));
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (azure) {
    headers['Ocp-Apim-Subscription-Key'] = request.profile.apiKey.trim();
    headers['Ocp-Apim-Subscription-Region'] = request.profile.region?.trim() ?? '';
  } else {
    headers.Authorization = `Bearer ${await getMicrosoftToken(request)}`;
  }
  return parseMicrosoft(await fetchJson(request, url.toString(), {
    method: 'POST', headers, body: JSON.stringify(request.segments.map((segment) => ({ Text: segment.text }))),
  }));
}

async function deepl(request: DirectTranslationRequest): Promise<string[]> {
  const body: JsonRecord = { text: request.segments.map((segment) => segment.text), target_lang: deeplLanguage(request.targetLanguage) };
  if (request.sourceLanguage !== 'auto') body.source_lang = deeplLanguage(request.sourceLanguage);
  const json = record(await fetchJson(request, endpoint(request.profile), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `DeepL-Auth-Key ${request.profile.apiKey.trim()}` },
    body: JSON.stringify(body),
  }));
  return Array.isArray(json?.translations) ? json.translations.map((item) => String(record(item)?.text ?? '')) : [];
}

let deeplRpcId = Math.round(Math.random() * 1e8);
async function deeplFree(request: DirectTranslationRequest): Promise<string[]> {
  return Promise.all(request.segments.map(async (segment) => {
    const count = (segment.text.match(/i/g) ?? []).length + 1;
    let timestamp = Date.now();
    timestamp += count - (timestamp % count);
    deeplRpcId += 1;
    const body = { jsonrpc: '2.0', method: 'LMT_handle_texts', params: { splitting: 'newlines', lang: { target_lang: deeplLanguage(request.targetLanguage), source_lang_user_selected: deeplLanguage(request.sourceLanguage) || 'auto' }, commonJobParams: { wasSpoken: false, transcribe_as: '' }, id: deeplRpcId, timestamp, texts: [{ text: segment.text, requestAlternatives: 0 }] } };
    const json = record(await fetchJson(request, endpoint(request.profile), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    const result = record(json?.result);
    const texts = Array.isArray(result?.texts) ? result.texts : [];
    return texts.map((item) => String(record(item)?.text ?? '')).join(' ');
  }));
}

async function deeplx(request: DirectTranslationRequest): Promise<string[]> {
  return Promise.all(request.segments.map(async (segment) => {
    const json = record(await fetchJson(request, endpoint(request.profile, 'translate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(request.profile.apiKey.trim() ? { Authorization: `Bearer ${request.profile.apiKey.trim()}` } : {}) },
      body: JSON.stringify({ text: segment.text, source_lang: deeplLanguage(request.sourceLanguage) || 'auto', target_lang: deeplLanguage(request.targetLanguage) }),
    }));
    return String(json?.data ?? json?.text ?? '');
  }));
}

async function tencent(request: DirectTranslationRequest): Promise<string[]> {
  const body = { header: { fn: 'auto_translation', client_key: `browser-chrome-${crypto.randomUUID()}` }, type: 'plain', model_category: 'normal', source: { text_list: request.segments.map((segment) => segment.text), lang: mappedLanguage(request.profile.protocol, request.sourceLanguage) }, target: { lang: mappedLanguage(request.profile.protocol, request.targetLanguage) } };
  const json = record(await fetchJson(request, endpoint(request.profile), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  return strings(json?.auto_translation);
}

async function volcengine(request: DirectTranslationRequest): Promise<string[]> {
  return Promise.all(request.segments.map(async (segment) => {
    const json = record(await fetchJson(request, endpoint(request.profile), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source_language: mappedLanguage(request.profile.protocol, request.sourceLanguage), target_language: mappedLanguage(request.profile.protocol, request.targetLanguage), text: segment.text }) }));
    return String(json?.translation ?? '');
  }));
}

async function cloudflare(request: DirectTranslationRequest): Promise<string[]> {
  return Promise.all(request.segments.map(async (segment) => {
    const json = record(await fetchJson(request, endpoint(request.profile), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${request.profile.apiKey.trim()}` }, body: JSON.stringify({ text: segment.text, source_lang: mappedLanguage(request.profile.protocol, request.sourceLanguage), target_lang: mappedLanguage(request.profile.protocol, request.targetLanguage) }) }));
    return String(record(json?.result)?.translated_text ?? '');
  }));
}

async function custom(request: DirectTranslationRequest): Promise<string[]> {
  const json = await fetchJson(request, endpoint(request.profile), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(request.profile.apiKey.trim() ? { Authorization: `Bearer ${request.profile.apiKey.trim()}` } : {}) }, body: JSON.stringify({ texts: request.segments.map((segment) => segment.text), from: request.sourceLanguage, to: request.targetLanguage }) });
  if (Array.isArray(json)) return json.map((item) => typeof item === 'string' ? item : String(record(item)?.text ?? ''));
  const translations = record(json)?.translations;
  return Array.isArray(translations) ? translations.map((item) => typeof item === 'string' ? item : String(record(item)?.text ?? '')) : [];
}

async function builtin(request: DirectTranslationRequest): Promise<string[]> {
  const api = (globalThis as unknown as { Translator?: { availability(options: object): Promise<string>; create(options: object): Promise<{ translate(text: string): Promise<string> }> } }).Translator;
  if (!api) throw createTranslationError('PROVIDER_ERROR', '当前 Chrome 不支持内置 Translator API（需要 Chrome 138+）', false);
  if (request.sourceLanguage === 'auto') throw createTranslationError('INVALID_PROFILE', 'Chrome 内置翻译暂不支持自动源语言，请在设置中指定源语言', false);
  const options = { sourceLanguage: mappedLanguage(request.profile.protocol, request.sourceLanguage), targetLanguage: mappedLanguage(request.profile.protocol, request.targetLanguage) };
  if (await api.availability(options) === 'unavailable') throw createTranslationError('PROVIDER_ERROR', 'Chrome 未提供当前语言方向的本地翻译模型', false);
  const translator = await api.create(options);
  return Promise.all(request.segments.map((segment) => translator.translate(segment.text)));
}

export async function requestDirectTranslations(request: DirectTranslationRequest): Promise<TranslationSegment[]> {
  let translated: string[];
  switch (request.profile.protocol) {
    case 'builtin-translator': translated = await builtin(request); break;
    case 'google-translate': translated = await google(request); break;
    case 'google-html': translated = await googleHtml(request); break;
    case 'microsoft-translator': translated = await microsoft(request, false); break;
    case 'azure-translator': translated = await microsoft(request, true); break;
    case 'deepl': translated = await deepl(request); break;
    case 'deepl-free': translated = await deeplFree(request); break;
    case 'deeplx': translated = await deeplx(request); break;
    case 'tencent-translator': translated = await tencent(request); break;
    case 'volcengine-translator': translated = await volcengine(request); break;
    case 'cloudflare-ai': translated = await cloudflare(request); break;
    case 'custom-json': translated = await custom(request); break;
    default: throw createTranslationError('INVALID_PROFILE', '当前服务不是直接翻译协议', false);
  }
  if (translated.length !== request.segments.length || translated.some((text) => !text.trim())) {
    throw createTranslationError('INVALID_RESPONSE', '翻译服务返回的段落数量不匹配或包含空译文', true);
  }
  return request.segments.map((segment, index) => ({ id: segment.id, text: translated[index]! }));
}
