import type { ProviderProtocol } from '../types/domain';

const ENDPOINT_PATHS: Record<ProviderProtocol, string> = {
  'openai-chat': 'chat/completions',
  'anthropic-messages': 'v1/messages',
};

export class UnsafeProviderUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeProviderUrlError';
  }
}

export interface ProviderUrlValidationOptions {
  allowInsecureHttp?: boolean;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

/**
 * Parses a provider base URL without allowing credentials, query strings, or
 * fragments to be smuggled into every API request. Plain HTTP is reserved for
 * local development unless the caller has obtained an explicit insecure opt-in.
 */
export function validateProviderBaseUrl(
  input: string,
  options: ProviderUrlValidationOptions = {},
): URL {
  const value = input.trim();
  if (!value) {
    throw new UnsafeProviderUrlError('API 地址不能为空');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UnsafeProviderUrlError('API 地址格式无效');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new UnsafeProviderUrlError('API 地址只支持 HTTPS 或 HTTP');
  }
  if (!url.hostname) {
    throw new UnsafeProviderUrlError('API 地址缺少主机名');
  }
  if (url.username || url.password) {
    throw new UnsafeProviderUrlError('API 地址不能包含用户名或密码');
  }
  if (url.search || url.hash) {
    throw new UnsafeProviderUrlError('API 地址不能包含查询参数或片段');
  }
  if (
    url.protocol === 'http:'
    && !isLoopbackHostname(url.hostname)
    && !options.allowInsecureHttp
  ) {
    throw new UnsafeProviderUrlError('非本机 API 地址必须使用 HTTPS');
  }

  return url;
}

export function buildProviderEndpoint(
  baseUrl: string,
  protocol: ProviderProtocol,
  options?: ProviderUrlValidationOptions,
): string {
  const url = validateProviderBaseUrl(baseUrl, options);
  const suffix = ENDPOINT_PATHS[protocol];
  const path = url.pathname.replace(/\/+$/g, '');
  const normalizedPath = path.toLowerCase();
  const normalizedSuffix = `/${suffix}`.toLowerCase();

  if (!normalizedPath.endsWith(normalizedSuffix)) {
    url.pathname = `${path}/${suffix}`.replace(/\/{2,}/g, '/');
  } else {
    url.pathname = path;
  }

  return url.toString();
}

export function getProviderOriginPattern(
  baseUrl: string,
  options?: ProviderUrlValidationOptions,
): string {
  const url = validateProviderBaseUrl(baseUrl, options);
  return `${url.protocol}//${url.hostname}/*`;
}
