import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'entrypoints/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
  },
});
