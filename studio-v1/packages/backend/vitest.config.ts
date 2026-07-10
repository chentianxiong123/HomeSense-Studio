import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: [
      'src/modules/context-completer/index.test.ts',
      'src/modules/intent-router/index.test.ts',
      'src/modules/memory-kernel/semantic.test.ts',
      'src/modules/rerank-service/index.test.ts',
      '**/node_modules/**',
    ],
    environment: 'node',
    testTimeout: 10000,
  },
})
