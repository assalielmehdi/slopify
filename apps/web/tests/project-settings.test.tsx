// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DeletionReceiptSchema,
  ProjectSchema,
  UndoDeletionResponseSchema,
} from '@slopify/contracts'

import { ProjectSettings } from '../components/settings/project-settings'
import { toast } from '../lib/toast'

const projects = ProjectSchema.array().parse([
  {
    projectId: 'project-01',
    name: 'slopify',
    repositoryPath: '/workspace/slopify',
    availability: 'AVAILABLE',
    createdAt: '2026-08-21T10:00:00Z',
    updatedAt: '2026-08-21T10:00:00Z',
  },
  {
    projectId: 'project-02',
    name: 'deleted-project',
    repositoryPath: '/workspace/deleted-project',
    availability: 'MISSING',
    createdAt: '2026-08-21T10:01:00Z',
    updatedAt: '2026-08-21T10:01:00Z',
  },
])

const createClient = (overrides: Record<string, unknown> = {}) => ({
  listProjects: vi.fn(async () => projects),
  addProject: vi.fn(async ({ repositoryPath }: { repositoryPath: string }) =>
    ProjectSchema.parse({
      projectId: 'project-03',
      name: 'new-project',
      repositoryPath,
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
  it('shows card skeletons while projects are loading', async () => {
    let resolve: ((value: typeof projects) => void) | undefined
    const listProjects = vi.fn(
      () =>
        new Promise<typeof projects>((next) => {
          resolve = next
        }),
    )
    render(<ProjectSettings client={createClient({ listProjects })} />)

    expect(screen.getByRole('status', { name: 'Loading projects' })).toBeTruthy()
    expect(screen.getAllByTestId('catalog-card-skeleton')).toHaveLength(3)
    expect(screen.queryByText('No projects yet')).toBeNull()

    await act(async () => resolve?.(projects))
    await waitFor(() =>
      expect(screen.queryByRole('status', { name: 'Loading projects' })).toBeNull(),
    )
  })

  it('shows an explicit empty state before the first repository is added', async () => {
    render(<ProjectSettings client={createClient({ listProjects: vi.fn(async () => []) })} />)

    expect(await screen.findByText('No projects yet')).toBeTruthy()
    expect(
      screen.getByText('Add a local Git repository to make it available to workflows.'),
    ).toBeTruthy()
  })

  it('uses the shared catalog card layout without a view selector', async () => {
    render(<ProjectSettings client={createClient()} />)

    const catalog = screen.getByRole('region', { name: 'Projects' })
    const projectGrid = await within(catalog).findByTestId('project-grid')
    const projectCard = within(catalog).getByRole('button', { name: /slopify, Available/ })
    const searchSlot = catalog.querySelector('search')
    if (searchSlot === null) throw new Error('Expected the native search landmark')
    const add = within(catalog).getByRole('button', { name: 'Add project' })

    expect(catalog.className).toContain('px-6')
    expect(catalog.className).toContain('pt-6')
    expect(projectGrid.className).toContain('auto-fill')
    const projectCardClasses = projectCard.className.split(/\s+/)
    expect(projectCardClasses).toContain('h-auto')
    expect(projectCardClasses).toContain('min-h-[140px]')
    expect(projectCardClasses).not.toContain('h-[140px]')
    expect(within(catalog).queryByRole('radiogroup', { name: 'View options' })).toBeNull()
    expect(searchSlot.className).toContain('[--resize-dur:var(--duration-very-slow)]')
    expect(add.className).toContain('t-resize')
    expect(add.className).toContain('w-8')
    expect(add.className).toContain('hover:w-max')
    expect(add.className).not.toMatch(/hover:w-\d/)
    expect(add.className).toContain('[--resize-dur:var(--duration-very-slow)]')
    expect(within(catalog).queryByRole('button', { name: 'Refresh from filesystem' })).toBeNull()
    const tags = (await within(catalog).findByText('Available')).closest(
      '[data-slot="catalog-card-tags"]',
    )
    expect(tags?.className).toContain('justify-end')
    expect(tags?.className).toContain('pt-2')
  })

  it('filters projects by name and repository path while typing', async () => {
    render(<ProjectSettings client={createClient()} />)

    await screen.findByRole('button', { name: /slopify, Available/ })
    fireEvent.click(screen.getByRole('button', { name: 'Open project search' }))
    const search = screen.getByRole('searchbox', { name: 'Search projects' })
    expect(document.activeElement).toBe(search)

    fireEvent.change(search, { target: { value: 'deleted' } })
    expect(screen.queryByRole('button', { name: /slopify, Available/ })).toBeNull()
    expect(screen.getByRole('button', { name: /deleted-project/ })).toBeTruthy()

    fireEvent.change(search, { target: { value: '/workspace/slopify' } })
    expect(screen.getByRole('button', { name: /slopify, Available/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /deleted-project/ })).toBeNull()

    fireEvent.change(search, { target: { value: 'no-result' } })
    expect(screen.getByText('No matching projects')).toBeTruthy()
  })

  it('keeps a missing project visible, muted, and explicitly labeled', async () => {
    render(<ProjectSettings client={createClient()} />)

    const missingProject = await screen.findByRole('button', {
      name: /deleted-project, Can't find in file system/,
    })

    expect(missingProject.className).toContain('opacity-60')
    expect(within(missingProject).getByText("Can't find in file system")).toBeTruthy()
    expect(within(missingProject).getByText('/workspace/deleted-project')).toBeTruthy()
  })

  it('adds a project using only its absolute local path and refreshes the catalog', async () => {
    const client = createClient()
    const addToast = vi.spyOn(toast, 'add')
    render(<ProjectSettings client={client} />)

    await screen.findByRole('button', { name: /slopify, Available/ })
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }))
    const panel = await screen.findByRole('dialog', { name: 'Add project' })
    fireEvent.change(within(panel).getByLabelText('Absolute local path'), {
      target: { value: '/workspace/new-project' },
    })
    fireEvent.click(within(panel).getByRole('button', { name: 'Add project' }))

    await waitFor(() =>
      expect(client.addProject).toHaveBeenCalledWith({
        repositoryPath: '/workspace/new-project',
      }),
    )
    expect(await screen.findByRole('button', { name: /new-project, Available/ })).toBeTruthy()
    expect(addToast).toHaveBeenCalledWith({
      title: 'Project added',
      description: 'new-project is now available in Slopify.',
      type: 'success',
    })
  })

  it('shows API validation failures without adding a local fallback project', async () => {
    const client = createClient({
      addProject: vi.fn(async () => {
        throw new Error('Project path must be a Git repository')
      }),
    })
    render(<ProjectSettings client={client} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add project' }))
    const panel = await screen.findByRole('dialog', { name: 'Add project' })
    fireEvent.change(within(panel).getByLabelText('Absolute local path'), {
      target: { value: '/workspace/not-git' },
    })
    fireEvent.click(within(panel).getByRole('button', { name: 'Add project' }))

    expect(await screen.findByText('Project path must be a Git repository')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /not-git, Available/ })).toBeNull()
  })

  it('keeps add and detail panels mounted while their shared close transition plays', async () => {
    render(<ProjectSettings client={createClient()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add project' }))
    const addPanel = await screen.findByRole('dialog', { name: 'Add project' })
    const addShell = screen.getByTestId('project-panel-shell')
    expect(addShell.className).toContain('floating-panel-shell')
    fireEvent.click(within(addPanel).getByRole('button', { name: 'Close project details' }))
    expect(addShell.getAttribute('data-open')).toBe('false')
    expect(screen.getByRole('dialog', { name: 'Add project', hidden: true })).toBeTruthy()
    fireEvent.transitionEnd(addShell, { propertyName: 'translate' })
    expect(screen.queryByRole('dialog', { name: 'Add project', hidden: true })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /slopify, Available/ }))
    const detailPanel = await screen.findByRole('dialog', { name: 'slopify' })
    const detailShell = screen.getByTestId('project-panel-shell')
    fireEvent.click(within(detailPanel).getByRole('button', { name: 'Close project details' }))
    expect(detailShell.getAttribute('data-open')).toBe('false')
    expect(screen.getByRole('dialog', { name: 'slopify', hidden: true })).toBeTruthy()
    fireEvent.transitionEnd(detailShell, { propertyName: 'translate' })
    expect(screen.queryByRole('dialog', { name: 'slopify', hidden: true })).toBeNull()
  })

  it('requires the exact repository path before deleting a project and offers undo', async () => {
    const client = createClient()
    const addToast = vi.spyOn(toast, 'add')
    const closeToast = vi.spyOn(toast, 'close')
    render(<ProjectSettings client={client} />)

    fireEvent.click(await screen.findByRole('button', { name: /slopify, Available/ }))
    const panel = await screen.findByRole('dialog', { name: 'slopify' })
    expect(within(panel).queryByRole('heading', { name: 'Availability' })).toBeNull()
    expect(within(panel).getByText('Available')).toBeTruthy()
    expect(within(panel).queryByRole('separator')).toBeNull()

    const deleteButton = within(panel).getByRole('button', { name: 'Delete project' })
    expect(deleteButton.className).toContain('ml-auto')

    fireEvent.click(deleteButton)
    expect(client.deleteProject).not.toHaveBeenCalled()
    const confirmationPath = within(panel).getByPlaceholderText('Enter the repository path')
    const confirmation = within(panel).getByRole('button', { name: 'Confirm' })

    expect((confirmation as HTMLButtonElement).disabled).toBe(true)
    expect(document.activeElement).toBe(confirmationPath)
    fireEvent.change(confirmationPath, { target: { value: '/workspace/other-project' } })
    fireEvent.click(confirmation)
    expect(client.deleteProject).not.toHaveBeenCalled()

    fireEvent.change(confirmationPath, { target: { value: '/workspace/slopify' } })
    expect((confirmation as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(confirmation)

    await waitFor(() => expect(client.deleteProject).toHaveBeenCalledWith('project-01'))
    const shell = screen.getByTestId('project-panel-shell')
    expect(shell.getAttribute('data-open')).toBe('false')
    expect(shell.style.getPropertyValue('--panel-open-dur')).toBe('350ms')
    expect(shell.style.getPropertyValue('--panel-close-dur')).toBe('350ms')
    expect(screen.getByRole('dialog', { name: 'slopify', hidden: true })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /slopify, Available/ })).toBeNull()
    const deletionToast = addToast.mock.calls.find(
      ([options]) => options.title === 'Project deleted',
    )?.[0]
    expect(deletionToast).toMatchObject({
      title: 'Project deleted',
      description: 'slopify was removed from Slopify.',
      type: 'info',
      actionProps: { children: 'Undo' },
    })
    expect(deletionToast?.timeout).toBeGreaterThan(0)

    await act(async () => {
      await deletionToast?.actionProps?.onClick?.({ preventDefault: vi.fn() } as never)
    })

    await waitFor(() => expect(client.undoDeletion).toHaveBeenCalledWith('deletion-project-01'))
    expect(closeToast).toHaveBeenCalledWith(expect.any(String))
    expect(addToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Project restored' }),
    )
    deletionToast?.onRemove?.()

    expect(client.listProjects).toHaveBeenCalledTimes(2)
    expect(await screen.findByRole('button', { name: /slopify, Available/ })).toBeTruthy()
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Project restored', type: 'success' }),
    )
    fireEvent.transitionEnd(shell, { propertyName: 'translate' })
    expect(screen.queryByRole('dialog', { name: 'slopify', hidden: true })).toBeNull()
  })

  it('resets delete confirmation when the project panel closes', async () => {
    render(<ProjectSettings client={createClient()} />)

    fireEvent.click(await screen.findByRole('button', { name: /slopify, Available/ }))
    const panel = await screen.findByRole('dialog', { name: 'slopify' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Delete project' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Close project details' }))
    const shell = screen.getByTestId('project-panel-shell')
    fireEvent.transitionEnd(shell, { propertyName: 'translate' })

    fireEvent.click(screen.getByRole('button', { name: /slopify, Available/ }))
    const reopenedPanel = within(await screen.findByRole('dialog', { name: 'slopify' }))
    expect(reopenedPanel.getByRole('button', { name: 'Delete project' })).toBeTruthy()
    expect(
      (reopenedPanel.getByPlaceholderText('Enter the repository path') as HTMLInputElement)
        .disabled,
    ).toBe(true)
  })
})
