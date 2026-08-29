// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnchorHTMLAttributes } from 'react'

import { WorkflowRunOutcomeCatalogResponseSchema } from '@slopify/shared'
import { createWorkflowDraft } from '@slopify/shared'

import { AppShell } from '../components/app-shell'
import type { SettingsSnapshot } from '../lib/api-client'
import { announceWorkflowCatalogChanged } from '../lib/workflow-catalog-events'
import { announceWorkflowRunOutcomesChanged } from '../lib/workflow-run-outcome-events'

const navigation = vi.hoisted(() => ({ pathname: '/', search: '', push: vi.fn() }))
const storedPreferences = new Map<string, string>()

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

vi.mock('next/link', () => ({
  default: ({
    prefetch,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => (
    <a data-prefetch={String(prefetch)} {...props} />
  ),
}))

const workflows = [
  createWorkflowDraft({
    workflowId: 'test-workflow',
    description: 'Default workflow description.',
    configuration: { repositoryIds: [], primaryRepositoryId: null, variables: [] },
    createdAt: '2026-08-25T00:00:00.000Z',
  }),
  createWorkflowDraft({
    workflowId: 'release-workflow',
    description: 'Release workflow description.',
    configuration: { repositoryIds: [], primaryRepositoryId: null, variables: [] },
    createdAt: '2026-08-25T00:00:00.000Z',
  }),
]
const testWorkflow = workflows[0]
if (testWorkflow === undefined) throw new Error('Expected a workflow fixture')
const runOutcomes = (outcomes: readonly unknown[]) =>
  WorkflowRunOutcomeCatalogResponseSchema.parse({ outcomes }).outcomes
const noRunWorkflow = createWorkflowDraft({
  workflowId: 'draft-workflow',
  description: 'Draft workflow description.',
  configuration: { repositoryIds: [], primaryRepositoryId: null, variables: [] },
  createdAt: '2026-08-25T00:00:00.000Z',
})

const workflowClient = {
  createWorkflow: vi.fn(async () => testWorkflow),
  listWorkflowRunOutcomes: vi.fn(async () => runOutcomes([])),
  listWorkflows: vi.fn(async () => workflows),
}
const initialSystemSettings: SettingsSnapshot = {
  value: {
    schemaVersion: 1 as const,
    appearance: { theme: 'system' as const },
    git: { connections: [] },
  },
  etag: '"missing"',
}
const initialDarkSettings: SettingsSnapshot = {
  value: {
    ...initialSystemSettings.value,
    appearance: { theme: 'dark' as const },
  },
  etag: `"${'b'.repeat(64)}"`,
}
const themeClient = {
  getSettings: vi.fn(async () => initialSystemSettings),
  updateSettings: vi.fn(async (input: { appearance: { theme: 'light' | 'dark' | 'system' } }) => ({
    value: { ...initialSystemSettings.value, appearance: input.appearance },
    etag: `"${'c'.repeat(64)}"`,
  })),
}

beforeEach(() => {
  navigation.pathname = '/'
  navigation.search = ''
  navigation.push.mockReset()
  workflowClient.createWorkflow.mockReset().mockResolvedValue(testWorkflow)
  workflowClient.listWorkflowRunOutcomes.mockReset().mockResolvedValue(runOutcomes([]))
  workflowClient.listWorkflows.mockReset().mockResolvedValue(workflows)
  themeClient.getSettings.mockReset().mockResolvedValue(initialSystemSettings)
  themeClient.updateSettings.mockClear()
  storedPreferences.clear()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      clear: () => storedPreferences.clear(),
      getItem: (key: string) => storedPreferences.get(key) ?? null,
      removeItem: (key: string) => storedPreferences.delete(key),
      setItem: (key: string, value: string) => storedPreferences.set(key, value),
    },
  })
  document.documentElement.classList.remove('dark')
  document.documentElement.style.colorScheme = ''
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
    })),
  })
})

afterEach(cleanup)

