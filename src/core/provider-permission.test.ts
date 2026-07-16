import { describe, expect, it, vi } from 'vitest';

import {
  ensureProviderOriginAccess,
  hasProviderOriginAccess,
} from './provider-permission';

describe('provider origin permissions', () => {
  it('checks the exact provider origin', async () => {
    const contains = vi.fn(async () => true);

    await expect(hasProviderOriginAccess(
      { contains },
      'https://api.deepseek.com/anthropic',
    )).resolves.toBe(true);
    expect(contains).toHaveBeenCalledWith({
      origins: ['https://api.deepseek.com/*'],
    });
  });

  it('requests only the provider origin', async () => {
    const permissions = {
      request: vi.fn(async () => true),
    };

    await expect(ensureProviderOriginAccess(
      permissions,
      'https://api.deepseek.com',
    )).resolves.toBe(true);
    expect(permissions.request).toHaveBeenCalledWith({
      origins: ['https://api.deepseek.com/*'],
    });
  });

  it('reports a denied permission request', async () => {
    const permissions = {
      request: vi.fn(async () => false),
    };

    await expect(ensureProviderOriginAccess(
      permissions,
      'https://api.deepseek.com',
    )).resolves.toBe(false);
  });
});
