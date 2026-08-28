import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunIdSchema, WorkflowIdSchema } from '@slopify/contracts'
import { WorkflowSchema, type Workflow } from '@slopify/workflow-model'

import {
  type HarnessCatalog,
  type AgentNodeRunRecord,
  type RepositoryRecord,
  type RunRepositoryResolution,
  type RunRepositorySnapshotArtifact,
  type RunWorkspaceProjection,
  type JsonValue,
} from '../../src/index.js'
import {
  createLegacyTestDatabase,
  type LegacyTestDatabase,
} from '../migration/legacy-database-fixture.js'

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
    schemaVersion: 3,
    workflowId: input.workflowId ?? TEST_WORKFLOW_ID,
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
  database: LegacyTestDatabase,
  repository: RepositoryRecord,
): void => {
  database
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

export const insertLegacyWorkflow = (database: LegacyTestDatabase, workflow: Workflow): void => {
  database
    .prepare('INSERT INTO workflows (workflow_id, definition_json) VALUES (?, json(?))')
    .run(workflow.workflowId, JSON.stringify(workflow))
}

interface TestWorkflowCatalog {
  get(workflowId: string): Workflow | undefined
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

interface TestRunInput {
  readonly runId: string
  readonly workflowId: string
  readonly workflowSnapshot: Workflow
  readonly variables: Readonly<Record<string, JsonValue>>
  readonly repositories: readonly RunRepositoryResolution[]
  readonly createdAt: string
}

const createTestRunStore = () => {
  const runs = new Map<string, AgentNodeRunRecord>()
  const repositories = new Map<string, readonly RunRepositorySnapshotArtifact[]>()
  const workspaces = new Map<string, RunWorkspaceProjection[]>()
  const updateWorkspace = (
    input: Readonly<{
      runId: string
      repositoryId: string
      workspacePath?: string
      branchName?: string
      timestamp: string
      errorMessage?: string
    }>,
    status: RunWorkspaceProjection['status'],
  ): RunWorkspaceProjection => {
    const entries = workspaces.get(input.runId) ?? []
    const repository = repositories
      .get(input.runId)
      ?.find(({ repositoryId }) => repositoryId === input.repositoryId)
    if (repository === undefined) throw new Error('Test repository was not found')
    const current = entries.find(({ repositoryId }) => repositoryId === input.repositoryId)
    const next: RunWorkspaceProjection = {
      repositoryId: repository.repositoryId,
      position: repository.position,
      status,
      workspacePath: input.workspacePath ?? current?.workspacePath ?? '',
      branchName: input.branchName ?? current?.branchName ?? null,
      errorMessage: input.errorMessage ?? null,
      preparedAt: status === 'READY' ? input.timestamp : (current?.preparedAt ?? null),
      cleanedAt: status === 'CLEANED' ? input.timestamp : null,
      updatedAt: input.timestamp,
    }
    workspaces.set(input.runId, [...entries.filter((entry) => entry !== current), next])
    return next
  }
  return {
    create(input: TestRunInput) {
      const record: AgentNodeRunRecord = {
        runId: RunIdSchema.parse(input.runId),
        workflowSnapshot: structuredClone(input.workflowSnapshot),
        variables: structuredClone(input.variables),
      }
      runs.set(input.runId, record)
      repositories.set(
        input.runId,
        input.repositories.map((repository, position) => ({
          ...repository,
          position,
          webUrl: `https://${repository.provider === 'GITHUB' ? 'github.com' : 'gitlab.com'}/${repository.fullName}`,
          isPrimary:
            repository.repositoryId === input.workflowSnapshot.configuration.primaryRepositoryId,
        })),
      )
      return record
    },
    get: (runId: string) => runs.get(runId),
    listRunRepositories: (runId: string) => repositories.get(runId) ?? [],
    listRunRepositoryWorkspaces: (runId: string) => workspaces.get(runId) ?? [],
    markRunRepositoryWorkspacePreparing: (input: {
      runId: string
      repositoryId: string
      workspacePath: string
      branchName: string
      timestamp: string
    }) => updateWorkspace(input, 'PREPARING'),
    markRunRepositoryWorkspaceReady: (input: {
      runId: string
      repositoryId: string
      workspacePath: string
      branchName: string
      timestamp: string
    }) => updateWorkspace(input, 'READY'),
    markRunRepositoryWorkspaceFailed: (input: {
      runId: string
      repositoryId: string
      workspacePath: string
      branchName: string
      timestamp: string
      errorMessage: string
    }) => updateWorkspace(input, 'FAILED'),
    markRunRepositoryWorkspaceCleaned: (input: {
      runId: string
      repositoryId: string
      timestamp: string
    }) => updateWorkspace(input, 'CLEANED'),
  }
}

export const createPersistenceFixture = (workflow = createTestAgentWorkflow()) => {
  const directory = join(tmpdir(), `slopify-persistence-${crypto.randomUUID()}`)
  const path = join(directory, 'state', 'slopify.db')
  const database = createLegacyTestDatabase(path)
  const workflows = createTestWorkflowCatalog(workflow)
  const runs = createTestRunStore()

  insertLegacyWorkflow(database, workflow)

  const cleanup = (): void => {
    if (database.open) database.close()
    rmSync(directory, { force: true, recursive: true })
  }

  return { database, path, workflow, runs, workflows, cleanup }
}

export const createRun = (
  fixture: ReturnType<typeof createPersistenceFixture>,
  workflowSnapshot: Workflow = fixture.workflow,
  variables: Readonly<Record<string, JsonValue>> = {},
) => {
  const input = {
    runId: TEST_RUN_ID,
    workflowId: workflowSnapshot.workflowId,
    workflowSnapshot,
    variables,
    createdAt: TEST_TIMESTAMP,
    repositories: createTestRunRepositories(workflowSnapshot),
  }
  const record = fixture.runs.create(input)
  const connection = fixture.database
  connection
    .prepare(
      `INSERT INTO runs (
         run_id, workflow_id, variables_json, workflow_snapshot_json, status,
         transition_count, created_at, started_at, completed_at
       ) VALUES (?, ?, json(?), json(?), 'PENDING', 0, ?, NULL, NULL)`,
    )
    .run(
      input.runId,
      input.workflowId,
      JSON.stringify(input.variables),
      JSON.stringify(input.workflowSnapshot),
      input.createdAt,
    )
  for (const [position, repository] of input.repositories.entries()) {
    connection
      .prepare(
        `INSERT INTO run_repositories (
           run_id, repository_id, repository_position, name, provider, remote_id,
           repository_full_name, clone_url, default_branch, base_sha, is_primary
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.runId,
        repository.repositoryId,
        position,
        repository.name,
        repository.provider,
        repository.remoteId,
        repository.fullName,
        repository.cloneUrl,
        repository.defaultBranch,
        repository.baseSha,
        repository.repositoryId === workflowSnapshot.configuration.primaryRepositoryId ? 1 : 0,
      )
  }
  return record
}
