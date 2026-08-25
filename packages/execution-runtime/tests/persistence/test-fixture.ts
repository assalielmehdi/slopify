import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunIdSchema, WorkflowIdSchema } from '@slopify/contracts'
import { WorkflowSchema, type Workflow } from '@slopify/workflow-model'

import {
  type HarnessCatalog,
  type LegacyWorkflowCatalog,
  type RepositoryRecord,
  type RunRepositoryResolution,
  createEventStore,
  createRunRepository,
  openDatabase,
  type JsonValue,
  type WorkbenchDatabase,
} from '../../src/index.js'
import { getDatabaseHandle } from '../../src/persistence/database.js'

export const TEST_TIMESTAMP = '2026-08-23T12:00:00.000Z'
export const TEST_WORKFLOW_ID = WorkflowIdSchema.parse('test-workflow')
export const TEST_RUN_ID = RunIdSchema.parse('run-01')
export const TEST_RUN_REPOSITORY: RunRepositoryResolution = {
  repositoryId: 'repository-api' as RunRepositoryResolution['repositoryId'],
  name: 'API',
  provider: 'GITHUB',
  remoteId: '100',
  fullName: 'operator/api',
  cloneUrl: 'https://github.com/operator/api.git',
  defaultBranch: 'main',
  baseSha: 'a'.repeat(40) as RunRepositoryResolution['baseSha'],
}

export const createTestHarnessCatalog = (): HarnessCatalog => ({
  list: async () => [],
  get: async () => undefined,
  requireAvailable: async () => ({
    harnessId: 'pi',
    name: 'Pi',
    description: 'Run workflows with the host-installed Pi harness.',
    availability: 'AVAILABLE',
    executablePath: '/usr/local/bin/pi',
    version: '0.84.2',
    installHref: 'https://pi.dev/',
    installLabel: 'Install Pi',
    models: [{ id: 'test-model', name: 'test-model', thinkingLevels: ['medium'] }],
  }),
})

export interface CreateTestAgentWorkflowInput {
  readonly workflowId?: string
  readonly prompt?: string
  readonly repositoryIds?: readonly string[]
  readonly primaryRepositoryId?: string | null
  readonly variables?: readonly string[]
  readonly createdAt?: string
}

export const createTestAgentWorkflow = (input: CreateTestAgentWorkflowInput = {}): Workflow => {
  const createdAt = input.createdAt ?? TEST_TIMESTAMP
  const repositoryIds = input.repositoryIds ?? []
  return WorkflowSchema.parse({
    schemaVersion: 2,
    workflowId: input.workflowId ?? TEST_WORKFLOW_ID,
    name: 'Test workflow',
    description: 'A current Pi-backed agent workflow for tests.',
    configuration: {
      repositoryIds,
      primaryRepositoryId:
        input.primaryRepositoryId === undefined
          ? (repositoryIds[0] ?? null)
          : input.primaryRepositoryId,
      variables: input.variables ?? [],
    },
    startNodeId: 'agent',
    nodes: [
      {
        type: 'agent',
        id: 'agent',
        name: 'Agent',
        prompt: input.prompt ?? 'Complete the test task.',
        harness: { harnessId: 'pi' },
      },
    ],
    edges: [],
    maxTransitions: 0,
    createdAt,
    updatedAt: createdAt,
  })
}

export const resolveTestRepository = async (
  repositoryId: string,
): Promise<RunRepositoryResolution> => ({
  ...TEST_RUN_REPOSITORY,
  repositoryId: repositoryId as RunRepositoryResolution['repositoryId'],
})

export const createTestRunRepositories = (workflow: Workflow): readonly RunRepositoryResolution[] =>
  workflow.configuration.repositoryIds.map((repositoryId) => ({
    ...TEST_RUN_REPOSITORY,
    repositoryId,
    name:
      repositoryId === TEST_RUN_REPOSITORY.repositoryId ? TEST_RUN_REPOSITORY.name : repositoryId,
    remoteId:
      repositoryId === TEST_RUN_REPOSITORY.repositoryId ? TEST_RUN_REPOSITORY.remoteId : '200',
    fullName:
      repositoryId === TEST_RUN_REPOSITORY.repositoryId
        ? TEST_RUN_REPOSITORY.fullName
        : `operator/${repositoryId}`,
    cloneUrl:
      repositoryId === TEST_RUN_REPOSITORY.repositoryId
        ? TEST_RUN_REPOSITORY.cloneUrl
        : `https://github.com/operator/${repositoryId}.git`,
  }))

export const insertLegacyRepository = (
  database: WorkbenchDatabase,
  repository: RepositoryRecord,
): void => {
  getDatabaseHandle(database)
    .prepare(
      `INSERT INTO repositories (
         repository_id, name, provider, remote_id, repository_full_name,
         clone_url, web_url, default_branch, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      repository.repositoryId,
      repository.name,
      repository.provider,
      repository.remoteId,
      repository.fullName,
      repository.cloneUrl,
      repository.webUrl,
      repository.defaultBranch,
      repository.createdAt,
      repository.updatedAt,
    )
}

export const insertLegacyWorkflow = (database: WorkbenchDatabase, workflow: Workflow): void => {
  getDatabaseHandle(database)
    .prepare('INSERT INTO workflows (workflow_id, definition_json) VALUES (?, json(?))')
    .run(workflow.workflowId, JSON.stringify(workflow))
}

type TestWorkflowCatalog = LegacyWorkflowCatalog & {
  save(workflow: Workflow): void
}

const createTestWorkflowCatalog = (initial: Workflow): TestWorkflowCatalog => {
  const workflows = new Map([[initial.workflowId, structuredClone(initial)]])
  return {
    get: (workflowId) => workflows.get(workflowId),
    save(workflow) {
      workflows.set(workflow.workflowId, structuredClone(workflow))
    },
  }
}

export const createPersistenceFixture = (workflow = createTestAgentWorkflow()) => {
  const directory = join(tmpdir(), `slopify-persistence-${crypto.randomUUID()}`)
  const path = join(directory, 'state', 'workbench.sqlite')
  const database = openDatabase({ path })
  const workflows = createTestWorkflowCatalog(workflow)
  const runs = createRunRepository(database)
  const events = createEventStore(database)

  insertLegacyWorkflow(database, workflow)

  const cleanup = (): void => {
    if (database.isOpen) database.close()
    rmSync(directory, { force: true, recursive: true })
  }

  return { database, events, path, workflow, runs, workflows, cleanup }
}

export const createRun = (
  fixture: ReturnType<typeof createPersistenceFixture>,
  workflowSnapshot: Workflow = fixture.workflow,
  variables: Readonly<Record<string, JsonValue>> = {},
) =>
  fixture.runs.create({
    runId: TEST_RUN_ID,
    workflowId: workflowSnapshot.workflowId,
    workflowSnapshot,
    variables,
    createdAt: TEST_TIMESTAMP,
    repositories: createTestRunRepositories(workflowSnapshot),
  })
