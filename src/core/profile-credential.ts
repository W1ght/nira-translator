import type { CredentialAction } from '../types/profile';

export type CredentialState = 'missing' | 'pending' | 'stored';

export function resolveCredentialState(
  credential: string,
  action: CredentialAction,
  hasStoredApiKey: boolean,
): CredentialState {
  if (credential.trim()) return 'pending';
  if (action === 'clear') return 'missing';
  return hasStoredApiKey ? 'stored' : 'missing';
}
