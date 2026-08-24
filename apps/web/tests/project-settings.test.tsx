// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import {
  DeletionReceiptSchema,
  ProjectSchema,
  UndoDeletionResponseSchema,
} from '@slopify/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProjectSettings } from '../components/settings/project-settings'
import { toast } from '../lib/toast'

const connections = [
  {
    provider: 'GITHUB' as const,
    accountUsername: 'operator',
    connectedAt: '2026-08-24T00:00:00Z',
    updatedAt: '2026-08-24T00:00:00Z',
  },
]

const repositories = [
  {
    provider: 'GITHUB' as const,
    remoteId: '303',
    name: 'new-project',
    fullName: 'operator/new-project',
    cloneUrl: 'https://github.com/operator/new-project.git',
    webUrl: 'https://github.com/operator/new-project',
    visibility: 'PRIVATE' as const,
    defaultBranch: 'main',
  },
]

const projects = ProjectSchema.array().parse([
  {
    projectId: 'project-01',
    name: 'slopify',
    provider: 'GITHUB',
    remoteId: '101',
    fullName: 'operator/slopify',
    cloneUrl: 'https://github.com/operator/slopify.git',
    webUrl: 'https://github.com/operator/slopify',
    defaultBranch: 'main',
    availability: 'AVAILABLE',
    createdAt: '2026-08-21T10:00:00Z',
    updatedAt: '2026-08-21T10:00:00Z',
  },
  {
    projectId: 'project-02',
    name: 'archived',
    provider: 'GITLAB',
    remoteId: '202',
    fullName: 'operator/archived',
    cloneUrl: 'https://gitlab.com/operator/archived.git',
    webUrl: 'https://gitlab.com/operator/archived',
    defaultBranch: 'trunk',
    availability: 'CONNECTION_MISSING',
    createdAt: '2026-08-21T10:01:00Z',
    updatedAt: '2026-08-21T10:01:00Z',
  },
])

