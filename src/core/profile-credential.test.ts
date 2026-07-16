import { describe, expect, it } from 'vitest';

import { resolveCredentialState } from './profile-credential';

describe('profile credential state', () => {
  it('distinguishes missing, pending and stored API keys', () => {
    expect(resolveCredentialState('', 'keep', false)).toBe('missing');
    expect(resolveCredentialState('  sk-test  ', 'keep', false)).toBe('pending');
    expect(resolveCredentialState('', 'keep', true)).toBe('stored');
    expect(resolveCredentialState('', 'clear', true)).toBe('missing');
  });
});
