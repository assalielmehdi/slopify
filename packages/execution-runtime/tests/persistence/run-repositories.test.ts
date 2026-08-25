import { describe, expect, it } from 'vitest'

import { PersistenceError } from '../../src/index.js'
import { getDatabaseHandle } from '../../src/persistence/database.js'
import { createPersistenceFixture, createTestAgentWorkflow } from './test-fixture.js'

const timestamp = '2026-08-23T12:00:00Z'
const apiSha = '1111111111111111111111111111111111111111'
const webSha = '2222222222222222222222222222222222222222'

const repository = (repositoryId: string, name: string, remoteId: string, baseSha: string) => ({
  repositoryId,
  name,
  provider: 'GITHUB' as const,
  remoteId,
  fullName: `operator/${name.toLowerCase()}`,
  cloneUrl: `https://github.com/operator/${name.toLowerCase()}.git`,
  defaultBranch: 'main',
  baseSha,
})

const workflowWithRepositories = () =>
  createTestAgentWorkflow({
    createdAt: timestamp,
    repositoryIds: ['repository-api', 'repository-web'],
    primaryRepositoryId: 'repository-web',
  })

describe('run repository snapshots', () => {
  it('rejects a current run when immutable repository evidence is omitted', () => {
    const fixture = createPersistenceFixture(workflowWithRepositories())

    try {
      expect(() =>
        fixture.runs.create({
          runId: 'run-repository-omitted',
          workflowId: fixture.workflow.workflowId,
          workflowSnapshot: fixture.workflow,
          variables: {},
          createdAt: timestamp,
        } as Parameters<typeof fixture.runs.create>[0]),
      ).toThrowError(
        expect.objectContaining({
          code: 'PERSISTENCE_VALIDATION_FAILED',
        }) satisfies Partial<PersistenceError>,
      )
      expect(fixture.runs.get('run-repository-omitted')).toBeUndefined()
    } finally {
      fixture.cleanup()
    }
  })

  it('atomically captures ordered immutable repositories with the run', () => {
    const fixture = createPersistenceFixture(workflowWithRepositories())

    try {
      fixture.runs.create({
        runId: 'run-repository-snapshot',
        workflowId: fixture.workflow.workflowId,
        workflowSnapshot: fixture.workflow,
        variables: {},
        createdAt: timestamp,
        repositories: [
          repository('repository-api', 'API', '100', apiSha),
          repository('repository-web', 'Web', '200', webSha),
        ],
      })

      expect(fixture.runs.listRunRepositories('run-repository-snapshot')).toEqual([
        {
          repositoryId: 'repository-api',
          position: 0,
          name: 'API',
          provider: 'GITHUB',
          remoteId: '100',
          fullName: 'operator/api',
          cloneUrl: 'https://github.com/operator/api.git',
          defaultBranch: 'main',
          baseSha: apiSha,
          isPrimary: false,
        },
        {
          repositoryId: 'repository-web',
          position: 1,
          name: 'Web',
          provider: 'GITHUB',
          remoteId: '200',
          fullName: 'operator/web',
          cloneUrl: 'https://github.com/operator/web.git',
          defaultBranch: 'main',
          baseSha: webSha,
          isPrimary: true,
        },
      ])
    } finally {
      fixture.cleanup()
    }
  })

  it('rolls back the run when its repository snapshot does not match the workflow', () => {
    const fixture = createPersistenceFixture(workflowWithRepositories())

    try {
      expect(() =>
        fixture.runs.create({
          runId: 'run-repository-mismatch',
          workflowId: fixture.workflow.workflowId,
          workflowSnapshot: fixture.workflow,
          variables: {},
          createdAt: timestamp,
          repositories: [repository('repository-web', 'Web', '200', webSha)],
        }),
      ).toThrowError(
        expect.objectContaining({
          code: 'PERSISTENCE_VALIDATION_FAILED',
        }) satisfies Partial<PersistenceError>,
      )
      expect(fixture.runs.get('run-repository-mismatch')).toBeUndefined()
    } finally {
      fixture.cleanup()
    }
  })

  it('rolls back the run if any repository row cannot be persisted', () => {
    const fixture = createPersistenceFixture(workflowWithRepositories())

    try {
      expect(() =>
        fixture.runs.create({
          runId: 'run-repository-atomicity',
          workflowId: fixture.workflow.workflowId,
          workflowSnapshot: fixture.workflow,
          variables: {},
          createdAt: timestamp,
          repositories: [
            repository('repository-api', 'API', '100', apiSha),
            repository('repository-web', 'Web', '100', webSha),
          ],
        }),
      ).toThrowError(expect.objectContaining({ code: 'PERSISTENCE_WRITE_FAILED' }))
      expect(fixture.runs.get('run-repository-atomicity')).toBeUndefined()
      expect(fixture.runs.listRunRepositories('run-repository-atomicity')).toEqual([])
    } finally {
      fixture.cleanup()
    }
  })

  it('persists PREPARING, READY, FAILED, and CLEANED workspace transitions', () => {
    const fixture = createPersistenceFixture(workflowWithRepositories())

    try {
      fixture.runs.create({
        runId: 'run-worktree-state',
        workflowId: fixture.workflow.workflowId,
        workflowSnapshot: fixture.workflow,
        variables: {},
        createdAt: timestamp,
        repositories: [
          repository('repository-api', 'API', '100', apiSha),
          repository('repository-web', 'Web', '200', webSha),
        ],
      })

      fixture.runs.markRunRepositoryWorkspacePreparing({
        runId: 'run-worktree-state',
        repositoryId: 'repository-api',
        workspacePath: '/workspaces/run-worktree-state/repository-api',
        branchName: 'slopify/run-worktree-state',
        timestamp,
      })
      fixture.runs.markRunRepositoryWorkspaceReady({
        runId: 'run-worktree-state',
        repositoryId: 'repository-api',
        workspacePath: '/workspaces/run-worktree-state/repository-api',
        branchName: 'slopify/run-worktree-state',
        timestamp: '2026-08-23T12:00:01Z',
      })
      fixture.runs.markRunRepositoryWorkspacePreparing({
        runId: 'run-worktree-state',
        repositoryId: 'repository-web',
        workspacePath: '/workspaces/run-worktree-state/repository-web',
        branchName: 'slopify/run-worktree-state',
        timestamp,
      })
      fixture.runs.markRunRepositoryWorkspaceFailed({
        runId: 'run-worktree-state',
        repositoryId: 'repository-web',
        workspacePath: '/workspaces/run-worktree-state/repository-web',
        branchName: 'slopify/run-worktree-state',
        errorMessage: 'Git clone failed',
        timestamp: '2026-08-23T12:00:01Z',
      })

      fixture.runs.markRunRepositoryWorkspaceCleaned({
        runId: 'run-worktree-state',
        repositoryId: 'repository-api',
        timestamp: '2026-08-23T12:00:02Z',
      })

      expect(fixture.runs.listRunRepositoryWorkspaces('run-worktree-state')).toEqual([
        {
          repositoryId: 'repository-api',
          position: 0,
          status: 'CLEANED',
          workspacePath: '/workspaces/run-worktree-state/repository-api',
          branchName: 'slopify/run-worktree-state',
          errorMessage: null,
          preparedAt: '2026-08-23T12:00:01Z',
          cleanedAt: '2026-08-23T12:00:02Z',
          updatedAt: '2026-08-23T12:00:02Z',
        },
        {
          repositoryId: 'repository-web',
          position: 1,
          status: 'FAILED',
          workspacePath: '/workspaces/run-worktree-state/repository-web',
          branchName: 'slopify/run-worktree-state',
          errorMessage: 'Git clone failed',
          preparedAt: null,
          cleanedAt: null,
          updatedAt: '2026-08-23T12:00:01Z',
        },
      ])

      expect(() =>
        fixture.runs.markRunRepositoryWorkspacePreparing({
          runId: 'run-worktree-state',
          repositoryId: 'repository-api',
          workspacePath: '/different/path',
          branchName: 'slopify/run-worktree-state',
          timestamp: '2026-08-23T12:00:02Z',
        }),
      ).toThrowError(expect.objectContaining({ code: 'PERSISTENCE_CONFLICT' }))
    } finally {
      fixture.cleanup()
    }
  })

  it('lists terminal runs whose cloned workspaces still require cleanup', () => {
    const fixture = createPersistenceFixture(workflowWithRepositories())

    try {
      for (const runId of ['run-succeeded', 'run-running']) {
        fixture.runs.create({
          runId,
          workflowId: fixture.workflow.workflowId,
          workflowSnapshot: fixture.workflow,
          variables: {},
          createdAt: timestamp,
          repositories: [
            repository('repository-api', 'API', '100', apiSha),
            repository('repository-web', 'Web', '200', webSha),
          ],
        })
        fixture.runs.markRunRepositoryWorkspacePreparing({
          runId,
          repositoryId: 'repository-api',
          workspacePath: `/workspaces/${runId}/repository-api`,
          branchName: `slopify/${runId}`,
          timestamp,
        })
      }
      getDatabaseHandle(fixture.database)
        .prepare("UPDATE runs SET status = 'SUCCEEDED', completed_at = ? WHERE run_id = ?")
        .run(timestamp, 'run-succeeded')

      expect(fixture.runs.listTerminalRunIdsNeedingWorkspaceCleanup()).toEqual(['run-succeeded'])

      fixture.runs.markRunRepositoryWorkspaceCleaned({
        runId: 'run-succeeded',
        repositoryId: 'repository-api',
        timestamp,
      })
      expect(fixture.runs.listTerminalRunIdsNeedingWorkspaceCleanup()).toEqual([])
    } finally {
      fixture.cleanup()
    }
  })
})
