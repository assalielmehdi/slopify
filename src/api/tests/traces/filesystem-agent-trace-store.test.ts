import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { AgentTraceHeaderSchema } from '@slopify/shared'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createRunFilesystemAgentTraceStore,
  resolveNodeExecutionPaths,
  resolveSlopifyPaths,
} from '../../src/index.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

const createStore = () => {
  const home = mkdtempSync(join(tmpdir(), 'slopify-agent-traces-'))
  directories.push(home)
  const paths = resolveSlopifyPaths({ environment: { SLOPIFY_HOME: home } })
  const current = createRunFilesystemAgentTraceStore({ paths })
  const workflowId = 'workflow-01'
  const executionIndex = 2
  const tracePath = resolveNodeExecutionPaths(
    paths.run(workflowId, 'run-01'),
    executionIndex,
    'node-execution-01',
  ).traceFile
  return {
    root: home,
    tracePath,
    store: {
      start: (capturedHeader: typeof header) =>
        current.start({ workflowId, executionIndex, header: capturedHeader }),
      append: (capturedHeader: typeof header, event: Parameters<typeof current.append>[1]) =>
        current.append({ workflowId, executionIndex, header: capturedHeader }, event),
      read: (input: { runId: string; nodeExecutionId: string; attemptId: string }) =>
        current.read({ workflowId, executionIndex, ...input }),
    },
  }
}

const header = AgentTraceHeaderSchema.parse({
  version: 4,
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
    artifactsPath: '/workspace/run-01/artifacts',
    primaryRepositoryId: 'repository-api',
    repositories: [
      {
        repositoryId: 'repository-api',
        name: 'API',
        provider: 'GITHUB',
        fullName: 'operator/api',
        workspacePath: '/workspace/run-01/repository-api',
        branchName: 'slopify/run-01',
        baseSha: 'a'.repeat(40),
        defaultBranch: 'main',
      },
    ],
    timeoutSeconds: 600,
  },
})

