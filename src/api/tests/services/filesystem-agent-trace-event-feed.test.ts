import { AgentTraceSchema } from '@slopify/shared'
import { describe, expect, it, vi } from 'vitest'

import {
  AgentTraceStoreError,
  createFilesystemAgentTraceEventFeed,
  type FilesystemRunReader,
  type RunAgentTraceStore,
} from '../../src/index.js'

const trace = (complete: boolean, eventCount: number) =>
  AgentTraceSchema.parse({
    header: {
      version: 4,
      runId: 'run-01',
      nodeExecutionId: 'node-execution-01',
      attemptId: 'attempt-01',
      nodeId: 'review',
      createdAt: '2026-08-29T10:00:00.000Z',
      configuration: {
        harnessId: 'codex',
        harnessVersion: '0.149.1',
        renderedPrompt: 'Review the repository.',
        workspaceRoot: '/workspaces/run-01',
        artifactsPath: '/runs/run-01/artifacts',
        primaryRepositoryId: 'repository-api',
        repositories: [
          {
            repositoryId: 'repository-api',
            name: 'API',
            provider: 'GITHUB',
            fullName: 'operator/api',
            workspacePath: '/workspaces/run-01/repository-api',
            branchName: 'slopify/run-01',
            baseSha: 'a'.repeat(40),
            defaultBranch: 'main',
          },
        ],
        timeoutSeconds: 600,
      },
    },
    events: Array.from({ length: eventCount }, (_, index) => ({
      sequence: index + 1,
      timestamp: `2026-08-29T10:00:0${index + 1}.000Z`,
      type: index + 1 === eventCount && complete ? 'AGENT_RESULT' : 'AGENT_REASONING',
      data:
        index + 1 === eventCount && complete
          ? {
              result: { outcome: 'done', summary: 'Done.', data: {}, evidence: [] },
              usage: {
                inputTokens: 1,
                outputTokens: 1,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
              },
              durationMs: 10,
            }
          : { messageId: 'reasoning-01', content: `Thought ${index + 1}` },
    })),
    complete,
  })

const reader = {
  get: vi.fn(async () => ({
    status: 'READY' as const,
    run: { workflowId: 'workflow-01' },
    executions: [
      {
        nodeExecutionId: 'node-execution-01',
        attemptId: 'attempt-01',
        executionIndex: 2,
      },
    ],
  })),
} as unknown as Pick<FilesystemRunReader, 'get'>

const collect = async <Value>(source: AsyncIterable<Value>): Promise<Value[]> => {
  const values: Value[] = []
  for await (const value of source) values.push(value)
  return values
}

describe('filesystem agent trace event feed', () => {
  it('resumes after the client cursor, polls for new events, and closes on completion', async () => {
    let current = trace(false, 1)
    const traces = {
      read: vi.fn(async () => current),
    } as unknown as Pick<RunAgentTraceStore, 'read'>
    const wait = vi.fn(async () => {
      current = trace(true, 3)
    })
    const feed = createFilesystemAgentTraceEventFeed({ reader, traces, wait })

    const events = await collect(
      feed.subscribe({
        runId: 'run-01',
        nodeExecutionId: 'node-execution-01',
        attemptId: 'attempt-01',
        afterSequence: 1,
      }),
    )

    expect(events.map(({ sequence }) => sequence)).toEqual([2, 3])
    expect(wait).toHaveBeenCalledOnce()
    expect(traces.read).toHaveBeenLastCalledWith({
      workflowId: 'workflow-01',
      executionIndex: 2,
      runId: 'run-01',
      nodeExecutionId: 'node-execution-01',
      attemptId: 'attempt-01',
    })
  })

  it('rejects an invalid cursor or unknown captured execution', async () => {
    const traces = {
      read: vi.fn(async () => trace(true, 1)),
    } as unknown as Pick<RunAgentTraceStore, 'read'>
    const feed = createFilesystemAgentTraceEventFeed({ reader, traces })

    expect(() =>
      feed.subscribe({
        runId: 'run-01',
        nodeExecutionId: 'node-execution-01',
        attemptId: 'attempt-01',
        afterSequence: -1,
      }),
    ).toThrow(expect.objectContaining({ code: 'TRACE_REQUEST_INVALID' }))
    await expect(
      collect(
        feed.subscribe({
          runId: 'run-01',
          nodeExecutionId: 'missing',
          attemptId: 'attempt-01',
        }),
      ),
    ).rejects.toEqual(
      new AgentTraceStoreError('TRACE_NOT_FOUND', 'Agent trace was not found'),
    )
  })
})
