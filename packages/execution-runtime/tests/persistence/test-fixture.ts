import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunIdSchema, WorkflowIdSchema } from '@slopify/contracts'
import { WorkflowSchema, type Workflow } from '@slopify/workflow-model'

import {
  type HarnessCatalog,
  type RunProjectResolution,
  createEventStore,
  createProjectRepository,
  createRunRepository,
  createWorkflowRepository,
  openDatabase,
  type JsonValue,
} from '../../src/index.js'

export const TEST_TIMESTAMP = '2026-08-23T12:00:00.000Z'
export const TEST_WORKFLOW_ID = WorkflowIdSchema.parse('test-workflow')
export const TEST_RUN_ID = RunIdSchema.parse('run-01')
export const TEST_RUN_PROJECT: RunProjectResolution = {
  projectId: 'project-api' as RunProjectResolution['projectId'],
  name: 'API',
  repositoryPath: '/workspace/api',
  baseSha: 'a'.repeat(40) as RunProjectResolution['baseSha'],
  sourceBranch: 'main',
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
  readonly projectIds?: readonly string[]
  readonly primaryProjectId?: string | null
  readonly variables?: readonly string[]
  readonly createdAt?: string
}

export const createTestAgentWorkflow = (input: CreateTestAgentWorkflowInput = {}): Workflow => {
  const createdAt = input.createdAt ?? TEST_TIMESTAMP
  const projectIds = input.projectIds ?? []
  return WorkflowSchema.parse({
    schemaVersion: 1,
    workflowId: input.workflowId ?? TEST_WORKFLOW_ID,
    name: 'Test workflow',
    description: 'A current Pi-backed agent workflow for tests.',
    configuration: {
      projectIds,
      primaryProjectId:
        input.primaryProjectId === undefined ? (projectIds[0] ?? null) : input.primaryProjectId,
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

export const resolveTestProject = async (projectId: string): Promise<RunProjectResolution> => ({
  ...TEST_RUN_PROJECT,
  projectId: projectId as RunProjectResolution['projectId'],
})

export const createTestRunProjects = (workflow: Workflow): readonly RunProjectResolution[] =>
  workflow.configuration.projectIds.map((projectId) => ({
    ...TEST_RUN_PROJECT,
    projectId,
    name: projectId === TEST_RUN_PROJECT.projectId ? TEST_RUN_PROJECT.name : projectId,
    repositoryPath:
      projectId === TEST_RUN_PROJECT.projectId
        ? TEST_RUN_PROJECT.repositoryPath
        : `/workspace/${projectId}`,
  }))

export const createPersistenceFixture = (workflow = createTestAgentWorkflow()) => {
  const directory = join(tmpdir(), `slopify-persistence-${crypto.randomUUID()}`)
  const path = join(directory, 'state', 'workbench.sqlite')
  const database = openDatabase({ path })
  const workflows = createWorkflowRepository(database)
  const projects = createProjectRepository(database)
  const runs = createRunRepository(database)
  const events = createEventStore(database)

  workflows.save(workflow)

  const cleanup = (): void => {
    if (database.isOpen) database.close()
    rmSync(directory, { force: true, recursive: true })
  }

  return { database, events, path, projects, workflow, runs, workflows, cleanup }
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
    projects: createTestRunProjects(workflowSnapshot),
  })
