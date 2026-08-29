import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      'next/font/google': new URL('./src/web/tests/next-font-google.ts', import.meta.url).pathname,
      '@': new URL('./src/web/', import.meta.url).pathname,
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
    include: [
      'apps/**/{src,tests}/**/*.test.{ts,tsx}',
      'packages/**/{src,tests}/**/*.test.ts',
      'src/shared/tests/**/*.test.ts',
      'src/web/tests/**/*.test.{ts,tsx}',
    ],
    passWithNoTests: true,
  },
})
