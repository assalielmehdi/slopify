import { describe, expect, it } from 'vitest'

import {
  createExecutorRegistry,
  createLoadClickUpTaskExecutor,
  createNodeExecutorJobRunner,
} from '../../src/index.js'
import { TEST_RUN_ID, createPersistenceFixture, createRun } from '../persistence/test-fixture.js'

describe('node executor job runner', () => {
  it('adapts a registered deterministic executor without interpreting graph edges', async () => {
    const fixture = createPersistenceFixture()
    try {
      createRun(fixture, fixture.revision)
      const runner = createNodeExecutorJobRunner({
        runs: fixture.runs,
        executors: createExecutorRegistry({
          commands: { 'load-clickup-task': createLoadClickUpTaskExecutor() },
        }),
      })

      await expect(
        runner.run(
          {
            runId: TEST_RUN_ID,
            nodeExecutionId: 'node-execution-load',
            attemptId: 'attempt-load',
            nodeId: 'load-clickup-task',
          },
          async () => undefined,
        ),
      ).resolves.toMatchObject({
        status: 'succeeded',
        outcome: 'loaded',
        output: { taskReference: 'TASK-1' },
      })
    } finally {
      fixture.cleanup()
    }
  })
})
