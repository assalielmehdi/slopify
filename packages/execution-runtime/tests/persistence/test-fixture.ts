import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectProfileIdSchema, RunIdSchema, WorkflowIdSchema } from '@loop/contracts'
import { createPredefinedV1Workflow, type Workflow } from '@loop/workflow-model'

import {
  createEventStore,
  createProfileRepository,
  createRunRepository,
  createWorkflowRepository,
  openDatabase,
} from '../../src/index.js'
export const TEST_TIMESTAMP = '2026-08-18T20:00:00Z'
export const TEST_WORKFLOW_ID = WorkflowIdSchema.parse('delivery-workflow')
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

export const createPersistenceFixture = (workflowInput?: Workflow) => {
  const directory = join(tmpdir(), `slopify-repositories-${crypto.randomUUID()}`)
  const path = join(directory, 'state', 'workbench.sqlite')
  const database = openDatabase({ path })
  const workflows = createWorkflowRepository(database)
  const profiles = createProfileRepository(database)
  const runs = createRunRepository(database)
  const events = createEventStore(database)
  const workflow =
    workflowInput ??
    createPredefinedV1Workflow({
      createdAt: TEST_TIMESTAMP,
      agentDefaults: {
        provider: 'test-provider',
        model: 'test-model',
        thinkingLevel: 'medium',
      },
    })

  workflows.save(workflow)
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
    workflow,
    runs,
    snapshot,
    workflows,
    cleanup,
  }
}

export const createRun = (
  fixture: ReturnType<typeof createPersistenceFixture>,
  workflowSnapshot: Workflow = fixture.workflow,
  variables: Readonly<Record<string, string>> = { task: 'Implement persistence' },
) =>
  fixture.runs.create({
    runId: TEST_RUN_ID,
    workflowId: TEST_WORKFLOW_ID,
    workflowSnapshot,
    variables,
    missingVariables: [],
    createdAt: TEST_TIMESTAMP,
    legacy: {
      profileSnapshotId: fixture.snapshot.snapshotId,
      taskReference: 'TASK-1',
      taskSnapshot: { id: 'TASK-1', name: 'Implement persistence' },
    },
  })
