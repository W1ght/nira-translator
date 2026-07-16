import type { TranslationErrorPayload } from '../types/domain';

export interface SelectionErrorState {
  message: string;
  action: 'retry' | 'reload';
}

const INVALID_CONTEXT_PATTERNS = [
  'extension context invalidated',
  'context invalidated',
  'message port closed before a response was received',
];

export function isExtensionContextInvalidatedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const normalized = message.toLowerCase();
  return INVALID_CONTEXT_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function isDisconnectedContentScriptError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.toLowerCase().includes('receiving end does not exist');
}

export function selectionErrorState(
  payload: TranslationErrorPayload | undefined,
  fallback: string,
): SelectionErrorState {
  if (isExtensionContextInvalidatedError(fallback) || isDisconnectedContentScriptError(fallback)) {
    return {
      message: 'Nira translator 已更新，请刷新当前页面后重新划词。',
      action: 'reload',
    };
  }
  if (!payload) return { message: fallback || '翻译失败，请稍后重试。', action: 'retry' };
  if (payload.code === 'NO_PROFILE') {
    return { message: '请先在 Nira translator 设置中选择并配置翻译服务。', action: 'retry' };
  }
  if (payload.code === 'AUTH_FAILED') return { message: 'API Key 无效，请检查模型配置。', action: 'retry' };
  if (payload.code === 'RATE_LIMITED') return { message: '请求过于频繁，请稍后重试。', action: 'retry' };
  if (payload.code === 'PERMISSION_DENIED') return { message: '尚未授权访问该 API 地址。', action: 'retry' };
  return { message: payload.message, action: 'retry' };
}
