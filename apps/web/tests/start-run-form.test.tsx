// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ProjectProfileCatalogResponseSchema,
  ProjectProfileConfigurationSchema,
  ProjectProfileReadinessSchema,
  RevisionIdSchema,
  RunIdSchema,
  WorkflowIdSchema,
} from '@loop/contracts'

import { StartRunForm } from '../components/runs/start-run-form'
import {
  ApiClientError,
  type ApiClient,
  type ClickUpTaskSnapshot,
  type StartRunResponse,
  type WorkflowCatalogEntry,
} from '../lib/api-client'

const profile = ProjectProfileConfigurationSchema.parse({
  profileId: 'local-profile',
  displayName: 'Local delivery',
  clickupWorkspaceId: 'workspace-01',
  clickupListId: 'list-01',
  clickupInReviewStatusId: 'in-review',
  repositories: [
    {
      repositoryId: 'api',
      displayName: 'API',
      purpose: 'Backend services',
      repositoryPath: '/workspace/api',
      gitlabProject: 'group/api',
      remote: 'origin',
      targetBranch: 'main',
      worktreeParent: '/workspace/.worktrees',
      branchTemplate: 'ai/{task}-{run}',
      executableChecks: [],
      verificationCommands: [],
      mergeRequestLabels: [],
    },
    {
      repositoryId: 'web',
      displayName: 'Web',
      purpose: 'Operator workbench',
      repositoryPath: '/workspace/web',
      gitlabProject: 'group/web',
      remote: 'origin',
      targetBranch: 'develop',
      worktreeParent: '/workspace/.worktrees',
      branchTemplate: 'ai/{task}-{run}',
      executableChecks: [],
      verificationCommands: [],
      mergeRequestLabels: [],
    },
  ],
})

const workflows: readonly WorkflowCatalogEntry[] = [
  {
    workflowId: WorkflowIdSchema.parse('delivery-workflow'),
    name: 'Delivery workflow',
    latestRevisionId: RevisionIdSchema.parse('revision-02'),
    revisions: [
      {
        revisionId: RevisionIdSchema.parse('revision-02'),
        parentRevisionId: RevisionIdSchema.parse('revision-01'),
        createdAt: '2026-08-20T10:00:00Z',
      },
      {
        revisionId: RevisionIdSchema.parse('revision-01'),
        parentRevisionId: null,
        createdAt: '2026-08-19T10:00:00Z',
      },
    ],
  },
]

const workflowId = WorkflowIdSchema.parse('delivery-workflow')
const latestRevisionId = RevisionIdSchema.parse('revision-02')

const task: ClickUpTaskSnapshot = {
  taskId: '86abc123',
  customTaskId: 'PROJ-42',
  url: 'https://app.clickup.com/t/86abc123',
  title: 'Resolve and confirm the task',
  description: 'Keep repository selection inside the workflow.',
  status: { id: 'status-1', name: 'in progress', type: 'custom' },
  priority: { id: '2', name: 'high' },
  comments: [],
  resourceLinks: [],
}

const run: StartRunResponse = {
  runId: RunIdSchema.parse('run-01'),
  workflowId,
  revisionId: latestRevisionId,
  profileSnapshotId: 'profile-snapshot-01',
  taskReference: task.taskId,
  notes: 'Coordinate API and web delivery.',
  taskSnapshot: JSON.parse(JSON.stringify(task)),
  effectiveConfiguration: {},
  status: 'PENDING',
  currentNodeId: null,
  transitionCount: 0,
  createdAt: '2026-08-20T10:05:00Z',
  startedAt: null,
  completedAt: null,
}

const createClient = (ready = true) => {
  const resolveClickUpTask = vi.fn<ApiClient['resolveClickUpTask']>(async () => task)
  const startRun = vi.fn<ApiClient['startRun']>(async () => run)
  const getProjectProfileReadiness = vi.fn<ApiClient['getProjectProfileReadiness']>(async () =>
    ProjectProfileReadinessSchema.parse({
      profileId: profile.profileId,
      ready,
      repositories: profile.repositories.map(({ repositoryId }) => ({
        repositoryId,
        ready,
        findings: ready
          ? []
          : [{ category: 'filesystem', code: 'PATH_MISSING', message: 'Path is missing' }],
      })),
    }),
  )
  const client: ApiClient = {
    getHealth: vi.fn(),
    listProjectProfiles: vi.fn(async () =>
      ProjectProfileCatalogResponseSchema.parse({
        profiles: [profile],
        runtime: { mode: 'container', root: '/workspace' },
      }),
    ),
    createProjectProfile: vi.fn(),
    updateProjectProfile: vi.fn(),
    getProjectProfileReadiness,
    getConnectorStatus: vi.fn(),
    listWorkflows: vi.fn(async () => workflows),
    getWorkflowRevision: vi.fn(),
    createWorkflowRevision: vi.fn(),
    resolveClickUpTask,
    startRun,
  }
  return { client, getProjectProfileReadiness, resolveClickUpTask, startRun }
}

