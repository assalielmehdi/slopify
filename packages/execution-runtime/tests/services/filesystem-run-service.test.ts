import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { WorkflowFile } from '@slopify/workflow-model'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  RunServiceError,
  createFilesystemRunAdmissionService,
  createFilesystemRunStore,
  createFilesystemWorkflowStore,
  resolveSlopifyPaths,
  type FilesystemRunRepositoryResolution,
} from '../../src/index.js'

const directories: string[] = []
const timestamp = '2026-08-25T10:00:00.000Z'

const workflow = (name = 'Release review'): WorkflowFile => ({
  schemaVersion: 2,
  workflowId: 'release-review',
  name,
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
      },
    ],
    edges: [],
    maxTransitions: 8,
  },
  createdAt: timestamp,
  updatedAt: timestamp,
})

const repository: FilesystemRunRepositoryResolution = {
  repositoryId: 'repository-api' as FilesystemRunRepositoryResolution['repositoryId'],
  name: 'API',
  provider: 'GITHUB',
  remoteId: '123',
  fullName: 'operator/api',
  cloneUrl: 'https://github.com/operator/api.git',
  webUrl: 'https://github.com/operator/api',
  defaultBranch: 'main',
  baseSha: 'a'.repeat(40) as FilesystemRunRepositoryResolution['baseSha'],
}

const createFixture = async () => {
  const home = mkdtempSync(join(tmpdir(), 'slopify-filesystem-run-service-'))
  directories.push(home)
  const paths = resolveSlopifyPaths({ environment: { SLOPIFY_HOME: home } })
  const workflows = createFilesystemWorkflowStore({ paths })
  const created = await workflows.create(workflow())
  let identity = 0
  const resolveRepository = vi.fn(async () => repository)
  const service = createFilesystemRunAdmissionService({
    workflows,
    runs: createFilesystemRunStore({ paths }),
    harnesses: { requireAvailable: vi.fn(async () => undefined) },
    resolveRepository,
    now: () => '2026-08-25T10:30:00.000Z',
    createRunId: () => `run-${++identity}`,
  })
  return { created, paths, resolveRepository, service, workflows }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('filesystem run service admission', () => {
  it('captures the exact workflow revision, variables, and live repository metadata', async () => {
    const { created, paths, resolveRepository, service } = await createFixture()

    await expect(
      service.create({ workflowId: 'release-review', variables: { release: 'v1.0.0' } }),
    ).resolves.toMatchObject({ runId: 'run-1', status: 'PENDING' })

    const runPaths = paths.run('release-review', 'run-1')
    expect(JSON.parse(await Bun.file(runPaths.workflowSnapshotFile).text())).toMatchObject({
      workflowRevision: created.revision,
      capturedAt: '2026-08-25T10:30:00.000Z',
      workflow: { workflowId: 'release-review', name: 'Release review' },
    })
    expect(JSON.parse(await Bun.file(runPaths.variablesFile).text())).toEqual({
      schemaVersion: 1,
      values: { release: 'v1.0.0' },
    })
    expect(JSON.parse(await Bun.file(runPaths.repositoriesSnapshotFile).text())).toMatchObject({
      repositories: [
        {
          ...repository,
          position: 0,
          isPrimary: true,
        },
      ],
    })
    expect(resolveRepository).toHaveBeenCalledWith('repository-api')
  })

  it('rejects a workflow edit during admission without revealing a run', async () => {
    const { created, paths, workflows } = await createFixture()
    const changingService = createFilesystemRunAdmissionService({
      workflows,
      runs: createFilesystemRunStore({ paths }),
      harnesses: { requireAvailable: async () => undefined },
      resolveRepository: async () => {
        await workflows.save({
          workflowId: 'release-review',
          value: { ...workflow('Changed during admission'), updatedAt: '2026-08-25T10:20:00.000Z' },
          expectedRevision: created.revision,
        })
        return repository
      },
      now: () => '2026-08-25T10:30:00.000Z',
      createRunId: () => 'run-changing',
    })

    await expect(
      changingService.create({
        workflowId: 'release-review',
        variables: { release: 'v1.0.0' },
      }),
    ).rejects.toMatchObject({
      code: 'WORKFLOW_CHANGED_DURING_ADMISSION',
    } satisfies Partial<RunServiceError>)
    expect(existsSync(paths.run('release-review', 'run-changing').directory)).toBe(false)
  })

  it('validates exact variables before creating staging data', async () => {
    const { paths, service } = await createFixture()

    await expect(
      service.create({ workflowId: 'release-review', variables: {} }),
    ).rejects.toMatchObject({ code: 'RUN_VARIABLES_INVALID' } satisfies Partial<RunServiceError>)
    expect(existsSync(paths.workflow('release-review').runsDirectory)).toBe(false)
  })
})
