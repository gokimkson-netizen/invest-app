import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { alias: { '@core': new URL('./packages/core/src', import.meta.url).pathname, '@config': new URL('./config', import.meta.url).pathname } },
  test: { include: ['packages/core/test/**/*.test.ts', 'worker/test/**/*.test.ts', 'web/test/**/*.test.ts'], environment: 'node' },
});
