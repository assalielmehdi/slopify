import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: '../..',
  oxc: {
    jsx: {
      runtime: 'automatic',
    },
  },
  ssr: {
    resolve: {
      conditions: ['source', 'import', 'default'],
    },
  },
  test: {
    include: ['apps/web/tests/**/*.test.{ts,tsx}'],
    passWithNoTests: false,
  },
})
