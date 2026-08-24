import { describe, expect, it } from 'vitest'

import { PersistenceError } from '../../src/index.js'
import { getDatabaseHandle } from '../../src/persistence/database.js'
import { createPersistenceFixture, createTestAgentWorkflow } from './test-fixture.js'

const timestamp = '2026-08-23T12:00:00Z'
const apiSha = '1111111111111111111111111111111111111111'
const webSha = '2222222222222222222222222222222222222222'

const project = (projectId: string, name: string, remoteId: string, baseSha: string) => ({
  projectId,
  name,
  provider: 'GITHUB' as const,
  remoteId,
  fullName: `operator/${name.toLowerCase()}`,
  cloneUrl: `https://github.com/operator/${name.toLowerCase()}.git`,
  defaultBranch: 'main',
  baseSha,
})

const workflowWithProjects = () =>
  createTestAgentWorkflow({
    createdAt: timestamp,
    projectIds: ['project-api', 'project-web'],
    primaryProjectId: 'project-web',
  })

describe('run project snapshots', () => {
  it('rejects a current run when immutable project evidence is omitted', () => {
    const fixture = createPersistenceFixture(workflowWithProjects())

    try {
      expect(() =>
        fixture.runs.create({
          runId: 'run-project-omitted',
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
      expect(fixture.runs.get('run-project-omitted')).toBeUndefined()
    } finally {
      fixture.cleanup()
    }
  })

  it('atomically captures ordered immutable projects with the run', () => {
    const fixture = createPersistenceFixture(workflowWithProjects())

    try {
      fixture.runs.create({
        runId: 'run-project-snapshot',
        workflowId: fixture.workflow.workflowId,
        workflowSnapshot: fixture.workflow,
        variables: {},
        createdAt: timestamp,
        projects: [
          project('project-api', 'API', '100', apiSha),
          project('project-web', 'Web', '200', webSha),
        ],
      })

      expect(fixture.runs.listRunProjects('run-project-snapshot')).toEqual([
        {
          projectId: 'project-api',
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
          projectId: 'project-web',
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

  it('rolls back the run when its project snapshot does not match the workflow', () => {
    const fixture = createPersistenceFixture(workflowWithProjects())

    try {
      expect(() =>
        fixture.runs.create({
          runId: 'run-project-mismatch',
          workflowId: fixture.workflow.workflowId,
          workflowSnapshot: fixture.workflow,
          variables: {},
          createdAt: timestamp,
          projects: [project('project-web', 'Web', '200', webSha)],
        }),
      ).toThrowError(
        expect.objectContaining({
          code: 'PERSISTENCE_VALIDATION_FAILED',
        }) satisfies Partial<PersistenceError>,
      )
      expect(fixture.runs.get('run-project-mismatch')).toBeUndefined()
    } finally {
      fixture.cleanup()
    }
  })

  it('rolls back the run if any project row cannot be persisted', () => {
    const fixture = createPersistenceFixture(workflowWithProjects())

    try {
      expect(() =>
        fixture.runs.create({
          runId: 'run-project-atomicity',
          workflowId: fixture.workflow.workflowId,
          workflowSnapshot: fixture.workflow,
          variables: {},
          createdAt: timestamp,
          projects: [
            project('project-api', 'API', '100', apiSha),
            project('project-web', 'Web', '100', webSha),
          ],
        }),
      ).toThrowError(expect.objectContaining({ code: 'PERSISTENCE_WRITE_FAILED' }))
      expect(fixture.runs.get('run-project-atomicity')).toBeUndefined()
      expect(fixture.runs.listRunProjects('run-project-atomicity')).toEqual([])
    } finally {
      fixture.cleanup()
    }
  })

  it('persists PREPARING, READY, FAILED, and CLEANED workspace transitions', () => {
    const fixture = createPersistenceFixture(workflowWithProjects())

    try {
      fixture.runs.create({
        runId: 'run-worktree-state',
        workflowId: fixture.workflow.workflowId,
        workflowSnapshot: fixture.workflow,
        variables: {},
        createdAt: timestamp,
        projects: [
          project('project-api', 'API', '100', apiSha),
          project('project-web', 'Web', '200', webSha),
        ],
      })

      fixture.runs.markRunProjectWorkspacePreparing({
        runId: 'run-worktree-state',
        projectId: 'project-api',
        workspacePath: '/workspaces/run-worktree-state/project-api',
        branchName: 'slopify/run-worktree-state',
        timestamp,
      })
      fixture.runs.markRunProjectWorkspaceReady({
        runId: 'run-worktree-state',
        projectId: 'project-api',
        workspacePath: '/workspaces/run-worktree-state/project-api',
        branchName: 'slopify/run-worktree-state',
        timestamp: '2026-08-23T12:00:01Z',
      })
      fixture.runs.markRunProjectWorkspacePreparing({
        runId: 'run-worktree-state',
        projectId: 'project-web',
        workspacePath: '/workspaces/run-worktree-state/project-web',
        branchName: 'slopify/run-worktree-state',
        timestamp,
      })
      fixture.runs.markRunProjectWorkspaceFailed({
        runId: 'run-worktree-state',
        projectId: 'project-web',
        workspacePath: '/workspaces/run-worktree-state/project-web',
        branchName: 'slopify/run-worktree-state',
        errorMessage: 'Git clone failed',
        timestamp: '2026-08-23T12:00:01Z',
      })

      fixture.runs.markRunProjectWorkspaceCleaned({
        runId: 'run-worktree-state',
        projectId: 'project-api',
        timestamp: '2026-08-23T12:00:02Z',
      })

      expect(fixture.runs.listRunProjectWorkspaces('run-worktree-state')).toEqual([
        {
          projectId: 'project-api',
          position: 0,
          status: 'CLEANED',
          workspacePath: '/workspaces/run-worktree-state/project-api',
          branchName: 'slopify/run-worktree-state',
          errorMessage: null,
          preparedAt: '2026-08-23T12:00:01Z',
          cleanedAt: '2026-08-23T12:00:02Z',
          updatedAt: '2026-08-23T12:00:02Z',
        },
        {
          projectId: 'project-web',
          position: 1,
          status: 'FAILED',
          workspacePath: '/workspaces/run-worktree-state/project-web',
          branchName: 'slopify/run-worktree-state',
          errorMessage: 'Git clone failed',
          preparedAt: null,
          cleanedAt: null,
          updatedAt: '2026-08-23T12:00:01Z',
        },
      ])

      expect(() =>
        fixture.runs.markRunProjectWorkspacePreparing({
          runId: 'run-worktree-state',
          projectId: 'project-api',
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
    const fixture = createPersistenceFixture(workflowWithProjects())

    try {
      for (const runId of ['run-succeeded', 'run-running']) {
        fixture.runs.create({
          runId,
          workflowId: fixture.workflow.workflowId,
          workflowSnapshot: fixture.workflow,
          variables: {},
          createdAt: timestamp,
          projects: [
            project('project-api', 'API', '100', apiSha),
            project('project-web', 'Web', '200', webSha),
          ],
        })
        fixture.runs.markRunProjectWorkspacePreparing({
          runId,
          projectId: 'project-api',
          workspacePath: `/workspaces/${runId}/project-api`,
          branchName: `slopify/${runId}`,
          timestamp,
        })
      }
      getDatabaseHandle(fixture.database)
        .prepare("UPDATE runs SET status = 'SUCCEEDED', completed_at = ? WHERE run_id = ?")
        .run(timestamp, 'run-succeeded')

      expect(fixture.runs.listTerminalRunIdsNeedingWorkspaceCleanup()).toEqual(['run-succeeded'])

      fixture.runs.markRunProjectWorkspaceCleaned({
        runId: 'run-succeeded',
        projectId: 'project-api',
        timestamp,
      })
      expect(fixture.runs.listTerminalRunIdsNeedingWorkspaceCleanup()).toEqual([])
    } finally {
      fixture.cleanup()
    }
  })
})
