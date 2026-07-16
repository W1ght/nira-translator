import type { ModelProfile } from './domain';

export type CredentialAction = 'keep' | 'replace' | 'clear';

export interface ModelProfileInput
  extends Omit<ModelProfile, 'apiKey' | 'createdAt' | 'updatedAt'> {
  credentialAction: CredentialAction;
  apiKey?: string;
}

