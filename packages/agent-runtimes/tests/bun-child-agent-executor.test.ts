import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AgentExecutionEventSchema,
  AgentExecutionInputSchema,
  createBunChildAgentExecutor,
  type BunWorkerProcess,
  type BunWorkerSpawnInput,
  type BunWorkerSpawner,
  type WorkerCredentialStore,
} from '../src/index.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const input = AgentExecutionInputSchema.parse({
  executionId: 'execution-01',
  runId: 'run-01',
  nodeId: 'agent-01',
  workspace: {
    rootPath: '/tmp/run-01',
    repositories: [
      { repositoryId: 'repo-01', path: '/tmp/run-01/repo-01', access: 'workspace-write' },
    ],
  },
  provider: 'openrouter',
  model: 'openai/gpt-5.4',
  thinkingLevel: 'medium',
  permissionProfile: 'workspace-write',
  renderedPrompt: 'Do the configured job.',
  declaredOutcomes: ['done'],
  resourceBundleId: 'execution-skills',
  timeoutSeconds: 60,
})

const context = {
  outputSchemaRef: 'json:any-v1',
  inferenceConnectionId: 'openrouter-main',
  resourceBundle: {
    bundleId: 'execution-skills',
    applicationVersion: '1',
    skills: [],
    promptFragments: [],
    contextFiles: [],
  },
  skills: [],
  connectors: [
    {
      connectionId: 'gitlab-main',
      type: 'gitlab' as const,
      authority: 'GitLab API access',
      allowedHosts: ['gitlab.com'],
    },
  ],
}

const createFakeSpawner = () => {
  let spawned: BunWorkerSpawnInput | undefined
  let resolveExit: ((code: number) => void) | undefined
  const sent: unknown[] = []
  const process: BunWorkerProcess = {
    pid: 41_001,
    exited: new Promise((resolve) => {
      resolveExit = resolve
    }),
    send(message) {
      sent.push(structuredClone(message))
    },
    kill: vi.fn(),
    disconnect: vi.fn(),
  }
  const spawner: BunWorkerSpawner = {
    spawn(value) {
      spawned = value
      return process
    },
  }
  return {
    spawner,
    process,
    sent,
    spawned: () => spawned,
    message: (message: unknown) => spawned?.onMessage(message),
    exit: (code = 0) => {
      resolveExit?.(code)
      spawned?.onExit(code)
    },
  }
}

describe('Bun child agent executor', () => {
  it('sends only non-secret execution data initially and serves allowed credentials over IPC', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'slopify-bun-worker-test-'))
    directories.push(directory)
    const fake = createFakeSpawner()
    const credentials: WorkerCredentialStore = {
      read: vi.fn(async (connectionId) =>
        connectionId === 'gitlab-main'
          ? { type: 'api_key', key: 'gitlab-secret-value' }
          : { type: 'api_key', key: 'model-secret-value' },
      ),
      modify: vi.fn(async (_connectionId, update) => update(undefined)),
    }
    const executor = createBunChildAgentExecutor({
      childScriptPath: '/application/bun-agent-worker.js',
      credentials,
      resolveContext: async () => context,
      spawner: fake.spawner,
      createExecutionDirectory: async () => directory,
    })
    const events = executor.execute(input)[Symbol.asyncIterator]()
    const nextEvent = events.next()
    const initial = await vi.waitFor(() => {
      expect(fake.sent).toHaveLength(1)
      return fake.sent[0]
    })

    expect(JSON.stringify(initial)).not.toContain('gitlab-secret-value')
    expect(JSON.stringify(initial)).not.toContain('model-secret-value')
    expect(fake.spawned()?.environment).toEqual(
      expect.objectContaining({ HOME: directory, TMPDIR: directory }),
    )
    expect(JSON.stringify(fake.spawned()?.environment)).not.toContain('secret-value')

    fake.message({
      version: 1,
      type: 'CREDENTIAL_READ',
      requestId: 'request-01',
      connectionId: 'gitlab-main',
    })
    await vi.waitFor(() => expect(fake.sent).toHaveLength(2))
    expect(fake.sent[1]).toMatchObject({
      type: 'CREDENTIAL_VALUE',
      requestId: 'request-01',
      credential: { type: 'api_key', key: 'gitlab-secret-value' },
    })

    fake.message({
      version: 1,
      type: 'EVENT',
      event: AgentExecutionEventSchema.parse({
        executionId: input.executionId,
        runId: input.runId,
        nodeId: input.nodeId,
        timestamp: '2026-08-20T12:00:00.000Z',
        type: 'AGENT_CANCELLED',
        data: { reason: 'Finished test', durationMs: 1 },
      }),
    })
    fake.message({ version: 1, type: 'COMPLETE' })
    fake.exit()
    await expect(nextEvent).resolves.toMatchObject({ value: { type: 'AGENT_CANCELLED' } })
  })

  it('rejects a credential request that is not granted to this execution', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'slopify-bun-worker-test-'))
    directories.push(directory)
    const fake = createFakeSpawner()
    const credentials: WorkerCredentialStore = {
      read: vi.fn(async () => ({ type: 'api_key', key: 'other-secret' })),
      modify: vi.fn(async (_connectionId, update) => update(undefined)),
    }
    const executor = createBunChildAgentExecutor({
      childScriptPath: '/application/bun-agent-worker.js',
      credentials,
      resolveContext: async () => context,
      spawner: fake.spawner,
      createExecutionDirectory: async () => directory,
    })
    const iterator = executor.execute(input)[Symbol.asyncIterator]()
    const nextEvent = iterator.next()
    await vi.waitFor(() => expect(fake.sent).toHaveLength(1))

    fake.message({
      version: 1,
      type: 'CREDENTIAL_READ',
      requestId: 'request-02',
      connectionId: 'clickup-not-granted',
    })
    await vi.waitFor(() => expect(fake.sent).toHaveLength(2))
    expect(fake.sent[1]).toEqual({
      version: 1,
      type: 'CREDENTIAL_ERROR',
      requestId: 'request-02',
      code: 'CREDENTIAL_NOT_GRANTED',
    })
    expect(credentials.read).not.toHaveBeenCalled()

    fake.exit(1)
    await nextEvent
  })

  it('reports cancellation only after child cleanup is acknowledged and the process exits', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'slopify-bun-worker-test-'))
    directories.push(directory)
    const fake = createFakeSpawner()
    const executor = createBunChildAgentExecutor({
      childScriptPath: '/application/bun-agent-worker.js',
      credentials: {
        read: async () => ({ type: 'api_key', key: 'model-secret-value' }),
        modify: async (_connectionId, update) => update(undefined),
      },
      resolveContext: async () => context,
      spawner: fake.spawner,
      createExecutionDirectory: async () => directory,
      cancellationGraceMs: 100,
    })
    const iterator = executor.execute(input)[Symbol.asyncIterator]()
    const nextEvent = iterator.next()
    await vi.waitFor(() => expect(fake.sent).toHaveLength(1))

    const cancellation = executor.cancel(input.executionId)
    await vi.waitFor(() =>
      expect(fake.sent).toContainEqual({
        version: 1,
        type: 'CANCEL',
        reason: 'Cancellation requested',
      }),
    )
    fake.message({ version: 1, type: 'CANCELLED', cleanupConfirmed: true })
    fake.exit()

    await expect(cancellation).resolves.toEqual({ status: 'cancelled' })
    expect(fake.process.kill).not.toHaveBeenCalled()
    await nextEvent
  })
})
