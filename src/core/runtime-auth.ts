export interface ExtensionMessageSender {
  id?: string;
  url?: string;
  tab?: { id?: number };
}

/**
 * Extension pages opened in a normal browser tab still include `sender.tab`.
 * Trust the extension URL instead of assuming that every tab-backed sender is
 * a content script.
 */
export function isTrustedExtensionPage(
  sender: ExtensionMessageSender,
  extensionRootUrl: string,
  extensionId: string,
): boolean {
  return sender.id === extensionId
    && typeof sender.url === 'string'
    && sender.url.startsWith(extensionRootUrl);
}
