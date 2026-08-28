// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RepositorySchema } from '@slopify/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RepositorySettings } from '../components/settings/repository-settings'
import type { ResourceEventStreamHandlers } from '../lib/resource-event-stream'
import { toast } from '../lib/toast'

const connections = [
  {
    provider: 'GITHUB' as const,
    accountUsername: 'operator',
    connectedAt: '2026-08-24T00:00:00Z',
    updatedAt: '2026-08-24T00:00:00Z',
  },
]

const remoteRepositories = [
  {
    provider: 'GITHUB' as const,
    remoteId: '303',
    name: 'new-repository',
    fullName: 'operator/new-repository',
    cloneUrl: 'https://github.com/operator/new-repository.git',
    webUrl: 'https://github.com/operator/new-repository',
    visibility: 'PRIVATE' as const,
    defaultBranch: 'main',
  },
]

const repositories = RepositorySchema.array().parse([
  {
    repositoryId: 'repository-01',
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
    repositoryId: 'repository-02',
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
  listRepositories: vi.fn(async () => repositories),
  listGitConnections: vi.fn(async () => connections),
  listGitRepositories: vi.fn(async () => remoteRepositories),
  addRepository: vi.fn(async () =>
    RepositorySchema.parse({
      repositoryId: 'repository-03',
      provider: 'GITHUB',
      remoteId: '303',
      name: 'new-repository',
      fullName: 'operator/new-repository',
      cloneUrl: 'https://github.com/operator/new-repository.git',
      webUrl: 'https://github.com/operator/new-repository',
      defaultBranch: 'main',
      availability: 'AVAILABLE',
      createdAt: '2026-08-21T10:02:00Z',
      updatedAt: '2026-08-21T10:02:00Z',
    }),
  ),
  deleteRepository: vi.fn(async () => undefined),
  ...overrides,
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('RepositorySettings', () => {
  it('shows card skeletons while connections and repositories are loading', async () => {
    let resolve: ((value: typeof repositories) => void) | undefined
    const listRepositories = vi.fn(
      () =>
        new Promise<typeof repositories>((next) => {
          resolve = next
        }),
    )
    render(<RepositorySettings client={createClient({ listRepositories })} />)

    expect(screen.getByRole('status', { name: 'Loading repositories' })).toBeTruthy()
    await act(async () => resolve?.(repositories))
    await waitFor(() =>
      expect(screen.queryByRole('status', { name: 'Loading repositories' })).toBeNull(),
    )
  })

  it('hides the add card before a Git connection is configured', async () => {
    render(
      <RepositorySettings
        client={createClient({
          listRepositories: vi.fn(async () => []),
          listGitConnections: vi.fn(async () => []),
        })}
      />,
    )

    expect(await screen.findByText('No repositories yet')).toBeTruthy()
    expect(
      screen.getByText('Connect GitHub or GitLab in Settings before adding a repository.'),
    ).toBeTruthy()
    expect(screen.queryByTestId('repository-grid')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add repository' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Open Settings' }).getAttribute('href')).toBe(
      '/settings',
    )
  })

  it('shows existing repositories without an add card when no Git connection is configured', async () => {
    render(
      <RepositorySettings client={createClient({ listGitConnections: vi.fn(async () => []) })} />,
    )

    const grid = await screen.findByTestId('repository-grid')
    expect(within(grid).getByRole('button', { name: 'slopify, Available' })).toBeTruthy()
    expect(within(grid).queryByRole('button', { name: 'Add repository' })).toBeNull()
  })

  it.each(['GITHUB', 'GITLAB'] as const)(
    'uses the empty-state add action when %s is configured',
    async (provider) => {
      render(
        <RepositorySettings
          client={createClient({
            listRepositories: vi.fn(async () => []),
            listGitConnections: vi.fn(async () => [
              {
                provider,
                accountUsername: 'operator',
                connectedAt: '2026-08-24T00:00:00Z',
                updatedAt: '2026-08-24T00:00:00Z',
              },
            ]),
          })}
        />,
      )

      expect(await screen.findByText('No repositories yet')).toBeTruthy()
      expect(
        screen.getByText('Add a repository from one of your connected Git providers.'),
      ).toBeTruthy()
      expect(screen.queryByRole('link', { name: 'Open Settings' })).toBeNull()

      const addRepository = screen.getByRole('button', { name: 'Add repository' })
      expect(addRepository.textContent).toBe('Add repository')
      expect(screen.getAllByRole('button', { name: 'Add repository' })).toHaveLength(1)

      fireEvent.click(addRepository)
      expect(await screen.findByRole('dialog', { name: 'Add repository' })).toBeTruthy()
    },
  )

  it('shows remote identity and retains repositories whose connection is missing', async () => {
    render(<RepositorySettings client={createClient()} />)

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
    render(<RepositorySettings client={client} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add repository' }))
    const panel = await screen.findByRole('dialog', { name: 'Add repository' })
    const providerSelect = within(panel).getByRole('combobox', { name: 'Provider' })
    expect(providerSelect.getAttribute('data-slot')).toBe('select-trigger')
    const repositorySelect = within(panel).getByRole('combobox', { name: 'Repository' })
    await waitFor(() =>
      expect((repositorySelect as HTMLInputElement).value).toBe('operator/new-repository'),
    )
    expect(repositorySelect.getAttribute('data-slot')).toBe('combobox-input')
    fireEvent.click(within(panel).getByRole('button', { name: 'Add repository' }))

    await waitFor(() =>
      expect(client.addRepository).toHaveBeenCalledWith({ provider: 'GITHUB', remoteId: '303' }),
    )
    expect(await screen.findByRole('button', { name: 'new-repository, Available' })).toBeTruthy()
    expect(addToast).toHaveBeenCalledWith({
      title: 'Repository added',
      description: 'operator/new-repository is now available in Slopify.',
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
    render(<RepositorySettings client={client} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add repository' }))
    const panel = await screen.findByRole('dialog', { name: 'Add repository' })
    const panelShell = screen.getByTestId('repository-panel-shell')
    await waitFor(() => expect(panelShell.getAttribute('data-open')).toBe('true'))
    const repositoryCombobox = within(panel).getByRole('combobox', { name: 'Repository' })

    expect(repositoryCombobox.getAttribute('data-slot')).toBe('combobox-input')
    fireEvent.click(within(panel).getByRole('button', { name: 'Toggle options' }))
    fireEvent.change(repositoryCombobox, { target: { value: 'review-service' } })
    const matchingOption = await screen.findByRole('option', { name: 'operator/review-service' })
    expect(screen.queryByRole('option', { name: 'operator/new-repository' })).toBeNull()
    fireEvent.pointerDown(matchingOption, { pointerType: 'mouse' })
    fireEvent.click(matchingOption)

    expect(panelShell.getAttribute('data-open')).toBe('true')
    expect((repositoryCombobox as HTMLInputElement).value).toBe('operator/review-service')
    fireEvent.click(within(panel).getByRole('button', { name: 'Add repository' }))
    await waitFor(() =>
      expect(client.addRepository).toHaveBeenCalledWith({ provider: 'GITHUB', remoteId: '304' }),
    )
  })

  it('keeps the dialog open while selecting from a portaled provider menu', async () => {
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
    render(<RepositorySettings client={client} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add repository' }))
    const panel = await screen.findByRole('dialog', { name: 'Add repository' })
    const panelShell = screen.getByTestId('repository-panel-shell')
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

  it('renders the add action after repository cards without a search control', async () => {
    render(<RepositorySettings client={createClient()} />)

    const grid = await screen.findByTestId('repository-grid')
    const repositoryCards = within(grid).getAllByRole('button')

    expect(repositoryCards.map((card) => card.getAttribute('aria-label'))).toEqual([
      'slopify, Available',
      'archived, Connection missing',
      'Add repository',
    ])
    expect(screen.queryByRole('searchbox', { name: 'Search repositories' })).toBeNull()

    const addTile = within(grid).getByRole('button', { name: 'Add repository' })
    expect(addTile.parentElement).toBe(grid)
    fireEvent.click(addTile)
    expect(await screen.findByRole('dialog', { name: 'Add repository' })).toBeTruthy()
  })

  it('requires the exact remote name before deleting immediately without undo', async () => {
    const client = createClient()
    const addToast = vi.spyOn(toast, 'add')
    render(<RepositorySettings client={client} />)

    fireEvent.click(await screen.findByRole('button', { name: 'slopify, Available' }))
    const panel = await screen.findByRole('dialog', { name: 'slopify' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Delete repository' }))
    const confirmation = within(panel).getByLabelText('Repository name confirmation')
    expect(document.activeElement).toBe(confirmation)
    fireEvent.change(confirmation, { target: { value: 'operator/slopify' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(client.deleteRepository).toHaveBeenCalledWith('repository-01'))
    const deletionToast = addToast.mock.calls.find(
      ([options]) => options.title === 'Repository deleted',
    )?.[0]
    expect(deletionToast).toMatchObject({
      description: 'operator/slopify was removed from Slopify.',
      type: 'success',
    })
    expect(deletionToast?.actionProps).toBeUndefined()
    expect(screen.queryByRole('button', { name: 'slopify, Available' })).toBeNull()
  })

  it('dismisses repository deletion confirmation with Escape and clears its value', async () => {
    render(<RepositorySettings client={createClient()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'slopify, Available' }))
    const panel = await screen.findByRole('dialog', { name: 'slopify' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Delete repository' }))
    const confirmation = within(panel).getByLabelText(
      'Repository name confirmation',
    ) as HTMLInputElement
    fireEvent.change(confirmation, { target: { value: 'operator' } })
    fireEvent.keyDown(confirmation, { key: 'Escape' })

    expect(within(panel).getByRole('button', { name: 'Delete repository' })).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: 'Confirm' })).toBeNull()
    expect(confirmation.disabled).toBe(true)
    expect(confirmation.value).toBe('')
  })

  it('dismisses repository deletion confirmation on an outside pointer down', async () => {
    render(<RepositorySettings client={createClient()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'slopify, Available' }))
    const panel = await screen.findByRole('dialog', { name: 'slopify' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Delete repository' }))
    const confirmation = within(panel).getByLabelText(
      'Repository name confirmation',
    ) as HTMLInputElement
    fireEvent.change(confirmation, { target: { value: 'operator' } })
    fireEvent.pointerDown(within(panel).getByRole('link', { name: 'operator/slopify' }))

    expect(within(panel).getByRole('button', { name: 'Delete repository' })).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: 'Confirm' })).toBeNull()
    expect(confirmation.disabled).toBe(true)
    expect(confirmation.value).toBe('')
  })

  it('keeps the floating panel mounted until its close transition exits', async () => {
    render(<RepositorySettings client={createClient()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'slopify, Available' }))
    const panel = await screen.findByRole('dialog', { name: 'slopify' })
    const shell = screen.getByTestId('repository-panel-shell')
    expect(shell.className).toContain('top-[4.25rem]')
    expect(shell.className).toContain('bottom-3')
    expect(shell.className).not.toContain('inset-y-3')
    fireEvent.click(within(panel).getByRole('button', { name: 'Close repository details' }))
    expect(shell.getAttribute('data-open')).toBe('false')
    fireEvent.transitionEnd(shell, { propertyName: 'translate' })
    expect(screen.queryByRole('dialog', { name: 'slopify', hidden: true })).toBeNull()
  })

  it('refreshes the clean repository catalog after an external file change', async () => {
    let handlers: ResourceEventStreamHandlers | undefined
    const externallyAdded = RepositorySchema.parse({
      ...repositories[0],
      repositoryId: 'repository-external',
      remoteId: '505',
      name: 'external',
      fullName: 'operator/external',
      webUrl: 'https://github.com/operator/external',
      cloneUrl: 'https://github.com/operator/external.git',
    })
    const client = createClient({
      listRepositories: vi
        .fn()
        .mockResolvedValueOnce(repositories)
        .mockResolvedValue([...repositories, externallyAdded]),
    })
    render(
      <RepositorySettings
        client={client}
        connectResourceEvents={(nextHandlers) => {
          handlers = nextHandlers
          return vi.fn()
        }}
      />,
    )

    await screen.findByRole('button', { name: 'slopify, Available' })
    await act(async () =>
      handlers?.onEvent({
        sequence: 1,
        timestamp: '2026-08-25T20:00:00.000Z',
        change: 'CHANGED',
        resource: { type: 'REPOSITORIES' },
        revision: 'a'.repeat(64),
      }),
    )

    expect(await screen.findByRole('button', { name: 'external, Available' })).toBeTruthy()
  })
})
