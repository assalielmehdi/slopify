// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectSchema } from '@loop/contracts'

import { ProjectSettings } from '../components/settings/project-settings'

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
  deleteProject: vi.fn(async () => undefined),
  ...overrides,
})

afterEach(cleanup)

describe('ProjectSettings', () => {
  it('shows an explicit empty state before the first repository is added', async () => {
    render(<ProjectSettings client={createClient({ listProjects: vi.fn(async () => []) })} />)

    expect(await screen.findByText('No projects yet')).toBeTruthy()
    expect(
      screen.getByText('Add a local Git repository to make it available to workflows.'),
    ).toBeTruthy()
  })

  it('uses the provider and connector catalog layout in grid and list views', async () => {
    render(<ProjectSettings client={createClient()} />)

    const catalog = screen.getByRole('region', { name: 'Projects' })
    const projectGrid = await within(catalog).findByTestId('project-grid')
    const viewOptions = within(catalog).getByRole('radiogroup', { name: 'View options' })
    const gridView = within(viewOptions).getByRole('radio', { name: 'Grid view' })
    const listView = within(viewOptions).getByRole('radio', { name: 'List view' })

    expect(catalog.className).toContain('px-6')
    expect(catalog.className).toContain('pt-6')
    expect(projectGrid.className).toContain('auto-fill')
    expect(projectGrid.getAttribute('data-layout')).toBe('grid')
    expect(gridView.getAttribute('aria-checked')).toBe('true')

    fireEvent.click(listView)
    expect(projectGrid.getAttribute('data-layout')).toBe('list')
    expect(listView.getAttribute('aria-checked')).toBe('true')
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
    expect(addShell.className).toContain('provider-floating-panel-shell')
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

  it('removes availability details and requires two deliberate clicks to delete a project', async () => {
    const client = createClient()
    render(<ProjectSettings client={client} />)

    fireEvent.click(await screen.findByRole('button', { name: /slopify, Available/ }))
    const panel = await screen.findByRole('dialog', { name: 'slopify' })
    expect(within(panel).queryByRole('heading', { name: 'Availability' })).toBeNull()
    expect(within(panel).getByText('Available')).toBeTruthy()

    fireEvent.click(within(panel).getByRole('button', { name: 'Delete project' }))
    expect(client.deleteProject).not.toHaveBeenCalled()
    const confirmation = within(panel).getByRole('button', { name: 'Confirm delete' })
    fireEvent.click(confirmation)

    await waitFor(() => expect(client.deleteProject).toHaveBeenCalledWith('project-01'))
    expect(screen.queryByRole('button', { name: /slopify, Available/ })).toBeNull()
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
    expect(
      within(await screen.findByRole('dialog', { name: 'slopify' })).getByRole('button', {
        name: 'Delete project',
      }),
    ).toBeTruthy()
  })
})
