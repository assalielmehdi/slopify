import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { metadata as rootMetadata } from '../app/layout'
import { metadata as harnessesMetadata } from '../app/harnesses/page'
import { metadata as workflowMetadata } from '../app/page'
import { metadata as projectsMetadata } from '../app/projects/page'
import { generateMetadata as generateRunMetadata } from '../app/runs/[runId]/page'
import { metadata as newRunMetadata } from '../app/runs/new/page'
import { metadata as runHistoryMetadata } from '../app/runs/page'
import { metadata as settingsMetadata } from '../app/settings/page'

describe('accessible route metadata', () => {
  it('provides every configuration destination as a route', () => {
    for (const route of ['harnesses', 'projects', 'settings']) {
      expect(existsSync(resolve(import.meta.dirname, '..', 'app', route, 'page.tsx'))).toBe(true)
    }
  })

  it('gives every core route a unique descriptive document title', async () => {
    expect(rootMetadata.title).toEqual({
      default: 'Slopify',
      template: '%s | Slopify',
    })
    expect(workflowMetadata.title).toBe('Editor')
    expect(newRunMetadata.title).toBe('Start a run')
    expect(runHistoryMetadata.title).toBe('Runs')
    expect(settingsMetadata.title).toBe('Settings')
    expect(harnessesMetadata.title).toBe('Harnesses')
    expect(projectsMetadata.title).toBe('Projects')
    await expect(
      generateRunMetadata({ params: Promise.resolve({ runId: 'run-42' }) }),
    ).resolves.toMatchObject({ title: 'Run 42' })
  })
})
