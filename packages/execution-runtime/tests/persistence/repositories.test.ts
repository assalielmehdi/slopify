import { afterEach, describe, expect, it } from 'vitest'

import { PersistenceError } from '../../src/index.js'
import { getDatabaseHandle } from '../../src/persistence/database.js'
import {
  TEST_PROFILE,
  TEST_RUN_ID,
  TEST_TIMESTAMP,
  createPersistenceFixture,
  createRun,
} from './test-fixture.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

describe('workflow and profile repositories', () => {
  it('round-trips immutable workflow revisions', () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)

    expect(
      fixture.workflows.getRevision({
        workflowId: fixture.revision.workflowId,
        revisionId: fixture.revision.revisionId,
      }),
    ).toEqual(fixture.revision)
    expect(() => fixture.workflows.addRevision(fixture.revision)).toThrowError(
      expect.objectContaining({ code: 'PERSISTENCE_CONFLICT' }),
    )
  })

  it('keeps a profile snapshot unchanged and in its original canonical order', () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)

    fixture.profiles.save(
      {
        ...TEST_PROFILE,
        displayName: 'Changed profile',
        repositories: [...TEST_PROFILE.repositories].reverse(),
      },
      '2026-08-18T21:00:00Z',
    )

    const snapshot = fixture.profiles.getSnapshot(fixture.snapshot.snapshotId)
    expect(snapshot).toEqual(fixture.snapshot)
    expect(snapshot?.repositories.map(({ repositoryId }) => repositoryId)).toEqual([
      'api',
      'web',
      'docs',
    ])
  })
})

describe('run repository transactions', () => {
  it('stores exact run snapshots independently from caller mutation', () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    const effectiveConfiguration = {
      provider: 'test-provider',
      nodes: { plan: { model: 'test-model' } },
    }

    createRun(fixture, effectiveConfiguration)
    effectiveConfiguration.nodes.plan.model = 'mutated-after-create'

    expect(fixture.runs.get(TEST_RUN_ID)).toMatchObject({
      taskSnapshot: { id: 'TASK-1', name: 'Implement persistence' },
      effectiveConfiguration: {
        provider: 'test-provider',
        nodes: { plan: { model: 'test-model' } },
      },
      status: 'PENDING',
    })
  })

  it('rolls back a run state change when its event cannot be persisted', () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    createRun(fixture)
    const connection = getDatabaseHandle(fixture.database)
    connection.exec(`
      CREATE TRIGGER reject_status_event
      BEFORE INSERT ON run_events
      WHEN NEW.event_type = 'RUN_STATUS_CHANGED'
      BEGIN
        SELECT RAISE(ABORT, 'planned event failure');
      END;
    `)

    expect(() =>
      fixture.runs.changeStatus({
        runId: TEST_RUN_ID,
        expectedStatus: 'PENDING',
        status: 'RUNNING',
        timestamp: '2026-08-18T20:00:01Z',
      }),
    ).toThrowError(expect.objectContaining({ code: 'PERSISTENCE_WRITE_FAILED' }))

    expect(fixture.runs.get(TEST_RUN_ID)?.status).toBe('PENDING')
    expect(fixture.events.list({ runId: TEST_RUN_ID, limit: 20 }).events).toHaveLength(1)
  })

  it('stores selections and partial evidence in canonical profile order', () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    createRun(fixture)

    fixture.runs.selectRepositories({
      runId: TEST_RUN_ID,
      selectedAt: '2026-08-18T20:00:02Z',
      selection: {
        selected: [
          {
            repositoryId: 'docs',
            rationale: 'The runbook documents the endpoint',
            responsibility: 'Update runbook',
          },
          {
            repositoryId: 'api',
            rationale: 'The endpoint is owned here',
            responsibility: 'Implement endpoints',
          },
        ],
        excluded: [{ repositoryId: 'web', rationale: 'No UI change is required' }],
      },
    })
    fixture.runs.upsertDeliveryEvidence({
      runId: TEST_RUN_ID,
      repositoryId: 'docs',
      status: 'FAILED',
      evidence: { failure: 'push rejected' },
      updatedAt: '2026-08-18T20:00:04Z',
    })
    fixture.runs.upsertDeliveryEvidence({
      runId: TEST_RUN_ID,
      repositoryId: 'api',
      status: 'VERIFIED',
      gitlabProject: 'group/api',
      mergeRequestIid: 12,
      mergeRequestUrl: 'https://gitlab.example/group/api/-/merge_requests/12',
      sourceBranch: 'ai/task-1-run-01',
      targetBranch: 'main',
      headSha: '0123456789abcdef',
      evidence: { verified: true },
      updatedAt: '2026-08-18T20:00:03Z',
    })

    expect(fixture.runs.listSelections(TEST_RUN_ID)).toEqual([
      {
        repositoryId: 'api',
        profilePosition: 0,
        rationale: 'The endpoint is owned here',
        responsibility: 'Implement endpoints',
      },
      {
        repositoryId: 'docs',
        profilePosition: 2,
        rationale: 'The runbook documents the endpoint',
        responsibility: 'Update runbook',
      },
    ])
    expect(fixture.runs.getRepositorySelection(TEST_RUN_ID)).toEqual({
      selected: [
        {
          repositoryId: 'api',
          rationale: 'The endpoint is owned here',
          responsibility: 'Implement endpoints',
        },
        {
          repositoryId: 'docs',
          rationale: 'The runbook documents the endpoint',
          responsibility: 'Update runbook',
        },
      ],
      excluded: [{ repositoryId: 'web', rationale: 'No UI change is required' }],
    })
    expect(
      fixture.runs.listDeliveryEvidence(TEST_RUN_ID).map(({ repositoryId, status }) => ({
        repositoryId,
        status,
      })),
    ).toEqual([
      { repositoryId: 'api', status: 'VERIFIED' },
      { repositoryId: 'docs', status: 'FAILED' },
    ])
  })

  it('rejects a repository outside the immutable profile snapshot without partial writes', () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    createRun(fixture)

    expect(() =>
      fixture.runs.selectRepositories({
        runId: TEST_RUN_ID,
        selectedAt: TEST_TIMESTAMP,
        selection: {
          selected: [
            {
              repositoryId: 'api',
              rationale: 'API change',
              responsibility: 'Implement endpoints',
            },
            {
              repositoryId: 'unknown',
              rationale: 'Invalid candidate',
              responsibility: 'Must fail',
            },
          ],
          excluded: [
            { repositoryId: 'web', rationale: 'No UI change' },
            { repositoryId: 'docs', rationale: 'No documentation change' },
          ],
        },
      }),
    ).toThrowError(expect.objectContaining({ code: 'PERSISTENCE_VALIDATION_FAILED' }))
    expect(fixture.runs.listSelections(TEST_RUN_ID)).toEqual([])
  })

  it('uses stable persistence errors for state conflicts', () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    createRun(fixture)

    try {
      fixture.runs.changeStatus({
        runId: TEST_RUN_ID,
        expectedStatus: 'RUNNING',
        status: 'FAILED',
        timestamp: TEST_TIMESTAMP,
      })
      expect.unreachable('Expected a persistence conflict')
    } catch (error) {
      expect(error).toBeInstanceOf(PersistenceError)
      expect(error).toMatchObject({ code: 'PERSISTENCE_CONFLICT' })
    }
  })
})
