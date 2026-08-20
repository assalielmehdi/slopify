// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ProjectProfileConfigurationSchema,
  ProjectProfileCatalogResponseSchema,
  ProjectProfileReadinessSchema,
} from '@loop/contracts'

import { ProjectProfileSettings } from '../components/settings/project-profile-settings'
import type { ApiClient } from '../lib/api-client'

const profile = ProjectProfileConfigurationSchema.parse({
  profileId: 'local-profile',
  displayName: 'Local profile',
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
  ],
})

const readiness = ProjectProfileReadinessSchema.parse({
  profileId: profile.profileId,
  ready: true,
  repositories: [{ repositoryId: 'api', ready: true, findings: [] }],
})

const createClient = () => {
  const updateProjectProfile = vi.fn<ApiClient['updateProjectProfile']>(async (saved) => saved)
  const createProjectProfile = vi.fn<ApiClient['createProjectProfile']>(async (saved) => saved)
  const getProjectProfileReadiness = vi.fn<ApiClient['getProjectProfileReadiness']>(
    async () => readiness,
  )
  const client: ApiClient = {
    getHealth: vi.fn(),
    listWorkflows: vi.fn(),
    getWorkflowRevision: vi.fn(),
    createWorkflowRevision: vi.fn(),
    resolveClickUpTask: vi.fn(),
    startRun: vi.fn(),
    getRun: vi.fn(),
    cancelRun: vi.fn(),
    listProjectProfiles: vi.fn<ApiClient['listProjectProfiles']>(async () =>
      ProjectProfileCatalogResponseSchema.parse({
        profiles: [profile],
        runtime: { mode: 'container', root: '/workspace' },
      }),
    ),
    getConnectorStatus: vi.fn(async () => ({
      clickup: false,
      gitlab: true,
      modelProvider: true,
    })),
    getProjectProfileReadiness,
    updateProjectProfile,
    createProjectProfile,
  }
  return { client, createProjectProfile, getProjectProfileReadiness, updateProjectProfile }
}

afterEach(cleanup)

describe('ProjectProfileSettings', () => {
  it('settles a catalog failure into an error state instead of an endless loader', async () => {
    const { client } = createClient()
    client.listProjectProfiles = vi.fn(async () => {
      throw new Error('Profile catalog is unavailable')
    })

    render(<ProjectProfileSettings client={client} />)

    expect(await screen.findByText('Profile catalog is unavailable')).toBeTruthy()
    expect(screen.queryByText('Loading project profiles…')).toBeNull()
  })

  it('loads the selected profile and refreshes readiness after a confirmed update', async () => {
    const { client, getProjectProfileReadiness, updateProjectProfile } = createClient()
    render(<ProjectProfileSettings client={client} />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy()
    expect(await screen.findByRole('group', { name: 'API readiness' })).toBeTruthy()
    expect((screen.getByLabelText('Profile') as HTMLSelectElement).value).toBe(profile.profileId)

    fireEvent.change(screen.getByLabelText('Profile name'), {
      target: { value: 'Updated local profile' },
    })
    fireEvent.submit(screen.getByRole('form', { name: 'Project profile' }))

    await waitFor(() => expect(updateProjectProfile).toHaveBeenCalledTimes(1))
    expect(updateProjectProfile.mock.calls[0]?.[0].displayName).toBe('Updated local profile')
    await waitFor(() => expect(getProjectProfileReadiness).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('status').textContent).toContain('Profile saved')
  })

  it('creates a new valid profile and selects the server-confirmed result', async () => {
    const { client, createProjectProfile } = createClient()
    render(<ProjectProfileSettings client={client} />)
    await screen.findByLabelText('Profile')

    fireEvent.click(screen.getByRole('button', { name: 'New profile' }))
    fireEvent.change(screen.getByLabelText('Profile ID'), { target: { value: 'second-profile' } })
    fireEvent.change(screen.getByLabelText('Profile name'), { target: { value: 'Second profile' } })
    fireEvent.change(screen.getByLabelText('ClickUp workspace ID'), {
      target: { value: 'workspace-02' },
    })
    fireEvent.change(screen.getByLabelText('ClickUp list ID'), { target: { value: 'list-02' } })
    fireEvent.change(screen.getByLabelText('ClickUp in-review status ID'), {
      target: { value: 'review' },
    })
    fireEvent.change(screen.getByLabelText('repository-1 repository ID'), {
      target: { value: 'service' },
    })
    fireEvent.change(screen.getByLabelText('service display name'), {
      target: { value: 'Service' },
    })
    fireEvent.change(screen.getByLabelText('Service purpose'), {
      target: { value: 'Service code' },
    })
    fireEvent.change(screen.getByLabelText('Service repository path'), {
      target: { value: '/workspace/service' },
    })
    fireEvent.change(screen.getByLabelText('Service GitLab project'), {
      target: { value: 'group/service' },
    })
    fireEvent.change(screen.getByLabelText('Service worktree parent'), {
      target: { value: '/workspace/.worktrees' },
    })
    fireEvent.submit(screen.getByRole('form', { name: 'Project profile' }))

    await waitFor(() => expect(createProjectProfile).toHaveBeenCalledTimes(1))
    expect(createProjectProfile.mock.calls[0]?.[0]).toMatchObject({
      profileId: 'second-profile',
      repositories: [{ repositoryId: 'service' }],
    })
    await waitFor(() => {
      expect((screen.getByLabelText('Profile') as HTMLSelectElement).value).toBe('second-profile')
    })
  })
})
