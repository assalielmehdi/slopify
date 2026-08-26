import { AgentTraceSchema } from '@slopify/contracts'
import type {
  FilesystemRunAdmissionService,
  FilesystemRunIndex,
  FilesystemRunReader,
  RunAgentTraceStore,
} from '@slopify/execution-runtime'
import { describe, expect, it, vi } from 'vitest'

import { createApiApp } from '../src/app.js'

const trace = AgentTraceSchema.parse({
  header: {
    version: 1,
    runId: 'run-01',
    nodeExecutionId: 'node-execution-01',
    attemptId: 'attempt-01',
    nodeId: 'identify-agent',
    createdAt: '2026-08-22T10:00:00.000Z',
    configuration: {
      harnessId: 'pi',
      harnessVersion: '0.84.2',
      model: 'openai/gpt-5.4',
      thinkingLevel: 'medium',
      renderedPrompt: 'Inspect the repository.',
      workspaceRoot: '/Users/developer/.slopify/orchestrator/workspaces/run-01',
      primaryRepositoryId: 'repository-api',
      repositories: [
        {
          repositoryId: 'repository-api',
          name: 'API',
          worktreePath: '/Users/developer/.slopify/orchestrator/worktrees/run-01/repository-api',
          baseSha: '1111111111111111111111111111111111111111',
          sourceBranch: 'main',
        },
      ],
      timeoutSeconds: 600,
    },
  },
  events: [
    {
      sequence: 1,
      timestamp: '2026-08-22T10:00:01.000Z',
      type: 'AGENT_REASONING',
      data: { content: 'Inspect the files first.' },
    },
  ],
  complete: false,
})

describe('filesystem agent trace API', () => {
  it('derives the run-local trace cursor from captured execution detail', async () => {
    const admissions = {
      stopAdmissions: vi.fn(),
      create: vi.fn(),
    } as unknown as FilesystemRunAdmissionService
    const index = {
      refresh: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
    } as unknown as FilesystemRunIndex
    const reader = {
      get: vi.fn(async () => ({
        status: 'READY',
        run: { runId: 'run-01', workflowId: 'workflow-01' },
        executions: [
          {
            nodeExecutionId: 'node-execution-01',
            attemptId: 'attempt-01',
            executionIndex: 2,
          },
        ],
      })),
    } as unknown as FilesystemRunReader
    const filesystemTraces = {
      read: vi.fn(async () => trace),
      start: vi.fn(),
      append: vi.fn(),
    } satisfies RunAgentTraceStore
    const app = createApiApp({
      filesystemRuns: { admissions, index, reader, traces: filesystemTraces },
    })

    const response = await app.request(
      '/api/runs/run-01/node-executions/node-execution-01/trace?attemptId=attempt-01',
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(trace)
    expect(filesystemTraces.read).toHaveBeenCalledWith({
      workflowId: 'workflow-01',
      executionIndex: 2,
      runId: 'run-01',
      nodeExecutionId: 'node-execution-01',
      attemptId: 'attempt-01',
    })
  })
})
