import { describe, expect, it } from 'vitest';

import { isTrustedExtensionPage } from './runtime-auth';

const extensionId = 'abcdefghijklmnop';
const extensionRoot = `chrome-extension://${extensionId}/`;

describe('isTrustedExtensionPage', () => {
  it('accepts an options page opened in a browser tab', () => {
    expect(isTrustedExtensionPage({
      id: extensionId,
      url: `${extensionRoot}options.html`,
      tab: { id: 42 },
    }, extensionRoot, extensionId)).toBe(true);
  });

  it('accepts a popup without tab metadata', () => {
    expect(isTrustedExtensionPage({
      id: extensionId,
      url: `${extensionRoot}popup.html`,
    }, extensionRoot, extensionId)).toBe(true);
  });

  it('rejects content scripts and foreign extensions', () => {
    expect(isTrustedExtensionPage({
      id: extensionId,
      url: 'https://example.com/',
      tab: { id: 42 },
    }, extensionRoot, extensionId)).toBe(false);
    expect(isTrustedExtensionPage({
      id: 'another-extension',
      url: `${extensionRoot}options.html`,
    }, extensionRoot, extensionId)).toBe(false);
  });
});
