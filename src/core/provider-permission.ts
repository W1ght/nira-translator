import { getProviderOriginPattern } from './url';

interface OriginPermissionApi {
  contains(permissions: { origins: string[] }): Promise<boolean>;
  request(permissions: { origins: string[] }): Promise<boolean>;
}

export async function hasProviderOriginAccess(
  permissions: Pick<OriginPermissionApi, 'contains'>,
  baseUrl: string,
): Promise<boolean> {
  const origin = getProviderOriginPattern(baseUrl);
  return permissions.contains({ origins: [origin] });
}

/**
 * Must be called directly from a user gesture, such as the settings page's
 * Save or Test button. Chrome only permits runtime host access prompts from a
 * user-initiated action.
 */
export async function ensureProviderOriginAccess(
  permissions: Pick<OriginPermissionApi, 'request'>,
  baseUrl: string,
): Promise<boolean> {
  const origin = getProviderOriginPattern(baseUrl);
  // Invoke request synchronously within the button handler's user gesture.
  // Chrome returns true without another prompt when access already exists.
  return permissions.request({ origins: [origin] });
}
