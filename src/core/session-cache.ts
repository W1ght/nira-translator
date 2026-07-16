import type { TranslationKind, TranslationSegment } from '../types/domain';

export interface SessionStorageAreaLike {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

interface CacheMetadata {
  size: number;
  order: number;
}

interface CacheIndex {
  version: 1;
  nextOrder: number;
  entries: Record<string, CacheMetadata>;
}

interface CacheRecord<T> {
  version: 1;
  value: T;
}

export interface SessionLruCacheOptions {
  namespace?: string;
  maxEntries?: number;
  maxBytes?: number;
}

export interface TranslationCacheKeyInput {
  profileId: string;
  model: string;
  promptRevision: number;
  kind: TranslationKind;
  sourceLanguage: string;
  targetLanguage: string;
  segments: readonly TranslationSegment[];
}

function emptyIndex(): CacheIndex {
  return { version: 1, nextOrder: 1, entries: {} };
}

function isCacheIndex(value: unknown): value is CacheIndex {
  return typeof value === 'object'
    && value !== null
    && (value as { version?: unknown }).version === 1
    && typeof (value as { nextOrder?: unknown }).nextOrder === 'number'
    && typeof (value as { entries?: unknown }).entries === 'object'
    && (value as { entries?: unknown }).entries !== null;
}

function isCacheRecord<T>(value: unknown): value is CacheRecord<T> {
  return typeof value === 'object'
    && value !== null
    && (value as { version?: unknown }).version === 1
    && 'value' in value;
}

function byteLength(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError('Cache values must be JSON-serializable');
  }
  return new TextEncoder().encode(serialized).byteLength;
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createTranslationCacheKey(
  input: TranslationCacheKeyInput,
): Promise<string> {
  return sha256Hex(JSON.stringify({
    profileId: input.profileId,
    model: input.model,
    promptRevision: input.promptRevision,
    kind: input.kind,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    segments: input.segments.map(({ id, text }) => ({ id, text })),
  }));
}

export class SessionLruCache<T> {
  private readonly indexKey: string;
  private readonly itemPrefix: string;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: SessionStorageAreaLike,
    options: SessionLruCacheOptions = {},
  ) {
    const namespace = options.namespace ?? 'liuyi:translation-cache';
    this.indexKey = `${namespace}:index`;
    this.itemPrefix = `${namespace}:item:`;
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries ?? 500));
    this.maxBytes = Math.max(1024, Math.floor(options.maxBytes ?? 5 * 1024 * 1024));
  }

  private itemKey(key: string): string {
    return `${this.itemPrefix}${key}`;
  }

  private runExclusive<R>(operation: () => Promise<R>): Promise<R> {
    const run = this.queue.then(operation, operation);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async readIndex(): Promise<CacheIndex> {
    const stored = await this.storage.get(this.indexKey);
    const value = stored[this.indexKey];
    return isCacheIndex(value) ? value : emptyIndex();
  }

  async get(key: string): Promise<T | undefined> {
    return this.runExclusive(async () => {
      const itemKey = this.itemKey(key);
      const stored = await this.storage.get([this.indexKey, itemKey]);
      const storedIndex = stored[this.indexKey];
      const index = isCacheIndex(storedIndex) ? storedIndex : emptyIndex();
      const record = stored[itemKey];

      if (!isCacheRecord<T>(record)) {
        if (index.entries[key]) {
          delete index.entries[key];
          await this.storage.set({ [this.indexKey]: index });
        }
        return undefined;
      }

      const metadata = index.entries[key];
      if (!metadata) {
        await this.storage.remove(itemKey);
        return undefined;
      }

      metadata.order = index.nextOrder;
      index.nextOrder += 1;
      await this.storage.set({ [this.indexKey]: index });
      return record.value;
    });
  }

  async set(key: string, value: T): Promise<boolean> {
    return this.runExclusive(async () => {
      const record: CacheRecord<T> = { version: 1, value };
      const size = byteLength(record);
      const index = await this.readIndex();

      if (size > this.maxBytes) {
        delete index.entries[key];
        await this.storage.remove(this.itemKey(key));
        await this.storage.set({ [this.indexKey]: index });
        return false;
      }

      index.entries[key] = { size, order: index.nextOrder };
      index.nextOrder += 1;

      const oldestFirst = Object.entries(index.entries)
        .sort(([, left], [, right]) => left.order - right.order);
      let totalBytes = oldestFirst.reduce((total, [, metadata]) => total + metadata.size, 0);
      const evicted: string[] = [];

      while (
        oldestFirst.length - evicted.length > this.maxEntries
        || totalBytes > this.maxBytes
      ) {
        const candidate = oldestFirst[evicted.length];
        if (!candidate) {
          break;
        }
        const [candidateKey, metadata] = candidate;
        evicted.push(candidateKey);
        totalBytes -= metadata.size;
        delete index.entries[candidateKey];
      }

      if (evicted.length > 0) {
        await this.storage.remove(evicted.map((candidate) => this.itemKey(candidate)));
      }
      await this.storage.set({
        [this.itemKey(key)]: record,
        [this.indexKey]: index,
      });
      return true;
    });
  }

  async delete(key: string): Promise<void> {
    await this.runExclusive(async () => {
      const index = await this.readIndex();
      delete index.entries[key];
      await this.storage.remove(this.itemKey(key));
      await this.storage.set({ [this.indexKey]: index });
    });
  }

  async clear(): Promise<void> {
    await this.runExclusive(async () => {
      const index = await this.readIndex();
      const keys = Object.keys(index.entries).map((key) => this.itemKey(key));
      if (keys.length > 0) {
        await this.storage.remove(keys);
      }
      await this.storage.remove(this.indexKey);
    });
  }
}
