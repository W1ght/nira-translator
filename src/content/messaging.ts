import { browser } from 'wxt/browser';

import type {
  ExtensionSettings,
  TranslationErrorPayload,
  TranslationRequest,
  TranslationResult,
} from '../types/domain';

type SettingsResponse =
  | { ok: true; settings: ExtensionSettings }
  | { ok: false; error: TranslationErrorPayload };

type TranslationResponse =
  | { ok: true; result: TranslationResult }
  | { ok: false; error: TranslationErrorPayload };

export async function getSettings(): Promise<ExtensionSettings> {
  const response = (await browser.runtime.sendMessage({
    type: 'settings:get',
  })) as SettingsResponse | undefined;

  if (!response?.ok) {
    throw new Error(response?.error.message ?? '无法读取扩展设置');
  }

  return response.settings;
}

export async function requestTranslation(
  request: TranslationRequest,
): Promise<TranslationResult> {
  const response = (await browser.runtime.sendMessage({
    type: 'translate',
    request,
  })) as TranslationResponse | undefined;

  if (!response?.ok) {
    const error = new Error(response?.error.message ?? '翻译请求失败') as Error & {
      payload?: TranslationErrorPayload;
    };
    if (response?.error) error.payload = response.error;
    throw error;
  }

  return response.result;
}

export async function cancelTranslation(jobId: string): Promise<void> {
  try {
    await browser.runtime.sendMessage({ type: 'translate:cancel', jobId });
  } catch {
    // The background worker may already have completed or restarted.
  }
}

export function createJobId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