describe('AppShell', () => {
  it('uses one base surface across navigation and the workspace', () => {
    const { container } = render(
      <AppShell>
        <p>Workflow graph</p>
      </AppShell>,
    )

    const navigation = container.querySelector('aside')
    expect(navigation?.getAttribute('data-surface')).toBe('base')
    expect(navigation?.className).toContain('bg-background')
    expect(navigation?.className).not.toContain('bg-sidebar')
    expect(container.querySelector('header')?.getAttribute('data-surface')).toBe('base')
    expect(screen.getByRole('main').getAttribute('data-surface')).toBe('base')
  })

  it('renders workflows as an expanded menu with one entry per workflow', async () => {
    navigation.search = 'workflowId=release-workflow'

    render(
      <AppShell client={workflowClient}>
        <p>Workflow graph</p>
      </AppShell>,
    )

    const primaryNavigation = screen.getByRole('navigation', { name: 'Primary navigation' })
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' })

    expect(primaryNavigation.getAttribute('data-state')).toBe('expanded')
    const workflowsButton = within(primaryNavigation).getByRole('button', { name: 'Workflows' })
    expect(workflowsButton.getAttribute('aria-expanded')).toBe('true')
    await waitFor(() => expect(workflowClient.listWorkflows).toHaveBeenCalledOnce())
    await within(primaryNavigation).findByRole('link', { name: 'release-workflow' })
    expect(
      within(primaryNavigation)
        .getAllByRole('link')
        .map((link) => link.getAttribute('aria-label')),
    ).toEqual(['test-workflow', 'release-workflow', 'Runs', 'Harnesses', 'Repositories'])
    expect(
      within(primaryNavigation)
        .getAllByRole('link')
        .map((link) => link.getAttribute('data-prefetch')),
    ).toEqual(['false', 'false', 'false', 'false', 'false'])
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('data-prefetch')).toBe(
      'false',
    )
    expect(
      within(primaryNavigation).getByRole('link', { name: 'test-workflow' }).getAttribute('href'),
    ).toBe('/?workflowId=test-workflow')
    expect(
      within(primaryNavigation)
        .getByRole('link', { name: 'release-workflow' })
        .getAttribute('aria-current'),
    ).toBe('page')

    fireEvent.click(workflowsButton)

    expect(workflowsButton.getAttribute('aria-expanded')).toBe('false')
    expect(primaryNavigation.querySelector('[data-slot="collapsible-content"]')).not.toBeNull()
    expect(within(primaryNavigation).queryByRole('link', { name: 'test-workflow' })).toBeNull()
    expect(within(primaryNavigation).queryByText('Workflow')).toBeNull()
    expect(within(primaryNavigation).queryByText('Configuration')).toBeNull()
    expect(
      within(primaryNavigation).getByRole('link', { name: 'Harnesses' }).getAttribute('href'),
    ).toBe('/harnesses')
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings')
    expect(within(breadcrumb).getByRole('link', { name: 'Workflows' }).getAttribute('href')).toBe(
      '/',
    )
    expect(
      within(breadcrumb).getByRole('link', { name: 'release-workflow' }).getAttribute('href'),
    ).toBe('/?workflowId=release-workflow')
    expect(screen.getByRole('main').className).not.toContain('p-6')
    expect(screen.getByText('Workflow graph')).toBeTruthy()
  })

  it('centers the workflows disclosure chevron within its icon slot', () => {
    render(
      <AppShell client={workflowClient}>
        <p>Workflow graph</p>
      </AppShell>,
    )

    const workflowsButton = screen.getByRole('button', { name: 'Workflows' })
    fireEvent.mouseEnter(workflowsButton)
    const disclosureIconSlot = workflowsButton.querySelector('[data-icon="b"]')

    expect(disclosureIconSlot?.className).toContain('grid')
    expect(disclosureIconSlot?.className).toContain('place-items-center')
  })

  it('uses weather icons for each workflow run outcome', async () => {
    workflowClient.listWorkflows.mockResolvedValue([...workflows, noRunWorkflow])
    workflowClient.listWorkflowRunOutcomes.mockResolvedValue(
      runOutcomes([
        {
          workflowId: 'test-workflow',
          runId: 'run-success',
          status: 'SUCCEEDED',
          completedAt: '2026-08-25T12:00:00.000Z',
        },
        {
          workflowId: 'release-workflow',
          runId: 'run-failure',
          status: 'FAILED',
          completedAt: '2026-08-25T11:00:00.000Z',
        },
      ]),
    )

    render(
      <AppShell client={workflowClient}>
        <p>Workflow graph</p>
      </AppShell>,
    )

    const success = await screen.findByRole('link', {
      name: 'Latest successful run',
    })
    const failure = screen.getByRole('link', {
      name: 'Latest failed run',
    })
    const noRun = screen.getByRole('button', { name: 'No finished run' })

    expect(success.getAttribute('href')).toBe('/runs/run-success')
    expect(success.getAttribute('data-status')).toBe('SUCCEEDED')
    expect(success.className).toContain('text-status-warning')
    expect(success.className.split(/\s+/)).not.toContain('bg-status-warning/10')
    expect(success.className.split(/\s+/)).toContain('hover:bg-status-warning/20')
    expect(success.className.split(/\s+/)).toContain('dark:hover:bg-status-warning/20')
    expect(success.querySelector('svg.lucide-sun')).not.toBeNull()
    expect(failure.getAttribute('href')).toBe('/runs/run-failure')
    expect(failure.getAttribute('data-status')).toBe('FAILED')
    expect(failure.className).toContain('text-destructive')
    expect(failure.className.split(/\s+/)).not.toContain('bg-destructive/10')
    expect(failure.className.split(/\s+/)).toContain('hover:bg-destructive/20')
    expect(failure.className.split(/\s+/)).toContain('dark:hover:bg-destructive/20')
    expect(failure.querySelector('svg.lucide-cloud-lightning')).not.toBeNull()
    expect(noRun.getAttribute('aria-disabled')).toBe('true')
    expect(noRun.getAttribute('data-status')).toBe('NONE')
    expect(noRun.querySelector('svg.lucide-cloud')).not.toBeNull()
  })

  it('creates a workflow from a unique canonical name with keyboard controls', async () => {
    const created = createWorkflowDraft({
      workflowId: 'review-workflow',
      description: 'review-workflow workflow.',
      configuration: { repositoryIds: [], primaryRepositoryId: null, variables: [] },
      createdAt: '2026-08-25T00:00:00.000Z',
    })
    workflowClient.createWorkflow.mockResolvedValue(created)

    render(
      <AppShell client={workflowClient}>
        <p>Workflow graph</p>
      </AppShell>,
    )

    const primaryNavigation = screen.getByRole('navigation', { name: 'Primary navigation' })
    await within(primaryNavigation).findByRole('link', { name: 'test-workflow' })
    const addWorkflow = screen.getByRole('button', { name: 'Add workflow' })
    fireEvent.click(addWorkflow)

    const input = screen.getByRole('textbox', { name: 'New workflow ID' })
    await waitFor(() => expect(document.activeElement).toBe(input))
    expect(input.closest('[data-slot="popover-content"]')).not.toBeNull()
    expect(within(primaryNavigation).queryByRole('textbox', { name: 'New workflow ID' })).toBeNull()

    fireEvent.change(input, { target: { value: 'Review Workflow' } })
    expect(screen.getByRole('alert').textContent).toContain(
      'Use 1–64 lowercase letters, numbers, and single hyphens',
    )
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(workflowClient.createWorkflow).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'test-workflow' } })
    expect(screen.getByRole('alert').textContent).toBe('A workflow with this ID already exists.')

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'New workflow ID' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Add workflow' }))
    const retryInput = screen.getByRole('textbox', { name: 'New workflow ID' })
    fireEvent.change(retryInput, { target: { value: 'review-workflow' } })
    fireEvent.keyDown(retryInput, { key: 'Enter' })

    await waitFor(() =>
      expect(workflowClient.createWorkflow).toHaveBeenCalledWith({
        workflowId: 'review-workflow',
        description: 'review-workflow workflow.',
      }),
    )
    expect(
      await within(primaryNavigation).findByRole('link', { name: 'review-workflow' }),
    ).toBeTruthy()
    expect(navigation.push).toHaveBeenCalledWith('/?workflowId=review-workflow')
  })

  it('places the collapse control in the title row and toggles with B outside inputs', () => {
    render(
      <AppShell>
        <input aria-label="Workflow ID" />
      </AppShell>,
    )

    const navigation = screen.getByRole('navigation', { name: 'Primary navigation' })
    const collapseButton = screen.getByRole('button', { name: 'Collapse navigation' })

    expect(collapseButton.closest('aside')).not.toBeNull()
    expect(collapseButton.getAttribute('aria-keyshortcuts')).toBe('B')

    fireEvent.keyDown(window, { key: 'b' })
    expect(navigation.getAttribute('data-state')).toBe('collapsed')

    const expandButton = screen.getByRole('button', { name: 'Expand navigation' })
    expect(expandButton.closest('aside')).toBeNull()
    expect(expandButton.getAttribute('aria-keyshortcuts')).toBe('B')

    const input = screen.getByRole('textbox', { name: 'Workflow ID' })
    input.focus()
    fireEvent.keyDown(input, { key: 'b' })
    expect(navigation.getAttribute('data-state')).toBe('collapsed')
  })

  it('refreshes workflow entries when the catalog changes', async () => {
    workflowClient.listWorkflows
      .mockResolvedValueOnce(workflows.slice(0, 1))
      .mockResolvedValueOnce(workflows)

    render(
      <AppShell client={workflowClient}>
        <p>Workflow graph</p>
      </AppShell>,
    )

    const primaryNavigation = screen.getByRole('navigation', { name: 'Primary navigation' })
    expect(
      await within(primaryNavigation).findByRole('link', { name: 'test-workflow' }),
    ).toBeTruthy()
    expect(within(primaryNavigation).queryByRole('link', { name: 'release-workflow' })).toBeNull()

    announceWorkflowCatalogChanged()

    expect(
      await within(primaryNavigation).findByRole('link', { name: 'release-workflow' }),
    ).toBeTruthy()
    expect(workflowClient.listWorkflows).toHaveBeenCalledTimes(2)
  })

  it('refreshes workflow status controls when a run finishes', async () => {
    workflowClient.listWorkflowRunOutcomes
      .mockResolvedValueOnce(runOutcomes([]))
      .mockResolvedValueOnce(
        runOutcomes([
          {
            workflowId: 'test-workflow',
            runId: 'run-success',
            status: 'SUCCEEDED',
            completedAt: '2026-08-25T12:00:00.000Z',
          },
        ]),
      )

    render(
      <AppShell client={workflowClient}>
        <p>Workflow graph</p>
      </AppShell>,
    )

    expect(await screen.findAllByRole('button', { name: 'No finished run' })).toHaveLength(2)
    announceWorkflowRunOutcomesChanged()

    expect(
      await screen.findByRole('link', {
        name: 'Latest successful run',
      }),
    ).toBeTruthy()
    expect(workflowClient.listWorkflowRunOutcomes).toHaveBeenCalledTimes(2)
  })

  it('uses D for a persisted direct light and dark toggle', async () => {
    render(
      <AppShell initialSettings={initialDarkSettings} themeClient={themeClient}>
        <p>Workbench</p>
      </AppShell>,
    )

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')

    fireEvent.keyDown(window, { key: 'd' })

    await waitFor(() =>
      expect(themeClient.updateSettings).toHaveBeenCalledWith(
        { appearance: { theme: 'light' } },
        initialDarkSettings.etag,
      ),
    )
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('follows system appearance changes while the file preference is system', () => {
    let colorSchemeListener: (() => void) | undefined
    const colorScheme = {
      addEventListener: vi.fn((_event: string, listener: () => void) => {
        colorSchemeListener = listener
      }),
      matches: false,
      removeEventListener: vi.fn(),
    }
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => colorScheme),
    })

    render(
      <AppShell initialSettings={initialSystemSettings} themeClient={themeClient}>
        <p>Workbench</p>
      </AppShell>,
    )

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    colorScheme.matches = true
    colorSchemeListener?.()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('reloads file-backed settings when the window regains focus', async () => {
    themeClient.getSettings.mockResolvedValue(initialDarkSettings)
    render(
      <AppShell initialSettings={initialSystemSettings} themeClient={themeClient}>
        <p>Workbench</p>
      </AppShell>,
    )

    fireEvent.focus(window)

    await waitFor(() => expect(themeClient.getSettings).toHaveBeenCalledTimes(1))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it.each([
    ['/runs', 'Runs', ['Runs']],
    ['/runs/run-123', 'Runs', ['Runs', '123']],
    ['/harnesses', 'Harnesses', ['Harnesses']],
    ['/repositories', 'Repositories', ['Repositories']],
    ['/settings', 'Settings', ['Settings']],
  ])('maps %s to the %s destination and breadcrumb', (pathname, linkName, crumbs) => {
    navigation.pathname = pathname

    render(
      <AppShell>
        <p>Workbench</p>
      </AppShell>,
    )

    const primaryNavigation = screen.getByRole('navigation', { name: 'Primary navigation' })
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    const currentNavigationLinks = within(primaryNavigation)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')

    expect(currentNavigationLinks).toHaveLength(linkName === 'Settings' ? 0 : 1)
    if (linkName !== 'Settings') {
      expect(currentNavigationLinks[0]?.textContent).toContain(linkName)
    } else {
      const settingsLinks = screen.getAllByRole('link', { name: 'Settings' })
      expect(settingsLinks.some((link) => link.getAttribute('aria-current') === 'page')).toBe(true)
    }
    expect(
      within(breadcrumb)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(crumbs)
  })

  it.each(['/harnesses', '/repositories', '/runs', '/runs/run-123'])(
    'does not add shell padding around the full-width route %s',
    (pathname) => {
      navigation.pathname = pathname

      render(
        <AppShell>
          <section className="w-full px-6 pt-6">Catalog</section>
        </AppShell>,
      )

      const main = screen.getByRole('main')
      expect(main.className).not.toContain('p-6')
      expect(main.className).not.toContain('sm:p-8')
      if (pathname.startsWith('/runs/')) expect(main.className).toContain('overflow-hidden')
    },
  )
})
