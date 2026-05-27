import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/frontend/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
    },
  },
  resolve: {
    alias: {
      '@infrastructure': path.resolve(__dirname, './src/infrastructure'),
      '@agent-runtime': path.resolve(__dirname, './src/agent-runtime'),
      '@backend': path.resolve(__dirname, './src/backend'),
      '@domain-agents': path.resolve(__dirname, './src/domain-agents'),
    },
  },
});
