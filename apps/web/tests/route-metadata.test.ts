import { describe, expect, it } from 'vitest'

import { metadata as rootMetadata } from '../app/layout'
import { metadata as workflowMetadata } from '../app/page'
import { generateMetadata as generateRunMetadata } from '../app/runs/[runId]/page'
import { metadata as newRunMetadata } from '../app/runs/new/page'
import { metadata as runHistoryMetadata } from '../app/runs/page'
import { metadata as settingsMetadata } from '../app/settings/page'

describe('accessible route metadata', () => {
  it('gives every core route a unique descriptive document title', async () => {
    expect(rootMetadata.title).toEqual({
      default: 'Slopify',
      template: '%s | Slopify',
    })
    expect(workflowMetadata.title).toBe('Workflow')
    expect(newRunMetadata.title).toBe('Start a run')
    expect(runHistoryMetadata.title).toBe('Run history')
    expect(settingsMetadata.title).toBe('Settings')
    await expect(
      generateRunMetadata({ params: Promise.resolve({ runId: 'run-42' }) }),
    ).resolves.toMatchObject({ title: 'Run run-42' })
  })
})
