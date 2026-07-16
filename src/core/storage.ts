import { browser } from 'wxt/browser';

import { DEFAULT_PROFILES, DEFAULT_PROMPTS, DEFAULT_SETTINGS } from '../constants/defaults';
import type {
  ExtensionSettings,
  ModelProfile,
  PromptTemplate,
  PublicModelProfile,
} from '../types/domain';
import type { ModelProfileInput } from '../types/profile';
import {
  DEEPSEEK_OPENAI_MIGRATION_VERSION,
  migrateDeepSeekProfiles,
} from './profile-migrations';

const PROVIDER_CATALOG_MIGRATION_VERSION = 3;

const STORAGE_KEYS = {
  settings: 'nira:settings:v1',
  prompts: 'nira:prompts:v1',
  profiles: 'nira:profiles:v1',
  credentials: 'nira:credentials:v1',
  schemaVersion: 'nira:schema-version',
} as const;

type StoredModelProfile = Omit<ModelProfile, 'apiKey'>;
type CredentialStore = Record<string, string>;

function withoutCredential(profile: ModelProfile): StoredModelProfile {
  const { apiKey: _apiKey, ...stored } = profile;
  return stored;
}

function toPublic(
  profile: StoredModelProfile,
  credentials: CredentialStore,
): PublicModelProfile {
  return {
    ...profile,
    hasApiKey: Boolean(credentials[profile.id]),
  };
}

async function readLocal<T>(key: string, fallback: T): Promise<T> {
  const values = await browser.storage.local.get(key);
  return (values[key] as T | undefined) ?? fallback;
}

export async function initializeStorage(): Promise<void> {
  await Promise.allSettled([
    browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    browser.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  ]);

  const existing = await browser.storage.local.get(Object.values(STORAGE_KEYS));
  const seed: Record<string, unknown> = {};
  const storedProfiles = Array.isArray(existing[STORAGE_KEYS.profiles])
    ? existing[STORAGE_KEYS.profiles] as StoredModelProfile[]
    : null;
  const schemaVersion = typeof existing[STORAGE_KEYS.schemaVersion] === 'number'
    ? existing[STORAGE_KEYS.schemaVersion] as number
    : 0;

  if (!existing[STORAGE_KEYS.settings]) seed[STORAGE_KEYS.settings] = DEFAULT_SETTINGS;
  if (!existing[STORAGE_KEYS.prompts]) seed[STORAGE_KEYS.prompts] = DEFAULT_PROMPTS;
  if (!storedProfiles) {
    seed[STORAGE_KEYS.profiles] = DEFAULT_PROFILES.map(withoutCredential);
  } else if (schemaVersion < PROVIDER_CATALOG_MIGRATION_VERSION) {
    const migrated = schemaVersion < DEEPSEEK_OPENAI_MIGRATION_VERSION
      ? migrateDeepSeekProfiles(storedProfiles)
      : storedProfiles;
    const ids = new Set(migrated.map((profile) => profile.id));
    seed[STORAGE_KEYS.profiles] = [
      ...migrated.map((profile) => ({ ...profile, region: profile.region ?? '' })),
      ...DEFAULT_PROFILES.filter((profile) => !ids.has(profile.id)).map(withoutCredential),
    ];
  }
  if (!existing[STORAGE_KEYS.credentials]) seed[STORAGE_KEYS.credentials] = {};
  if (schemaVersion < PROVIDER_CATALOG_MIGRATION_VERSION) {
    seed[STORAGE_KEYS.schemaVersion] = PROVIDER_CATALOG_MIGRATION_VERSION;
  }

  if (Object.keys(seed).length) await browser.storage.local.set(seed);
}

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await readLocal<Partial<ExtensionSettings>>(
    STORAGE_KEYS.settings,
    DEFAULT_SETTINGS,
  );
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function updateSettings(
  patch: Partial<ExtensionSettings>,
): Promise<ExtensionSettings> {
  const settings = { ...(await getSettings()), ...patch };
  await browser.storage.local.set({ [STORAGE_KEYS.settings]: settings });
  return settings;
}

export async function getPrompts(): Promise<PromptTemplate> {
  const stored = await readLocal<Partial<PromptTemplate>>(
    STORAGE_KEYS.prompts,
    DEFAULT_PROMPTS,
  );
  return { ...DEFAULT_PROMPTS, ...stored };
}

