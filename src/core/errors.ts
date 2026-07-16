import type {
  TranslationErrorCode,
  TranslationErrorPayload,
} from '../types/domain';

export class TranslationCoreError extends Error {
  readonly payload: TranslationErrorPayload;

  constructor(payload: TranslationErrorPayload, options?: ErrorOptions) {
    super(payload.message, options);
    this.name = 'TranslationCoreError';
    this.payload = payload;
  }
}

export function createTranslationError(
  code: TranslationErrorCode,
  message: string,
  retryable: boolean,
  status?: number,
): TranslationCoreError {
  const payload: TranslationErrorPayload = status === undefined
    ? { code, message, retryable }
    : { code, message, retryable, status };

  return new TranslationCoreError(payload);
}

export function toTranslationErrorPayload(error: unknown): TranslationErrorPayload {
  if (error instanceof TranslationCoreError) {
    return error.payload;
  }

  return {
    code: 'PROVIDER_ERROR',
    message: error instanceof Error ? error.message : '翻译服务发生未知错误',
    retryable: false,
  };
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}
