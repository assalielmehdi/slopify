// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ProjectProfileConfigurationSchema,
  type ProjectProfileConfiguration,
} from '@loop/contracts'

import { ProfileForm } from '../components/settings/profile-form'

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
      executableChecks: [{ executable: 'node', arguments: ['--version'] }],
      verificationCommands: [{ executable: 'pnpm', arguments: ['test'] }],
      mergeRequestLabels: ['backend'],
    },
    {
      repositoryId: 'web',
      displayName: 'Web',
      purpose: 'Operator interface',
      repositoryPath: '/workspace/web',
      gitlabProject: 'group/web',
      remote: 'origin',
      targetBranch: 'main',
      worktreeParent: '/workspace/.worktrees',
      branchTemplate: 'ai/{task}-{run}',
      executableChecks: [],
      verificationCommands: [{ executable: 'pnpm', arguments: ['test'] }],
      mergeRequestLabels: ['frontend'],
    },
  ],
})

afterEach(cleanup)

describe('ProfileForm', () => {
  it('leaves schema-optional list and command fields optional to native form validation', () => {
    render(
      <ProfileForm
        mode="edit"
        profile={profile}
        runtime={{ mode: 'container', root: '/workspace' }}
        onSave={async () => undefined}
      />,
    )

    expect(screen.getByLabelText('API merge request labels').hasAttribute('required')).toBe(false)
    expect(screen.getByLabelText('Tool 1 arguments').hasAttribute('required')).toBe(false)
    expect(screen.getByLabelText('Tool 1 expected output').hasAttribute('required')).toBe(false)
  })

  it('shows the active boundary and saves candidates in the operator-defined order', async () => {
    const onSave = vi.fn<(saved: ProjectProfileConfiguration) => Promise<void>>(
      async () => undefined,
    )
    render(
      <ProfileForm
        mode="edit"
        profile={profile}
        runtime={{ mode: 'container', root: '/workspace' }}
        onSave={onSave}
      />,
    )

    expect(screen.getByText('Compose runtime')).toBeTruthy()
    expect(screen.getByText('/workspace')).toBeTruthy()
    expect(screen.getByText(/host paths are invisible unless mounted/i)).toBeTruthy()

    const webCandidate = screen.getByRole('group', { name: 'Candidate 2: Web' })
    fireEvent.click(within(webCandidate).getByRole('button', { name: 'Move Web up' }))
    fireEvent.change(screen.getByLabelText('Profile name'), {
      target: { value: 'Ordered local profile' },
    })
    fireEvent.submit(screen.getByRole('form', { name: 'Project profile' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      displayName: 'Ordered local profile',
      repositories: [{ repositoryId: 'web' }, { repositoryId: 'api' }],
    })
  })

  it('rejects a Compose path outside the active root but accepts it in native mode', async () => {
    const composeSave = vi.fn<(saved: ProjectProfileConfiguration) => Promise<void>>(
      async () => undefined,
    )
    const { rerender } = render(
      <ProfileForm
        mode="edit"
        profile={profile}
        runtime={{ mode: 'container', root: '/workspace' }}
        onSave={composeSave}
      />,
    )

    fireEvent.change(screen.getByLabelText('API repository path'), {
      target: { value: '/Users/operator/api' },
    })
    fireEvent.submit(screen.getByRole('form', { name: 'Project profile' }))

    expect(await screen.findByText('Path must be inside /workspace.')).toBeTruthy()
    expect(screen.getByLabelText('API repository path').getAttribute('aria-invalid')).toBe('true')
    expect(composeSave).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('API repository path'), {
      target: { value: '/workspace/api' },
    })
    expect(screen.queryByText('Path must be inside /workspace.')).toBeNull()

    const apiRepository = profile.repositories[0]
    const webRepository = profile.repositories[1]
    if (apiRepository === undefined || webRepository === undefined) {
      throw new Error('Expected two profile repositories')
    }
    const nativeSave = vi.fn<(saved: ProjectProfileConfiguration) => Promise<void>>(
      async () => undefined,
    )
    rerender(
      <ProfileForm
        mode="edit"
        profile={{
          ...profile,
          repositories: [
            { ...apiRepository, repositoryPath: '/Users/operator/api' },
            webRepository,
          ],
        }}
        runtime={{ mode: 'native', root: '/' }}
        onSave={nativeSave}
      />,
    )
    fireEvent.submit(screen.getByRole('form', { name: 'Project profile' }))

    await waitFor(() => expect(nativeSave).toHaveBeenCalledTimes(1))
  })

  it('adds bounded structured executable checks without accepting a shell command string', async () => {
    const onSave = vi.fn<(saved: ProjectProfileConfiguration) => Promise<void>>(
      async () => undefined,
    )
    render(
      <ProfileForm
        mode="edit"
        profile={profile}
        runtime={{ mode: 'container', root: '/workspace' }}
        onSave={onSave}
      />,
    )

    const webCandidate = screen.getByRole('group', { name: 'Candidate 2: Web' })
    fireEvent.click(within(webCandidate).getByRole('button', { name: 'Add required tool check' }))
    fireEvent.change(within(webCandidate).getByLabelText('Tool 1 executable'), {
      target: { value: 'node' },
    })
    fireEvent.change(within(webCandidate).getByLabelText('Tool 1 arguments'), {
      target: { value: '--version' },
    })
    fireEvent.change(within(webCandidate).getByLabelText('Tool 1 expected output'), {
      target: { value: 'v24.' },
    })
    fireEvent.submit(screen.getByRole('form', { name: 'Project profile' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0]?.[0].repositories[1]?.executableChecks).toEqual([
      { executable: 'node', arguments: ['--version'], expectedOutputIncludes: 'v24.' },
    ])
    expect(within(webCandidate).queryByLabelText(/shell command/i)).toBeNull()
  })
})
