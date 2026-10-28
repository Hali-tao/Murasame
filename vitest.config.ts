import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  test: {
    // Keep native model/packaging checks reliable alongside the Docker desktop.
    maxWorkers: 4,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/main/core/**/*.ts', 'src/shared/**/*.ts']
    }
  }
})
