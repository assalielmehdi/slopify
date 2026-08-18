import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ProjectProfileIdSchema,
  RevisionIdSchema,
  RunIdSchema,
  WorkflowIdSchema,
} from '@loop/contracts'
import { createPredefinedV1Revision } from '@loop/workflow-model'
import type { WorkflowRevision } from '@loop/workflow-model'

import {
  createEventStore,
  createProfileRepository,
  createRunRepository,
  createWorkflowRepository,
  openDatabase,
} from '../../src/index.js'

export const TEST_TIMESTAMP = '2026-08-18T20:00:00Z'
export const TEST_WORKFLOW_ID = WorkflowIdSchema.parse('delivery-workflow')
export const TEST_REVISION_ID = RevisionIdSchema.parse('revision-01')
export const TEST_PROFILE_ID = ProjectProfileIdSchema.parse('profile-01')
export const TEST_RUN_ID = RunIdSchema.parse('run-01')

export const TEST_PROFILE = {
  profileId: TEST_PROFILE_ID,
  displayName: 'Local profile',
  clickupWorkspaceId: 'workspace-01',
  clickupListId: 'list-01',
  clickupInReviewStatusId: 'in-review',
  repositories: [
    {
      repositoryId: 'api',
      displayName: 'API',
      purpose: 'Backend',
      repositoryPath: '/workspace/api',
      gitlabProject: 'group/api',
      remote: 'origin',
      targetBranch: 'main',
      worktreeParent: '/worktrees',
      branchTemplate: 'ai/{task}-{run}',
      executableChecks: [{ executable: 'node', arguments: ['--version'] }],
      verificationCommands: [{ executable: 'pnpm', arguments: ['test'] }],
      mergeRequestLabels: ['backend'],
    },
    {
      repositoryId: 'web',
      displayName: 'Web',
      purpose: 'Frontend',
      repositoryPath: '/workspace/web',
      gitlabProject: 'group/web',
      remote: 'origin',
      targetBranch: 'main',
      worktreeParent: '/worktrees',
      branchTemplate: 'ai/{task}-{run}',
      executableChecks: [{ executable: 'node', arguments: ['--version'] }],
      verificationCommands: [{ executable: 'pnpm', arguments: ['test'] }],
      mergeRequestLabels: ['frontend'],
    },
    {
      repositoryId: 'docs',
      displayName: 'Docs',
      purpose: 'Documentation',
      repositoryPath: '/workspace/docs',
      gitlabProject: 'group/docs',
      remote: 'origin',
      targetBranch: 'main',
      worktreeParent: '/worktrees',
      branchTemplate: 'ai/{task}-{run}',
      executableChecks: [],
      verificationCommands: [{ executable: 'pnpm', arguments: ['lint'] }],
      mergeRequestLabels: [],
    },
  ],
} as const

export const createPersistenceFixture = (revisionInput?: WorkflowRevision) => {
  const directory = join(tmpdir(), `slopify-repositories-${crypto.randomUUID()}`)
  const path = join(directory, 'state', 'workbench.sqlite')
  const database = openDatabase({ path })
  const workflows = createWorkflowRepository(database)
  const profiles = createProfileRepository(database)
  const runs = createRunRepository(database)
  const events = createEventStore(database)
  const revision =
    revisionInput ??
    createPredefinedV1Revision({
      revisionId: TEST_REVISION_ID,
      createdAt: TEST_TIMESTAMP,
      agentDefaults: {
        provider: 'test-provider',
        model: 'test-model',
        thinkingLevel: 'medium',
      },
    })

  workflows.addRevision(revision)
  profiles.save(TEST_PROFILE, TEST_TIMESTAMP)
  const snapshot = profiles.createSnapshot({
    snapshotId: 'snapshot-01',
    profileId: TEST_PROFILE_ID,
    createdAt: TEST_TIMESTAMP,
  })

  const cleanup = (): void => {
    if (database.isOpen) database.close()
    rmSync(directory, { force: true, recursive: true })
  }

  return {
    database,
    events,
    path,
    profiles,
    revision,
    runs,
    snapshot,
    workflows,
    cleanup,
  }
}

export const createRun = (
  fixture: ReturnType<typeof createPersistenceFixture>,
  effectiveConfiguration: unknown = { transitionLimit: 24 },
) =>
  fixture.runs.create({
    runId: TEST_RUN_ID,
    workflowId: TEST_WORKFLOW_ID,
    revisionId: TEST_REVISION_ID,
    profileSnapshotId: fixture.snapshot.snapshotId,
    taskReference: 'TASK-1',
    taskSnapshot: { id: 'TASK-1', name: 'Implement persistence' },
    effectiveConfiguration,
    createdAt: TEST_TIMESTAMP,
  })
