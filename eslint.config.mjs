import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores([
    '**/.next/**',
    '**/.turbo/**',
    '**/coverage/**',
    '**/dist/**',
    '**/next-env.d.ts',
    '**/node_modules/**',
  ]),
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended],
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [tseslint.configs.strict, tseslint.configs.stylistic],
  },
])
