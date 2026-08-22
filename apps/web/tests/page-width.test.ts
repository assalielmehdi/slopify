import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const pageShellSources = [
  'components/runs/live-run.tsx',
  'components/runs/run-history.tsx',
  'components/runs/start-run-form.tsx',
  'components/skills/skills-manager.tsx',
] as const

describe('page width', () => {
  it.each(pageShellSources)('%s uses the full shared main-content width', (sourcePath) => {
    const source = readFileSync(resolve(import.meta.dirname, '..', sourcePath), 'utf8')

    expect(source).not.toMatch(/className="[^"]*\bmx-auto\b[^"]*\bmax-w-(?:5xl|6xl|7xl)\b/)
  })
})
