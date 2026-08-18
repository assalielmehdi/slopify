import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores([
    '.local/**',
    '**/.next/**',
    '**/coverage/**',
    '**/dist/**',
    '**/node_modules/**',
    '**/playwright-report/**',
    '**/test-results/**',
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
