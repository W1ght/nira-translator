import { describe, expect, it } from 'vitest';
import {
  createTranslationCacheKey,
  SessionLruCache,
  type SessionStorageAreaLike,
} from './session-cache';

class MemorySessionStorage implements SessionStorageAreaLike {
  readonly data = new Map<string, unknown>();

  async get(keys: string | string[]): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      if (this.data.has(key)) {
        result[key] = structuredClone(this.data.get(key));
      }
    }
    return result;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.entries(items).forEach(([key, value]) => {
      this.data.set(key, structuredClone(value));
    });
  }

  async remove(keys: string | string[]): Promise<void> {
    (Array.isArray(keys) ? keys : [keys]).forEach((key) => this.data.delete(key));
  }
}

describe('SessionLruCache', () => {
  it('evicts the least recently used entry', async () => {
    const storage = new MemorySessionStorage();
    const cache = new SessionLruCache<string>(storage, {
      namespace: 'test-cache',
      maxEntries: 2,
      maxBytes: 4096,
    });

    await cache.set('a', 'A');
    await cache.set('b', 'B');
    await expect(cache.get('a')).resolves.toBe('A');
    await cache.set('c', 'C');

    await expect(cache.get('a')).resolves.toBe('A');
    await expect(cache.get('b')).resolves.toBeUndefined();
    await expect(cache.get('c')).resolves.toBe('C');
  });

  it('does not retain a value larger than the byte budget', async () => {
    const storage = new MemorySessionStorage();
    const cache = new SessionLruCache<string>(storage, {
      namespace: 'tiny-cache',
      maxEntries: 5,
      maxBytes: 1024,
    });

    await expect(cache.set('oversized', 'x'.repeat(2048))).resolves.toBe(false);
    await expect(cache.get('oversized')).resolves.toBeUndefined();
  });

  it('creates deterministic keys and includes prompt/model/text inputs', async () => {
    const base = {
      profileId: 'p1',
      model: 'm1',
      promptRevision: 1,
      kind: 'page' as const,
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      segments: [{ id: 'one', text: 'Hello' }],
    };
    const first = await createTranslationCacheKey(base);
    const second = await createTranslationCacheKey(base);
    const changed = await createTranslationCacheKey({
      ...base,
      segments: [{ id: 'one', text: 'World' }],
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
    expect(changed).not.toBe(first);
  });
});