describe('filesystem agent trace store', () => {
  it('writes an ordered JSONL trace with private filesystem permissions', async () => {
    const { store, tracePath } = createStore()

    await store.start(header)
    await store.append(header, {
      executionId: 'node-execution-01',
      runId: 'run-01',
      nodeId: 'identify-agent',
      timestamp: '2026-08-22T10:00:01.000Z',
      type: 'AGENT_REASONING',
      data: { messageId: 'reasoning-01', content: 'I should inspect the files.' },
    })
    await store.append(header, {
      executionId: 'node-execution-01',
      runId: 'run-01',
      nodeId: 'identify-agent',
      timestamp: '2026-08-22T10:00:02.000Z',
      type: 'AGENT_TOOL_STARTED',
      data: {
        toolCallId: 'tool-01',
        toolKind: 'READ',
        toolName: 'read',
        input: { path: '/workspace/README.md' },
      },
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
    expect(statSync(tracePath).mode & 0o777).toBe(0o600)
    expect(statSync(dirname(tracePath)).mode & 0o777).toBe(0o700)
    expect(readFileSync(tracePath, 'utf8').trim().split('\n')).toHaveLength(3)
  })

  it('marks terminal traces complete and ignores a malformed trailing line', async () => {
    const { store, tracePath } = createStore()
    await store.start(header)
    await store.append(header, {
      executionId: 'node-execution-01',
      runId: 'run-01',
      nodeId: 'identify-agent',
      timestamp: '2026-08-22T10:00:02.000Z',
      type: 'AGENT_FAILED',
      data: { code: 'AGENT_TIMEOUT', message: 'Timed out', durationMs: 2_000 },
    })
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
    const { store, tracePath } = createStore()
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

  it('upgrades legacy presentation events in memory without rewriting the journal', async () => {
    const { store, tracePath } = createStore()
    await store.start(header)
    const legacyEvents = [
      {
        sequence: 1,
        timestamp: '2026-08-22T10:00:01.000Z',
        type: 'AGENT_MESSAGE',
        data: {
          content: JSON.stringify({ summary: 'Inspecting the repository.', data: '{}' }),
        },
      },
      {
        sequence: 2,
        timestamp: '2026-08-22T10:00:02.000Z',
        type: 'AGENT_TOOL_STARTED',
        data: {
          toolCallId: 'command-01',
          toolName: 'command_execution',
          input: { command: '/bin/zsh -lc pwd' },
        },
      },
      {
        sequence: 3,
        timestamp: '2026-08-22T10:00:03.000Z',
        type: 'AGENT_TOOL_COMPLETED',
        data: {
          toolCallId: 'command-01',
          toolName: 'command_execution',
          status: 'succeeded',
          content: '/workspace/run-01',
        },
      },
      {
        sequence: 4,
        timestamp: '2026-08-22T10:00:04.000Z',
        type: 'AGENT_TOOL_STARTED',
        data: {
          toolCallId: 'mcp-01',
          toolName: 'mcp_tool_call',
          input: { server: 'clickup', tool: 'get_task', arguments: { taskId: 'TASK-1' } },
        },
      },
      {
        sequence: 5,
        timestamp: '2026-08-22T10:00:05.000Z',
        type: 'AGENT_TOOL_COMPLETED',
        data: {
          toolCallId: 'mcp-01',
          toolName: 'mcp_tool_call',
          status: 'succeeded',
          content: 'Task loaded',
        },
      },
    ]
    for (const event of legacyEvents) {
      appendFileSync(tracePath, `${JSON.stringify({ kind: 'event', event })}\n`)
    }
    const journal = readFileSync(tracePath, 'utf8')

    const trace = await store.read({
      runId: 'run-01',
      nodeExecutionId: 'node-execution-01',
      attemptId: 'attempt-01',
    })

    expect(trace.events).toMatchObject([
      {
        type: 'AGENT_MESSAGE',
        data: { messageId: 'legacy-message-1', content: 'Inspecting the repository.' },
      },
      {
        type: 'AGENT_TOOL_STARTED',
        data: { toolCallId: 'command-01', toolKind: 'COMMAND', toolName: 'bash' },
      },
      {
        type: 'AGENT_TOOL_COMPLETED',
        data: { toolCallId: 'command-01', toolKind: 'COMMAND', toolName: 'bash' },
      },
      {
        type: 'AGENT_TOOL_STARTED',
        data: { toolCallId: 'mcp-01', toolKind: 'MCP', toolName: 'clickup.get_task' },
      },
      {
        type: 'AGENT_TOOL_COMPLETED',
        data: { toolCallId: 'mcp-01', toolKind: 'MCP', toolName: 'clickup.get_task' },
      },
    ])
    expect(readFileSync(tracePath, 'utf8')).toBe(journal)
  })

  it('rejects identifiers that could escape the configured root', async () => {
    const { store } = createStore()

    await expect(
      store.read({ runId: '../outside', nodeExecutionId: 'node-01', attemptId: 'attempt-01' }),
    ).rejects.toMatchObject({ code: 'TRACE_REQUEST_INVALID' })
  })

  it('surfaces unavailable linked traces without following them', async () => {
    const { root, store, tracePath } = createStore()
    await store.start(header)
    const outside = join(root, 'outside.jsonl')
    writeFileSync(outside, 'owner-local data\n')
    rmSync(tracePath)
    symlinkSync(outside, tracePath)

    await expect(
      store.read({
        runId: 'run-01',
        nodeExecutionId: 'node-execution-01',
        attemptId: 'attempt-01',
      }),
    ).rejects.toMatchObject({ code: 'TRACE_UNAVAILABLE' })
  })

  it('colocates run traces and binds every event to captured execution context', async () => {
    const home = mkdtempSync(join(tmpdir(), 'slopify-run-agent-traces-'))
    directories.push(home)
    const paths = resolveSlopifyPaths({ environment: { SLOPIFY_HOME: home } })
    const store = createRunFilesystemAgentTraceStore({ paths })
    const context = { workflowId: 'workflow-01', executionIndex: 2, header }

    await store.start(context)
    await store.append(context, {
      executionId: 'node-execution-01',
      runId: 'run-01',
      nodeId: 'identify-agent',
      timestamp: '2026-08-22T10:00:01.000Z',
      type: 'AGENT_SKILL_INVOKED',
      data: {
        skillName: 'browser-testing',
        evidence: 'DERIVED',
        sourceToolCallId: 'tool-01',
      },
    })
    const runPaths = paths.run('workflow-01', 'run-01')
    const tracePath = resolveNodeExecutionPaths(runPaths, 2, 'node-execution-01').traceFile

    expect(existsSync(tracePath)).toBe(true)
    await expect(
      store.append(context, {
        executionId: 'different-execution',
        runId: 'run-01',
        nodeId: 'identify-agent',
        timestamp: '2026-08-22T10:00:02.000Z',
        type: 'AGENT_MESSAGE',
        data: { messageId: 'message-01', content: 'Wrong execution.' },
      }),
    ).rejects.toMatchObject({ code: 'TRACE_REQUEST_INVALID' })

    appendFileSync(tracePath, '{"kind":"event"')
    await store.append(context, {
      executionId: 'node-execution-01',
      runId: 'run-01',
      nodeId: 'identify-agent',
      timestamp: '2026-08-22T10:00:03.000Z',
      type: 'AGENT_MESSAGE',
      data: { messageId: 'message-01', content: 'Recovered after a partial write.' },
    })
    await expect(
      store.read({
        workflowId: 'workflow-01',
        executionIndex: 2,
        runId: 'run-01',
        nodeExecutionId: 'node-execution-01',
        attemptId: 'attempt-01',
      }),
    ).resolves.toMatchObject({
      events: [
        { type: 'AGENT_SKILL_INVOKED' },
        {
          type: 'AGENT_MESSAGE',
          data: { messageId: 'message-01', content: 'Recovered after a partial write.' },
        },
      ],
    })
    await expect(
      store.read({
        workflowId: 'workflow-01',
        executionIndex: 2,
        runId: 'run-01',
        nodeExecutionId: 'node-execution-01',
        attemptId: 'different-attempt',
      }),
    ).rejects.toMatchObject({ code: 'TRACE_NOT_FOUND' })
  })
})
