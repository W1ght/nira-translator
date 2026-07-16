import { describe, expect, it } from 'vitest';

import {
  isDisconnectedContentScriptError,
  isExtensionContextInvalidatedError,
  selectionErrorState,
} from './selection-errors';

describe('selection error recovery', () => {
  it('recognizes an invalidated extension context', () => {
    const error = new Error('Extension context invalidated.');
    expect(isExtensionContextInvalidatedError(error)).toBe(true);
    expect(selectionErrorState(undefined, error.message)).toEqual({
      message: 'Nira translator 已更新，请刷新当前页面后重新划词。',
      action: 'reload',
    });
  });

  it('asks for a page refresh when the content script is disconnected', () => {
    const error = new Error('Could not establish connection. Receiving end does not exist.');
    expect(isDisconnectedContentScriptError(error)).toBe(true);
    expect(selectionErrorState(undefined, error.message).action).toBe('reload');
  });

  it('keeps retry for ordinary provider failures', () => {
    expect(selectionErrorState({ code: 'RATE_LIMITED', message: '429', retryable: true }, '429')).toEqual({
      message: '请求过于频繁，请稍后重试。',
      action: 'retry',
    });
  });
});
