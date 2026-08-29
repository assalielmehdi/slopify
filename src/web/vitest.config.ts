import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: '../..',
  resolve: {
    alias: {
      'next/font/google': new URL('./tests/next-font-google.ts', import.meta.url).pathname,
      '@': new URL('.', import.meta.url).pathname,
    },
  },
  oxc: {
    jsx: {
      runtime: 'automatic',
    },
  },
  ssr: {
    noExternal: ['zod'],
    resolve: {
      conditions: ['source', 'import', 'default'],
    },
  },
  test: {
    include: ['src/web/tests/**/*.test.{ts,tsx}'],
    passWithNoTests: false,
  },
})
