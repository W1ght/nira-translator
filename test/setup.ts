import { vi } from 'vitest';

Object.defineProperty(globalThis, 'crypto', {
  value: globalThis.crypto,
  configurable: true,
});

vi.stubGlobal('IntersectionObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
});