const createClient = (overrides: Record<string, unknown> = {}) => ({
  listProjects: vi.fn(async () => projects),
  listGitConnections: vi.fn(async () => connections),
  listGitRepositories: vi.fn(async () => repositories),
  addProject: vi.fn(async () =>
    ProjectSchema.parse({
      projectId: 'project-03',
      provider: 'GITHUB',
      remoteId: '303',
      name: 'new-project',
      fullName: 'operator/new-project',
      cloneUrl: 'https://github.com/operator/new-project.git',
      webUrl: 'https://github.com/operator/new-project',
      defaultBranch: 'main',
      availability: 'AVAILABLE',
      createdAt: '2026-08-21T10:02:00Z',
      updatedAt: '2026-08-21T10:02:00Z',
    }),
  ),
  deleteProject: vi.fn(async (projectId: string) => {
    const deletedAt = new Date()
    return DeletionReceiptSchema.parse({
      deletionId: `deletion-${projectId}`,
      subject: { type: 'PROJECT', id: projectId },
      deletedAt: deletedAt.toISOString(),
      undoExpiresAt: new Date(deletedAt.getTime() + 10_000).toISOString(),
    })
  }),
  undoDeletion: vi.fn(async (deletionId: string) =>
    UndoDeletionResponseSchema.parse({
      deletionId,
      subject: { type: 'PROJECT', id: 'project-01' },
      deletedAt: new Date().toISOString(),
      undoExpiresAt: new Date(Date.now() + 10_000).toISOString(),
      state: 'UNDONE',
    }),
  ),
  ...overrides,
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ProjectSettings', () => {
  it('shows card skeletons while connections and projects are loading', async () => {
    let resolve: ((value: typeof projects) => void) | undefined
    const listProjects = vi.fn(
      () =>
        new Promise<typeof projects>((next) => {
          resolve = next
        }),
    )
    render(<ProjectSettings client={createClient({ listProjects })} />)

    expect(screen.getByRole('status', { name: 'Loading projects' })).toBeTruthy()
    await act(async () => resolve?.(projects))
    await waitFor(() =>
      expect(screen.queryByRole('status', { name: 'Loading projects' })).toBeNull(),
    )
  })

  it('requires a Git connection before a project can be added', async () => {
    render(
      <ProjectSettings
        client={createClient({
          listProjects: vi.fn(async () => []),
          listGitConnections: vi.fn(async () => []),
        })}
      />,
    )

    expect(await screen.findByText('No projects yet')).toBeTruthy()
    expect(
      screen.getByText('Connect GitHub or GitLab in Settings before adding a project.'),
    ).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Add project' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(screen.getByRole('link', { name: 'Open Settings' }).getAttribute('href')).toBe(
      '/settings',
    )
  })

  it('shows remote identity and retains projects whose connection is missing', async () => {
    render(<ProjectSettings client={createClient()} />)

    const available = await screen.findByRole('button', { name: 'slopify, Available' })
    const disconnected = screen.getByRole('button', { name: 'archived, Connection missing' })

    expect(within(available).getByTestId('github-logo')).toBeTruthy()
    expect(within(available).getByText('GitHub repository')).toBeTruthy()
    expect(within(available).getByText('operator/slopify')).toBeTruthy()
    expect(within(disconnected).getByTestId('gitlab-logo')).toBeTruthy()
    expect(disconnected.className).toContain('opacity-70')
    expect(within(disconnected).getByText('Connection missing')).toBeTruthy()
  })

  it('adds a repository selected from a connected provider', async () => {
    const client = createClient()
    const addToast = vi.spyOn(toast, 'add')
    render(<ProjectSettings client={client} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add project' }))
    const panel = await screen.findByRole('dialog', { name: 'Add project' })
    const providerSelect = within(panel).getByRole('combobox', { name: 'Provider' })
    expect(providerSelect.getAttribute('data-slot')).toBe('select-trigger')
    const repositorySelect = within(panel).getByRole('combobox', { name: 'Repository' })
    await waitFor(() =>
      expect((repositorySelect as HTMLInputElement).value).toBe('operator/new-project'),
    )
    expect(repositorySelect.getAttribute('data-slot')).toBe('combobox-input')
    fireEvent.click(within(panel).getByRole('button', { name: 'Add project' }))

    await waitFor(() =>
      expect(client.addProject).toHaveBeenCalledWith({ provider: 'GITHUB', remoteId: '303' }),
    )
    expect(await screen.findByRole('button', { name: 'new-project, Available' })).toBeTruthy()
    expect(addToast).toHaveBeenCalledWith({
      title: 'Project added',
      description: 'operator/new-project is now available in Slopify.',
      type: 'success',
    })
  })

  it('searches repositories and submits the selected match', async () => {
    const matchingRepository = {
      provider: 'GITHUB' as const,
      remoteId: '304',
      name: 'review-service',
      fullName: 'operator/review-service',
      cloneUrl: 'https://github.com/operator/review-service.git',
      webUrl: 'https://github.com/operator/review-service',
      visibility: 'PRIVATE' as const,
      defaultBranch: 'main',
    }
    const client = createClient({
      listGitRepositories: vi.fn(async () => [...repositories, matchingRepository]),
    })
    render(<ProjectSettings client={client} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add project' }))
    const panel = await screen.findByRole('dialog', { name: 'Add project' })
    const panelShell = screen.getByTestId('project-panel-shell')
    await waitFor(() => expect(panelShell.getAttribute('data-open')).toBe('true'))
    const repositoryCombobox = within(panel).getByRole('combobox', { name: 'Repository' })

    expect(repositoryCombobox.getAttribute('data-slot')).toBe('combobox-input')
    fireEvent.click(within(panel).getByRole('button', { name: 'Toggle options' }))
    fireEvent.change(repositoryCombobox, { target: { value: 'review-service' } })
    const matchingOption = await screen.findByRole('option', { name: 'operator/review-service' })
    expect(screen.queryByRole('option', { name: 'operator/new-project' })).toBeNull()
    fireEvent.pointerDown(matchingOption, { pointerType: 'mouse' })
    fireEvent.click(matchingOption)

    expect(panelShell.getAttribute('data-open')).toBe('true')
    expect((repositoryCombobox as HTMLInputElement).value).toBe('operator/review-service')
    fireEvent.click(within(panel).getByRole('button', { name: 'Add project' }))
    await waitFor(() =>
      expect(client.addProject).toHaveBeenCalledWith({ provider: 'GITHUB', remoteId: '304' }),
    )
  })

  it('keeps the drawer open while selecting from a portaled provider menu', async () => {
    const gitLabConnection = {
      provider: 'GITLAB' as const,
      accountUsername: 'operator',
      connectedAt: '2026-08-24T00:00:00Z',
      updatedAt: '2026-08-24T00:00:00Z',
    }
    const gitLabRepository = {
      provider: 'GITLAB' as const,
      remoteId: '404',
      name: 'review-service',
      fullName: 'operator/review-service',
      cloneUrl: 'https://gitlab.com/operator/review-service.git',
      webUrl: 'https://gitlab.com/operator/review-service',
      visibility: 'PRIVATE' as const,
      defaultBranch: 'main',
    }
    const client = createClient({
      listGitConnections: vi.fn(async () => [...connections, gitLabConnection]),
      listGitRepositories: vi.fn(async (provider: 'GITHUB' | 'GITLAB') =>
        provider === 'GITHUB' ? repositories : [gitLabRepository],
      ),
    })
    render(<ProjectSettings client={client} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add project' }))
    const panel = await screen.findByRole('dialog', { name: 'Add project' })
    const panelShell = screen.getByTestId('project-panel-shell')
    await waitFor(() => expect(panelShell.getAttribute('data-open')).toBe('true'))
    fireEvent.click(within(panel).getByRole('combobox', { name: 'Provider' }))
    const gitLabOption = screen.getByRole('option', { name: 'GitLab' })
    fireEvent.pointerDown(gitLabOption, { pointerType: 'mouse' })
    fireEvent.click(gitLabOption)

    expect(panelShell.getAttribute('data-open')).toBe('true')
    await waitFor(() =>
      expect(
        (within(panel).getByRole('combobox', { name: 'Repository' }) as HTMLInputElement).value,
      ).toBe('operator/review-service'),
    )
  })

  it('filters projects by provider and full repository name', async () => {
    render(<ProjectSettings client={createClient()} />)

    await screen.findByRole('button', { name: 'slopify, Available' })
    fireEvent.click(screen.getByRole('button', { name: 'Open project search' }))
    const search = screen.getByRole('searchbox', { name: 'Search projects' })
    fireEvent.change(search, { target: { value: 'gitlab' } })

    expect(screen.queryByRole('button', { name: 'slopify, Available' })).toBeNull()
    expect(screen.getByRole('button', { name: 'archived, Connection missing' })).toBeTruthy()
  })

  it('requires the exact remote name before deleting and supports undo', async () => {
    const client = createClient()
    const addToast = vi.spyOn(toast, 'add')
    render(<ProjectSettings client={client} />)

    fireEvent.click(await screen.findByRole('button', { name: 'slopify, Available' }))
    const panel = await screen.findByRole('dialog', { name: 'slopify' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Delete project' }))
    const confirmation = within(panel).getByLabelText('Repository name confirmation')
    expect(document.activeElement).toBe(confirmation)
    fireEvent.change(confirmation, { target: { value: 'operator/slopify' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(client.deleteProject).toHaveBeenCalledWith('project-01'))
    const deletionToast = addToast.mock.calls.find(
      ([options]) => options.title === 'Project deleted',
    )?.[0]
    expect(deletionToast).toMatchObject({
      description: 'operator/slopify was removed from Slopify.',
      actionProps: { children: 'Undo' },
    })

    await act(async () => {
      await deletionToast?.actionProps?.onClick?.({ preventDefault: vi.fn() } as never)
    })
    await waitFor(() => expect(client.undoDeletion).toHaveBeenCalled())
  })

  it('keeps the floating panel mounted until its close transition exits', async () => {
    render(<ProjectSettings client={createClient()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'slopify, Available' }))
    const panel = await screen.findByRole('dialog', { name: 'slopify' })
    const shell = screen.getByTestId('project-panel-shell')
    expect(shell.className).toContain('top-[4.25rem]')
    expect(shell.className).toContain('bottom-3')
    expect(shell.className).not.toContain('inset-y-3')
    fireEvent.click(within(panel).getByRole('button', { name: 'Close project details' }))
    expect(shell.getAttribute('data-open')).toBe('false')
    fireEvent.transitionEnd(shell, { propertyName: 'translate' })
    expect(screen.queryByRole('dialog', { name: 'slopify', hidden: true })).toBeNull()
  })
})
