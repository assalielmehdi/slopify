import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AgentExecutor, AgentExecutionInput } from '@slopify/contracts'
import {
  createProcessRunner,
  type FilesystemRunRepositoryResolution,
  type ProcessRunner,
} from '@slopify/execution-runtime'
import type { WorkflowFile } from '@slopify/workflow-model'
import { afterEach, describe, expect, it } from 'vitest'

import { createTestHarnessCatalog } from '../../../packages/execution-runtime/tests/persistence/test-fixture.js'
import { createApiApp } from '../src/app.js'
import { createFilesystemRuntime } from '../src/filesystem-runtime.js'

const timestamp = '2026-08-25T10:00:00.000Z'
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const temporaryDirectory = (name: string): string => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), `${name}-`)))
  directories.push(directory)
  return directory
}

const createRemote = () => {
  const parent = temporaryDirectory('slopify-api-runtime-remote')
  const source = join(parent, 'source')
  const remote = join(parent, 'api.git')
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', source])
  execFileSync('git', ['-C', source, 'config', 'user.email', 'test@slopify.local'])
  execFileSync('git', ['-C', source, 'config', 'user.name', 'Slopify Test'])
  writeFileSync(join(source, 'README.md'), 'api\n')
  execFileSync('git', ['-C', source, 'add', 'README.md'])
  execFileSync('git', ['-C', source, 'commit', '--quiet', '-m', 'initial'])
  execFileSync('git', ['clone', '--quiet', '--bare', source, remote])
  return {
    remote,
    baseSha: execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
  }
}

const localCloneRunner = (remote: string): ProcessRunner => {
  const native = createProcessRunner({ maxOutputBytes: 16_384 })
  return {
    run(input) {
      const arguments_ = input.arguments.includes('clone')
        ? input.arguments.map((argument) =>
            argument === 'https://github.com/operator/api.git' ? remote : argument,
          )
        : input.arguments
      return native.run({ ...input, arguments: arguments_ })
    },
  }
}

const workflow: WorkflowFile = {
  schemaVersion: 2,
  workflowId: 'runtime-review',
  name: 'Runtime review',
  description: 'Exercise the complete filesystem runtime.',
  repositories: {
    repositoryIds: ['repository-api'],
    primaryRepositoryId: 'repository-api',
  },
  variables: ['release'],
  graph: {
    startNodeId: 'review',
    nodes: [
      {
        type: 'agent',
        id: 'review',
        name: 'Review',
        prompt: 'Review {{ release }}.',
        harness: { harnessId: 'pi' },
      },
    ],
    edges: [],
    maxTransitions: 0,
  },
  createdAt: timestamp,
  updatedAt: timestamp,
}

const executor: AgentExecutor = {
  async *execute(input: AgentExecutionInput) {
    yield {
      executionId: input.executionId,
      runId: input.runId,
      nodeId: input.nodeId,
      timestamp,
      type: 'AGENT_RESULT',
      data: {
        result: {
          outcome: 'completed',
          summary: 'Reviewed the release.',
          data: { approved: true },
          evidence: [{ kind: 'test', value: 'Runtime fixture passed.' }],
        },
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
        durationMs: 1,
      },
    }
  },
  async cancel() {
    return { status: 'cancelled' }
  },
}

describe('filesystem runtime composition', () => {
  it('constructs and executes a complete runtime inside one temporary Slopify home', async () => {
    const home = temporaryDirectory('slopify-api-runtime-home')
    const remote = createRemote()
    const repository: FilesystemRunRepositoryResolution = {
      repositoryId: 'repository-api' as FilesystemRunRepositoryResolution['repositoryId'],
      name: 'API',
      provider: 'GITHUB',
      remoteId: '123',
      fullName: 'operator/api',
      cloneUrl: 'https://github.com/operator/api.git',
      webUrl: 'https://github.com/operator/api',
      defaultBranch: 'main',
      baseSha: remote.baseSha as FilesystemRunRepositoryResolution['baseSha'],
    }
    const runtime = createFilesystemRuntime({
      environment: { SLOPIFY_HOME: home },
      harnesses: createTestHarnessCatalog(),
      resolveHarness: (harnessId) => (harnessId === 'pi' ? executor : undefined),
      resolveRepository: async () => repository,
      processRunner: localCloneRunner(remote.remote),
      credentialHelper: '!bun /opt/slopify/git-credential-helper.js',
      now: () => timestamp,
      createRunId: () => 'run-runtime-1',
    })
    await runtime.workflowStore.create(workflow)
    const app = createApiApp(runtime.api)

    const admitted = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workflowId: 'runtime-review', variables: { release: 'v1.0.0' } }),
    })
    const locator = { workflowId: 'runtime-review', runId: 'run-runtime-1' }
    await runtime.coordinator.start(locator)
    await runtime.worker.drain([locator])
    const detail = await runtime.reader.get(locator.runId)

    expect(admitted.status).toBe(202)
    expect(detail).toMatchObject({
      status: 'READY',
      run: { status: 'SUCCEEDED' },
      executions: [{ executionIndex: 0, status: 'SUCCEEDED', outcome: 'completed' }],
    })
    if (detail?.status !== 'READY') throw new Error('Expected a readable run')
    const execution = detail.executions[0]
    if (execution === undefined) throw new Error('Expected one execution')
    await expect(
      runtime.traces.read({
        ...locator,
        executionIndex: execution.executionIndex,
        nodeExecutionId: execution.nodeExecutionId,
        attemptId: execution.attemptId,
      }),
    ).resolves.toMatchObject({ complete: true, events: [{ type: 'AGENT_RESULT' }] })
    expect(
      existsSync(runtime.paths.run(locator.workflowId, locator.runId).workspacesDirectory),
    ).toBe(true)
  })
})
