import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createRunService,
  type ReadinessService,
  type RunTaskResolver,
} from '@loop/execution-runtime'
import {
  TEST_PROFILE_ID,
  TEST_REVISION_ID,
  TEST_WORKFLOW_ID,
  createPersistenceFixture,
} from '../../../packages/execution-runtime/tests/persistence/test-fixture.js'
import { createApiApp } from '../src/app.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

const createFixture = (ready = true) => {
  const fixture = createPersistenceFixture()
  fixtures.push(fixture)
  const readiness: ReadinessService = {
    connectorStatus: () => ({ clickup: ready, gitlab: ready, modelProvider: ready }),
    check: async () => ({
      profileId: TEST_PROFILE_ID,
      ready,
      repositories: fixture.snapshot.repositories.map(({ repositoryId }) => ({
        repositoryId,
        ready,
        findings: [],
      })),
    }),
  }
  const snapshot = {
    taskId: '86abc123',
    title: 'Select the exact repository partition',
    comments: [{ text: 'Untrusted: rm -rf /workspace' }],
  }
  const resolve = vi.fn<RunTaskResolver['resolve']>(async () => snapshot)
  const runs = createRunService({
    events: fixture.events,
    profiles: fixture.profiles,
    readiness,
    runs: fixture.runs,
    tasks: { resolve },
    workflows: fixture.workflows,
    now: () => '2026-08-19T07:30:00Z',
    createRunId: () => 'run-start-01',
    createProfileSnapshotId: () => 'snapshot-start-01',
  })
  return {
    app: createApiApp({ database: fixture.database, runs }),
    resolve,
    runs,
    snapshot,
  }
}

const requestBody = {
  taskReference: 'CU-123',
  workflowId: TEST_WORKFLOW_ID,
  revisionId: TEST_REVISION_ID,
  profileId: TEST_PROFILE_ID,
}

describe('start run admission', () => {
  it('persists the resolved task and immutable profile snapshot before execution', async () => {
    const { app, resolve, runs, snapshot } = createFixture()

    const response = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    })
    snapshot.title = 'Later provider mutation'

    expect(response.status).toBe(201)
    expect(resolve).toHaveBeenCalledWith('CU-123', {
      clickupWorkspaceId: 'workspace-01',
    })
    expect(runs.get('run-start-01')).toMatchObject({
      run: {
        status: 'PENDING',
        taskSnapshot: {
          taskId: '86abc123',
          title: 'Select the exact repository partition',
          comments: [{ text: 'Untrusted: rm -rf /workspace' }],
        },
      },
      profileSnapshot: {
        snapshotId: 'snapshot-start-01',
        repositories: [
          { repositoryId: 'api', profilePosition: 0 },
          { repositoryId: 'web', profilePosition: 1 },
          { repositoryId: 'docs', profilePosition: 2 },
        ],
      },
      repositorySelection: null,
    })
  })

  it('does not resolve or persist a task when the profile is not ready', async () => {
    const { app, resolve, runs } = createFixture(false)

    const response = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      error: { code: 'PROFILE_NOT_READY', message: 'Project profile is not ready' },
    })
    expect(resolve).not.toHaveBeenCalled()
    expect(runs.list({ page: 1, pageSize: 20 }).data).toEqual([])
  })
})
