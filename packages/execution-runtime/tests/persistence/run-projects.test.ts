import { describe, expect, it } from 'vitest'

import { PersistenceError } from '../../src/index.js'
import { createPersistenceFixture, createTestAgentWorkflow } from './test-fixture.js'

const timestamp = '2026-08-23T12:00:00Z'
const apiSha = '1111111111111111111111111111111111111111'
const webSha = '2222222222222222222222222222222222222222'

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
          {
            projectId: 'project-api',
            name: 'API',
            repositoryPath: '/repositories/api',
            baseSha: apiSha,
            sourceBranch: 'main',
          },
          {
            projectId: 'project-web',
            name: 'Web',
            repositoryPath: '/repositories/web',
            baseSha: webSha,
            sourceBranch: null,
          },
        ],
      })

      expect(fixture.runs.listRunProjects('run-project-snapshot')).toEqual([
        {
          projectId: 'project-api',
          position: 0,
          name: 'API',
          repositoryPath: '/repositories/api',
          baseSha: apiSha,
          sourceBranch: 'main',
          isPrimary: false,
        },
        {
          projectId: 'project-web',
          position: 1,
          name: 'Web',
          repositoryPath: '/repositories/web',
          baseSha: webSha,
          sourceBranch: null,
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
          projects: [
            {
              projectId: 'project-web',
              name: 'Web',
              repositoryPath: '/repositories/web',
              baseSha: webSha,
              sourceBranch: 'main',
            },
          ],
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
            {
              projectId: 'project-api',
              name: 'API',
              repositoryPath: '/repositories/shared',
              baseSha: apiSha,
              sourceBranch: 'main',
            },
            {
              projectId: 'project-web',
              name: 'Web',
              repositoryPath: '/repositories/shared',
              baseSha: webSha,
              sourceBranch: 'main',
            },
          ],
        }),
      ).toThrowError(expect.objectContaining({ code: 'PERSISTENCE_WRITE_FAILED' }))
      expect(fixture.runs.get('run-project-atomicity')).toBeUndefined()
      expect(fixture.runs.listRunProjects('run-project-atomicity')).toEqual([])
    } finally {
      fixture.cleanup()
    }
  })

  it('persists idempotent PREPARING, READY, and FAILED worktree transitions', () => {
    const fixture = createPersistenceFixture(workflowWithProjects())

    try {
      fixture.runs.create({
        runId: 'run-worktree-state',
        workflowId: fixture.workflow.workflowId,
        workflowSnapshot: fixture.workflow,
        variables: {},
        createdAt: timestamp,
        projects: [
          {
            projectId: 'project-api',
            name: 'API',
            repositoryPath: '/repositories/api',
            baseSha: apiSha,
            sourceBranch: 'main',
          },
          {
            projectId: 'project-web',
            name: 'Web',
            repositoryPath: '/repositories/web',
            baseSha: webSha,
            sourceBranch: 'main',
          },
        ],
      })

      fixture.runs.markRunProjectWorktreePreparing({
        runId: 'run-worktree-state',
        projectId: 'project-api',
        worktreePath: '/worktrees/run-worktree-state/project-api',
        timestamp,
      })
      fixture.runs.markRunProjectWorktreeReady({
        runId: 'run-worktree-state',
        projectId: 'project-api',
        worktreePath: '/worktrees/run-worktree-state/project-api',
        timestamp: '2026-08-23T12:00:01Z',
      })
      fixture.runs.markRunProjectWorktreePreparing({
        runId: 'run-worktree-state',
        projectId: 'project-web',
        worktreePath: '/worktrees/run-worktree-state/project-web',
        timestamp,
      })
      fixture.runs.markRunProjectWorktreeFailed({
        runId: 'run-worktree-state',
        projectId: 'project-web',
        worktreePath: '/worktrees/run-worktree-state/project-web',
        errorMessage: 'Git worktree creation failed',
        timestamp: '2026-08-23T12:00:01Z',
      })

      expect(fixture.runs.listRunProjectWorktrees('run-worktree-state')).toEqual([
        {
          projectId: 'project-api',
          position: 0,
          status: 'READY',
          worktreePath: '/worktrees/run-worktree-state/project-api',
          errorMessage: null,
          preparedAt: '2026-08-23T12:00:01Z',
          updatedAt: '2026-08-23T12:00:01Z',
        },
        {
          projectId: 'project-web',
          position: 1,
          status: 'FAILED',
          worktreePath: '/worktrees/run-worktree-state/project-web',
          errorMessage: 'Git worktree creation failed',
          preparedAt: null,
          updatedAt: '2026-08-23T12:00:01Z',
        },
      ])

      expect(() =>
        fixture.runs.markRunProjectWorktreePreparing({
          runId: 'run-worktree-state',
          projectId: 'project-api',
          worktreePath: '/different/path',
          timestamp: '2026-08-23T12:00:02Z',
        }),
      ).toThrowError(expect.objectContaining({ code: 'PERSISTENCE_CONFLICT' }))
    } finally {
      fixture.cleanup()
    }
  })
})
