import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { WorkflowFile } from '@slopify/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  RunProjectionSchema,
  RunRepositoriesSnapshotSchema,
  RunVariablesSnapshotSchema,
  RunWorkflowSnapshotSchema,
  RunWorkspacesProjectionSchema,
  calculateResourceRevision,
  createAtomicJsonResourceIO,
  createFilesystemRunStore,
  resolveSlopifyPaths,
  type AtomicJsonResourceIO,
} from '../../src/index.js'

const directories: string[] = []
const timestamp = '2026-08-25T10:00:00.000Z'

const workflow: WorkflowFile = {
  schemaVersion: 3,
  workflowId: 'release-review',
  description: 'Review a release.',
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
        timeoutSeconds: 900,
      },
    ],
    edges: [],
    maxTransitions: 8,
  },
  createdAt: timestamp,
  updatedAt: timestamp,
}

const input = {
  runId: 'run-01',
  workflowId: 'release-review',
  createdAt: timestamp,
  workflowSnapshot: {
    schemaVersion: 1,
    capturedAt: timestamp,
    workflowRevision: calculateResourceRevision('workflow source'),
    workflow,
  },
  variablesSnapshot: { schemaVersion: 1, values: { release: 'v1.0.0' } },
  repositoriesSnapshot: {
    schemaVersion: 1,
    repositories: [
      {
        repositoryId: 'repository-api',
        position: 0,
        name: 'API',
        provider: 'GITHUB',
        remoteId: '123',
        fullName: 'operator/api',
        cloneUrl: 'https://github.com/operator/api.git',
        webUrl: 'https://github.com/operator/api',
        defaultBranch: 'main',
        baseSha: 'a'.repeat(40),
        isPrimary: true,
      },
    ],
  },
} as const

const createFixture = (resources?: AtomicJsonResourceIO) => {
  const home = mkdtempSync(join(tmpdir(), 'slopify-run-admission-'))
  directories.push(home)
  const paths = resolveSlopifyPaths({ environment: { SLOPIFY_HOME: home } })
  return { paths, store: createFilesystemRunStore({ paths, resources }) }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('filesystem run admission', () => {
  it('reveals a complete run directory with immutable snapshots and initial projections', async () => {
    const { paths, store } = createFixture()
    const verifySource = vi.fn(async () => undefined)

    await expect(store.admit({ ...input, verifySource })).resolves.toMatchObject({
      runId: 'run-01',
      workflowId: 'release-review',
      status: 'PENDING',
      lastEventSequence: 0,
    })

    const runPaths = paths.run('release-review', 'run-01')
    expect(
      RunProjectionSchema.parse(JSON.parse(readFileSync(runPaths.runFile, 'utf8'))),
    ).toMatchObject({ status: 'PENDING', createdAt: timestamp })
    expect(
      RunWorkflowSnapshotSchema.parse(
        JSON.parse(readFileSync(runPaths.workflowSnapshotFile, 'utf8')),
      ),
    ).toEqual(input.workflowSnapshot)
    expect(
      RunVariablesSnapshotSchema.parse(JSON.parse(readFileSync(runPaths.variablesFile, 'utf8'))),
    ).toEqual(input.variablesSnapshot)
    expect(
      RunRepositoriesSnapshotSchema.parse(
        JSON.parse(readFileSync(runPaths.repositoriesSnapshotFile, 'utf8')),
      ),
    ).toEqual(input.repositoriesSnapshot)
    expect(
      RunWorkspacesProjectionSchema.parse(
        JSON.parse(readFileSync(runPaths.workspacesFile, 'utf8')),
      ),
    ).toMatchObject({ runId: 'run-01', lastEventSequence: 0, workspaces: [] })
    expect(readFileSync(runPaths.eventsFile, 'utf8')).toBe('')
    expect(readdirSync(runPaths.artifactsDirectory)).toEqual([])
    expect(readdirSync(runPaths.nodesDirectory)).toEqual([])
    expect(readdirSync(runPaths.workspacesDirectory)).toEqual([])
    expect(verifySource).toHaveBeenCalledOnce()
  })

  it('removes staging data when writing an artifact fails', async () => {
    const resources = createAtomicJsonResourceIO()
    let writes = 0
    const failingResources: AtomicJsonResourceIO = {
      ...resources,
      async write(writeInput) {
        writes += 1
        if (writes === 3) throw new Error('disk failure')
        return resources.write(writeInput)
      },
    }
    const { paths, store } = createFixture(failingResources)

    await expect(store.admit({ ...input, verifySource: async () => undefined })).rejects.toThrow(
      'disk failure',
    )
    expect(existsSync(paths.run('release-review', 'run-01').directory)).toBe(false)
    expect(
      existsSync(paths.workflow('release-review').runsDirectory)
        ? readdirSync(paths.workflow('release-review').runsDirectory)
        : [],
    ).toEqual([])
  })

  it('does not reveal the run when the source revision changes before commit', async () => {
    const { paths, store } = createFixture()

    await expect(
      store.admit({
        ...input,
        verifySource: async () => {
          throw new Error('workflow changed')
        },
      }),
    ).rejects.toThrow('workflow changed')
    expect(existsSync(paths.run('release-review', 'run-01').directory)).toBe(false)
    expect(readdirSync(paths.workflow('release-review').runsDirectory)).toEqual([])
  })

  it('refuses to replace an existing run directory', async () => {
    const { paths, store } = createFixture()
    await store.admit({ ...input, verifySource: async () => undefined })

    await expect(
      store.admit({ ...input, verifySource: async () => undefined }),
    ).rejects.toMatchObject({ code: 'RUN_CONFLICT' })
    expect(
      JSON.parse(readFileSync(paths.run('release-review', 'run-01').runFile, 'utf8')),
    ).toMatchObject({ createdAt: timestamp })
  })
})
