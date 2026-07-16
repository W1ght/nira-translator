import { browser } from 'wxt/browser';

import type { RuntimeFailure, RuntimeRequest, RuntimeResponse } from '../types/messages';

export async function sendRuntime<T extends RuntimeRequest>(
  request: T,
): Promise<RuntimeResponse<T>> {
  const response = await browser.runtime.sendMessage(request) as RuntimeResponse<T> | RuntimeFailure;
  if (!response || !response.ok) {
    throw new Error(response?.error.message ?? '扩展后台没有响应');
  }
  return response as RuntimeResponse<T>;
}