const resolveAndConfirm = async () => {
  fireEvent.change(await screen.findByLabelText('ClickUp task ID or URL'), {
    target: { value: task.taskId },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Resolve task' }))
  expect(await screen.findByRole('heading', { name: task.title })).toBeTruthy()
  fireEvent.click(
    screen.getByLabelText(/confirm this task, revision, profile, candidates, and targets/i),
  )
}

afterEach(cleanup)

describe('StartRunForm', () => {
  it('defaults to the latest revision and gates start on a read-only confirmation', async () => {
    const { client, resolveClickUpTask } = createClient()
    render(<StartRunForm client={client} />)

    expect(((await screen.findByLabelText('Workflow revision')) as HTMLSelectElement).value).toBe(
      'revision-02',
    )
    expect((screen.getByLabelText('Project profile') as HTMLSelectElement).value).toBe(
      profile.profileId,
    )
    expect(
      screen.getByRole('button', { name: 'Start confirmed run' }).hasAttribute('disabled'),
    ).toBe(true)
    expect(
      screen.getByText(
        /repository-selection agent chooses the affected subset after the run starts/i,
      ),
    ).toBeTruthy()

    await resolveAndConfirm()

    expect(resolveClickUpTask).toHaveBeenCalledWith({
      taskReference: task.taskId,
      profileId: profile.profileId,
    })
    expect(screen.getByText('API')).toBeTruthy()
    expect(screen.getByText('Target main')).toBeTruthy()
    expect(screen.getByText('Web')).toBeTruthy()
    expect(screen.getByText('Target develop')).toBeTruthy()
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    expect(
      screen.getByRole('button', { name: 'Start confirmed run' }).hasAttribute('disabled'),
    ).toBe(false)
  })

  it('invalidates confirmation when the selected revision changes', async () => {
    const { client } = createClient()
    render(<StartRunForm client={client} />)
    await resolveAndConfirm()

    fireEvent.change(screen.getByLabelText('Workflow revision'), {
      target: { value: 'revision-01' },
    })

    expect((screen.getByLabelText(/confirm this task/i) as HTMLInputElement).checked).toBe(false)
    expect(
      screen.getByRole('button', { name: 'Start confirmed run' }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('keeps an unready profile server-confirmed and blocks submission', async () => {
    const { client } = createClient(false)
    render(<StartRunForm client={client} />)

    fireEvent.change(await screen.findByLabelText('ClickUp task ID or URL'), {
      target: { value: task.taskId },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Resolve task' }))

    expect(await screen.findByText('Project profile is not ready.')).toBeTruthy()
    expect(screen.getByLabelText('Project profile').getAttribute('aria-invalid')).toBe('true')
    expect(
      screen.getByRole('button', { name: 'Start confirmed run' }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('starts only from the confirmed state and links the server-confirmed run', async () => {
    const { client, startRun } = createClient()
    render(<StartRunForm client={client} />)
    await resolveAndConfirm()
    fireEvent.change(screen.getByLabelText('Run notes'), {
      target: { value: 'Coordinate API and web delivery.' },
    })

    fireEvent.submit(screen.getByRole('form', { name: 'Start a run' }))

    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1))
    expect(startRun).toHaveBeenCalledWith({
      taskReference: task.taskId,
      workflowId: 'delivery-workflow',
      revisionId: 'revision-02',
      profileId: profile.profileId,
      notes: 'Coordinate API and web delivery.',
    })
    const link = await screen.findByRole('link', { name: 'Open run run-01' })
    expect(link.getAttribute('href')).toBe('/runs/run-01')
  })

  it('associates task-resolution errors with the task reference', async () => {
    const { client } = createClient()
    client.resolveClickUpTask = vi.fn(async () => {
      throw new ApiClientError({
        code: 'TASK_RESOLUTION_FAILED',
        message: 'Task could not be resolved',
        status: 422,
      })
    })
    render(<StartRunForm client={client} />)
    const input = await screen.findByLabelText('ClickUp task ID or URL')
    fireEvent.change(input, { target: { value: 'malformed-task' } })
    fireEvent.click(screen.getByRole('button', { name: 'Resolve task' }))

    expect(await screen.findByText('Task could not be resolved')).toBeTruthy()
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toContain('task-reference-error')
  })

  it('preserves the confirmed form and links the active run on conflict', async () => {
    const { client } = createClient()
    client.startRun = vi.fn(async () => {
      throw new ApiClientError({
        code: 'RUN_ACTIVE',
        message: 'Another run is already active',
        status: 409,
        details: { activeRunId: 'run-active-01' },
      })
    })
    render(<StartRunForm client={client} />)
    await resolveAndConfirm()
    fireEvent.submit(screen.getByRole('form', { name: 'Start a run' }))

    const link = await screen.findByRole('link', { name: 'Open active run run-active-01' })
    expect(link.getAttribute('href')).toBe('/runs/run-active-01')
    expect(screen.getByRole('heading', { name: task.title })).toBeTruthy()
    expect((screen.getByLabelText(/confirm this task/i) as HTMLInputElement).checked).toBe(true)
  })
})
