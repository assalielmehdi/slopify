import { afterEach, describe, expect, it } from 'vitest'

import { createEventStore, createRunRepository, openDatabase } from '../../src/index.js'
import { TEST_RUN_ID, createPersistenceFixture, createRun } from './test-fixture.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

describe('ordered run events', () => {
  it('assigns gap-free per-run sequences across lifecycle, output, and artifact writes', () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    createRun(fixture)

    fixture.runs.changeStatus({
      runId: TEST_RUN_ID,
      expectedStatus: 'PENDING',
      status: 'RUNNING',
      timestamp: '2026-08-18T20:00:01Z',
    })
    fixture.runs.startNode({
      runId: TEST_RUN_ID,
      nodeExecutionId: 'node-execution-01',
      nodeId: 'load-clickup-task',
      inputReferences: [],
      timestamp: '2026-08-18T20:00:02Z',
    })
    fixture.runs.recordOutput({
      runId: TEST_RUN_ID,
      nodeExecutionId: 'node-execution-01',
      nodeId: 'load-clickup-task',
      channel: 'stdout',
      content: 'Task loaded',
      timestamp: '2026-08-18T20:00:03Z',
    })
    fixture.runs.recordArtifact({
      artifactId: 'artifact-01',
      runId: TEST_RUN_ID,
      nodeExecutionId: 'node-execution-01',
      nodeId: 'load-clickup-task',
      artifactType: 'EXECUTION_PLAN',
      content: '# Plan',
      metadata: { source: 'local' },
      timestamp: '2026-08-18T20:00:04Z',
    })
    fixture.runs.completeNode({
      runId: TEST_RUN_ID,
      nodeExecutionId: 'node-execution-01',
      nodeId: 'load-clickup-task',
      outcome: 'loaded',
      durationMs: 2_000,
      artifactIds: ['artifact-01'],
      output: { status: 'succeeded', outcome: 'loaded' },
      timestamp: '2026-08-18T20:00:05Z',
    })

    const events = fixture.events.list({ runId: TEST_RUN_ID, limit: 20 }).events
    expect(events.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4, 5, 6])
    expect(events.map(({ type }) => type)).toEqual([
      'RUN_STARTED',
      'RUN_STATUS_CHANGED',
      'NODE_STARTED',
      'NODE_OUTPUT',
      'ARTIFACT_RECORDED',
      'NODE_COMPLETED',
    ])
    expect(fixture.runs.listOutputChunks(TEST_RUN_ID)).toEqual([
      expect.objectContaining({ sequence: 1, content: 'Task loaded', channel: 'stdout' }),
    ])
    expect(fixture.runs.listArtifacts(TEST_RUN_ID)).toEqual([
      expect.objectContaining({ artifactId: 'artifact-01', content: '# Plan' }),
    ])
  })

  it('paginates persisted sequences after closing and reopening the database', () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    createRun(fixture)
    fixture.runs.changeStatus({
      runId: TEST_RUN_ID,
      expectedStatus: 'PENDING',
      status: 'RUNNING',
      timestamp: '2026-08-18T20:00:01Z',
    })
    fixture.runs.startNode({
      runId: TEST_RUN_ID,
      nodeExecutionId: 'node-execution-01',
      nodeId: 'load-clickup-task',
      inputReferences: [],
      timestamp: '2026-08-18T20:00:02Z',
    })
    fixture.database.close()

    const reopenedDatabase = openDatabase({ path: fixture.path })
    const reopenedEvents = createEventStore(reopenedDatabase)
    const reopenedRuns = createRunRepository(reopenedDatabase)
    reopenedRuns.recordOutput({
      runId: TEST_RUN_ID,
      nodeExecutionId: 'node-execution-01',
      nodeId: 'load-clickup-task',
      channel: 'agent',
      content: 'resumed inspection only',
      timestamp: '2026-08-18T20:00:03Z',
    })

    const first = reopenedEvents.list({ runId: TEST_RUN_ID, limit: 2 })
    const second = reopenedEvents.list({
      runId: TEST_RUN_ID,
      afterSequence: first.nextAfterSequence ?? 0,
      limit: 2,
    })

    expect(first.events.map(({ sequence }) => sequence)).toEqual([1, 2])
    expect(first.nextAfterSequence).toBe(2)
    expect(second.events.map(({ sequence }) => sequence)).toEqual([3, 4])
    expect(second.nextAfterSequence).toBeNull()
    reopenedDatabase.close()
  })

  it('rejects invalid pagination before querying SQLite', () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)

    expect(() => fixture.events.list({ runId: TEST_RUN_ID, limit: 0 })).toThrowError(
      expect.objectContaining({ code: 'PERSISTENCE_VALIDATION_FAILED' }),
    )
  })
})
