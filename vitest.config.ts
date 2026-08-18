import { defineConfig } from 'vitest/config'

export default defineConfig({
  ssr: {
    resolve: {
      conditions: ['source', 'import', 'default'],
    },
  },
  test: {
    include: ['apps/**/{src,tests}/**/*.test.{ts,tsx}', 'packages/**/{src,tests}/**/*.test.ts'],
    passWithNoTests: true,
  },
})
