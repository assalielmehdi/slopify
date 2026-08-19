import { afterEach, describe, expect, it } from 'vitest'

import { createLoadClickUpTaskExecutor } from '../../src/index.js'
import { TEST_RUN_ID, createPersistenceFixture, createRun } from '../persistence/test-fixture.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

const createContext = () => {
  const fixture = createPersistenceFixture()
  fixtures.push(fixture)
  createRun(fixture)
  const run = fixture.runs.get(TEST_RUN_ID)
  const node = fixture.revision.nodes.find(({ id }) => id === 'load-clickup-task')
  if (run === undefined || node?.type !== 'command') throw new Error('Load task fixture is invalid')
  return {
    run,
    workflow: fixture.revision,
    node,
    nodeExecutionId: 'node-execution-load-task-01',
    signal: new AbortController().signal,
  }
}

describe('load ClickUp task executor', () => {
  it('returns the immutable run snapshot without provider or command execution', async () => {
    const context = createContext()

    const result = await createLoadClickUpTaskExecutor().execute(context)

    expect(result).toEqual({
      status: 'succeeded',
      outcome: 'loaded',
      artifactIds: [],
      output: {
        taskReference: 'TASK-1',
        taskSnapshot: { id: 'TASK-1', name: 'Implement persistence' },
      },
    })
  })

  it('refuses a mismatched command node', async () => {
    const context = createContext()

    const result = await createLoadClickUpTaskExecutor().execute({
      ...context,
      node: { ...context.node, commandId: 'prepare-git-worktrees' },
    })

    expect(result).toEqual({
      status: 'failed',
      code: 'LOAD_TASK_CONTEXT_INVALID',
      message: 'Load task command does not match the workflow node',
    })
  })
})