export async function updatePrompts(prompts: PromptTemplate): Promise<PromptTemplate> {
  const next = { ...prompts, revision: Math.max(prompts.revision + 1, Date.now()) };
  await browser.storage.local.set({ [STORAGE_KEYS.prompts]: next });
  return next;
}

export async function resetPrompts(): Promise<PromptTemplate> {
  const next = { ...DEFAULT_PROMPTS, revision: Date.now() };
  await browser.storage.local.set({ [STORAGE_KEYS.prompts]: next });
  return next;
}

async function getStoredProfiles(): Promise<StoredModelProfile[]> {
  const profiles = await readLocal<StoredModelProfile[]>(
    STORAGE_KEYS.profiles,
    DEFAULT_PROFILES.map(withoutCredential),
  );
  return profiles.map((profile) => ({ ...profile, region: profile.region ?? '' }));
}

async function getCredentials(): Promise<CredentialStore> {
  return readLocal<CredentialStore>(STORAGE_KEYS.credentials, {});
}

export async function listProfiles(): Promise<PublicModelProfile[]> {
  const [profiles, credentials] = await Promise.all([
    getStoredProfiles(),
    getCredentials(),
  ]);
  return profiles.map((profile) => toPublic(profile, credentials));
}

export async function getProfile(profileId?: string): Promise<ModelProfile | null> {
  const settings = await getSettings();
  const id = profileId ?? settings.activeProfileId;
  if (!id) return null;

  const [profiles, credentials] = await Promise.all([
    getStoredProfiles(),
    getCredentials(),
  ]);
  const profile = profiles.find((candidate) => candidate.id === id);
  if (!profile) return null;
  return { ...profile, apiKey: credentials[id] ?? '' };
}

export async function saveProfile(input: ModelProfileInput): Promise<PublicModelProfile[]> {
  const [profiles, credentials, settings] = await Promise.all([
    getStoredProfiles(),
    getCredentials(),
    getSettings(),
  ]);
  const now = Date.now();
  const existing = profiles.find((profile) => profile.id === input.id);
  const profile: StoredModelProfile = {
    id: input.id || crypto.randomUUID(),
    name: input.name.trim(),
    preset: input.preset,
    protocol: input.protocol,
    baseUrl: input.baseUrl.trim(),
    model: input.model.trim(),
    region: input.region?.trim() ?? '',
    temperature: input.temperature,
    maxOutputTokens: input.maxOutputTokens,
    timeoutMs: input.timeoutMs,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const nextProfiles = existing
    ? profiles.map((candidate) => (candidate.id === profile.id ? profile : candidate))
    : [...profiles, profile];
  const nextCredentials = { ...credentials };

  if (input.credentialAction === 'replace') {
    const key = input.apiKey?.trim() ?? '';
    if (!key) throw new Error('API Key 不能为空');
    nextCredentials[profile.id] = key;
  } else if (input.credentialAction === 'clear') {
    delete nextCredentials[profile.id];
  }

  const nextSettings = { ...settings, activeProfileId: profile.id };
  await browser.storage.local.set({
    [STORAGE_KEYS.profiles]: nextProfiles,
    [STORAGE_KEYS.credentials]: nextCredentials,
    [STORAGE_KEYS.settings]: nextSettings,
  });
  return nextProfiles.map((candidate) => toPublic(candidate, nextCredentials));
}

export async function deleteProfile(profileId: string): Promise<PublicModelProfile[]> {
  const [profiles, credentials, settings] = await Promise.all([
    getStoredProfiles(),
    getCredentials(),
    getSettings(),
  ]);
  const nextProfiles = profiles.filter((profile) => profile.id !== profileId);
  const nextCredentials = { ...credentials };
  delete nextCredentials[profileId];
  const nextSettings = settings.activeProfileId === profileId
    ? { ...settings, activeProfileId: nextProfiles[0]?.id ?? null }
    : settings;

  await browser.storage.local.set({
    [STORAGE_KEYS.profiles]: nextProfiles,
    [STORAGE_KEYS.credentials]: nextCredentials,
    [STORAGE_KEYS.settings]: nextSettings,
  });
  return nextProfiles.map((profile) => toPublic(profile, nextCredentials));
}

export { STORAGE_KEYS };
