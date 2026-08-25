import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AgentTraceHeaderSchema } from '@slopify/contracts'
import { afterEach, describe, expect, it } from 'vitest'

import { createFilesystemAgentTraceStore } from '../../src/index.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

const createStore = () => {
  const root = mkdtempSync(join(tmpdir(), 'slopify-agent-traces-'))
  directories.push(root)
  return { root, store: createFilesystemAgentTraceStore({ root }) }
}

const header = AgentTraceHeaderSchema.parse({
  version: 1,
  runId: 'run-01',
  nodeExecutionId: 'node-execution-01',
  attemptId: 'attempt-01',
  nodeId: 'identify-agent',
  createdAt: '2026-08-22T10:00:00.000Z',
  configuration: {
    harnessId: 'pi',
    harnessVersion: '0.84.2',
    model: 'test/model',
    thinkingLevel: 'medium',
    renderedPrompt: 'Inspect the repository.',
    workspaceRoot: '/workspace/run-01',
    primaryRepositoryId: 'repository-api',
    repositories: [
      {
        repositoryId: 'repository-api',
        name: 'API',
        worktreePath: '/workspace/run-01/repository-api',
        baseSha: 'a'.repeat(40),
        sourceBranch: 'main',
      },
    ],
    timeoutSeconds: 600,
  },
})

describe('filesystem agent trace store', () => {
  it('writes an ordered JSONL trace with private filesystem permissions', async () => {
    const { root, store } = createStore()

    await store.start(header)
    await store.append(header, {
      executionId: 'node-execution-01',
      runId: 'run-01',
      nodeId: 'identify-agent',
      timestamp: '2026-08-22T10:00:01.000Z',
      type: 'AGENT_REASONING',
      data: { content: 'I should inspect the files.' },
    })
    await store.append(header, {
      executionId: 'node-execution-01',
      runId: 'run-01',
      nodeId: 'identify-agent',
      timestamp: '2026-08-22T10:00:02.000Z',
      type: 'AGENT_TOOL_STARTED',
      data: { toolCallId: 'tool-01', toolName: 'read', input: { path: '/workspace/README.md' } },
    })
    const trace = await store.read({
      runId: 'run-01',
      nodeExecutionId: 'node-execution-01',
      attemptId: 'attempt-01',
    })

    expect(trace).toEqual({
      header,
      events: [
        expect.objectContaining({ sequence: 1, type: 'AGENT_REASONING' }),
        expect.objectContaining({ sequence: 2, type: 'AGENT_TOOL_STARTED' }),
      ],
      complete: false,
    })
    const tracePath = join(
      root,
      'runs',
      'run-01',
      'executions',
      'node-execution-01',
      'attempt-01.jsonl',
    )
    expect(statSync(tracePath).mode & 0o777).toBe(0o600)
    expect(statSync(join(root, 'runs', 'run-01')).mode & 0o777).toBe(0o700)
    expect(readFileSync(tracePath, 'utf8').trim().split('\n')).toHaveLength(3)
  })

  it('marks terminal traces complete and ignores a malformed trailing line', async () => {
    const { root, store } = createStore()
    await store.start(header)
    await store.append(header, {
      executionId: 'node-execution-01',
      runId: 'run-01',
      nodeId: 'identify-agent',
      timestamp: '2026-08-22T10:00:02.000Z',
      type: 'AGENT_FAILED',
      data: { code: 'AGENT_TIMEOUT', message: 'Timed out', durationMs: 2_000 },
    })
    const tracePath = join(
      root,
      'runs',
      'run-01',
      'executions',
      'node-execution-01',
      'attempt-01.jsonl',
    )
    const { appendFileSync } = await import('node:fs')
    appendFileSync(tracePath, '{"kind":"event"')

    await expect(
      store.read({
        runId: 'run-01',
        nodeExecutionId: 'node-execution-01',
        attemptId: 'attempt-01',
      }),
    ).resolves.toMatchObject({ complete: true, events: [{ type: 'AGENT_FAILED' }] })
  })

  it('writes the complete redacted harness event payload to JSONL', async () => {
    const { root, store } = createStore()
    await store.start(header)
    const harnessEvent = {
      type: 'tool_execution_start',
      toolCallId: 'call_JkP9a|fc_72ZQ',
      toolName: 'bash',
      args: { command: 'pwd' },
    }
    await store.append(header, {
      executionId: 'node-execution-01',
      runId: 'run-01',
      nodeId: 'identify-agent',
      timestamp: '2026-08-22T10:00:02.000Z',
      type: 'HARNESS_EVENT',
      data: { harnessId: 'pi', event: harnessEvent },
    })

    const tracePath = join(
      root,
      'runs',
      'run-01',
      'executions',
      'node-execution-01',
      'attempt-01.jsonl',
    )
    const records = readFileSync(tracePath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    expect(records[1]).toEqual({
      kind: 'event',
      event: {
        sequence: 1,
        timestamp: '2026-08-22T10:00:02.000Z',
        type: 'HARNESS_EVENT',
        data: { harnessId: 'pi', event: harnessEvent },
      },
    })
  })

  it('rejects identifiers that could escape the configured root', async () => {
    const { store } = createStore()

    await expect(
      store.read({ runId: '../outside', nodeExecutionId: 'node-01', attemptId: 'attempt-01' }),
    ).rejects.toMatchObject({ code: 'TRACE_REQUEST_INVALID' })
  })
})
