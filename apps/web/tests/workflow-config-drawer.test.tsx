// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RepositorySchema } from '@slopify/contracts'
import { createWorkflowDraft, type Workflow } from '@slopify/workflow-model'

import { WorkflowConfigDrawer } from '../components/workflow/workflow-config-drawer'

const repositories = RepositorySchema.array().parse([
  {
    repositoryId: 'repository-api',
    name: 'API',
    provider: 'GITHUB',
    remoteId: '101',
    fullName: 'operator/api',
    cloneUrl: 'https://github.com/operator/api.git',
    webUrl: 'https://github.com/operator/api',
    defaultBranch: 'main',
    availability: 'AVAILABLE',
    createdAt: '2026-08-23T10:00:00Z',
    updatedAt: '2026-08-23T10:00:00Z',
  },
  {
    repositoryId: 'repository-web',
    name: 'Web',
    provider: 'GITLAB',
    remoteId: '202',
    fullName: 'operator/web',
    cloneUrl: 'https://gitlab.com/operator/web.git',
    webUrl: 'https://gitlab.com/operator/web',
    defaultBranch: 'trunk',
    availability: 'AVAILABLE',
    createdAt: '2026-08-23T10:00:00Z',
    updatedAt: '2026-08-23T10:00:00Z',
  },
])
const apiRepository = repositories[0]
const webRepository = repositories[1]
if (apiRepository === undefined || webRepository === undefined) {
  throw new Error('Expected two repository fixtures')
}

const drawerWorkflow = (overrides: Partial<Workflow> = {}): Workflow => ({
  ...createWorkflowDraft({
    workflowId: 'delivery-workflow',
    name: 'Delivery workflow',
    description: 'Coordinate delivery.',
    configuration: { repositoryIds: [], primaryRepositoryId: null, variables: [] },
    createdAt: '2026-08-25T10:00:00.000Z',
  }),
  ...overrides,
})

afterEach(cleanup)

describe('WorkflowConfigDrawer', () => {
  it('reveals and focuses the repository-style workflow deletion confirmation', async () => {
    const onDelete = vi.fn(async () => true)
    render(
      <WorkflowConfigDrawer
        value={drawerWorkflow({ name: 'delivery-workflow' })}
        repositories={repositories}
        onClose={vi.fn()}
        onDelete={onDelete}
        onSubmit={vi.fn(async () => true)}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Delete workflow' }))

    const confirmation = screen.getByLabelText('Workflow name confirmation')
    const confirm = screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement
    expect(document.activeElement).toBe(confirmation)
    expect(confirmation.parentElement?.className).toContain('w-full')
    expect(confirm.disabled).toBe(true)
    fireEvent.change(confirmation, { target: { value: 'wrong-workflow' } })
    expect(confirmation.getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(confirmation, { target: { value: 'delivery-workflow' } })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)

    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1))
  })

  it('saves the workflow repositories and declared variable names', async () => {
    const onSubmit = vi.fn(async () => true)

    render(
      <WorkflowConfigDrawer
        value={drawerWorkflow({
          configuration: {
            repositoryIds: repositories.slice(0, 1).map(({ repositoryId }) => repositoryId),
            primaryRepositoryId: apiRepository.repositoryId,
            variables: ['topic'],
          },
        })}
        repositories={repositories}
        onClose={vi.fn()}
        onDelete={vi.fn(async () => true)}
        onSubmit={onSubmit}
      />,
    )

    expect(
      await screen.findByRole('complementary', { name: 'Workflow configuration' }),
    ).toBeTruthy()
    expect((screen.getByRole('checkbox', { name: /API/ }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('radio', { name: /API/ }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /Web/ }))
    fireEvent.click(screen.getByRole('radio', { name: /Web/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add variable' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Variable name 2' }), {
      target: { value: 'release context' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          configuration: {
            repositoryIds: ['repository-api', 'repository-web'],
            primaryRepositoryId: 'repository-web',
            variables: ['topic', 'release context'],
          },
        }),
      ),
    )
  })

  it('does not allow duplicate or blank variable names to be saved', async () => {
    render(
      <WorkflowConfigDrawer
        value={drawerWorkflow({
          configuration: { repositoryIds: [], primaryRepositoryId: null, variables: ['topic'] },
        })}
        repositories={repositories}
        onClose={vi.fn()}
        onDelete={vi.fn(async () => true)}
        onSubmit={vi.fn(async () => true)}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Add variable' }))
    const save = screen.getByRole('button', { name: 'Save changes' })
    expect((save as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: 'Variable name 2' }), {
      target: { value: 'topic' },
    })
    expect((save as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not treat repository catalog order as a configuration change', async () => {
    render(
      <WorkflowConfigDrawer
        value={drawerWorkflow({
          configuration: {
            repositoryIds: [webRepository.repositoryId, apiRepository.repositoryId],
            primaryRepositoryId: webRepository.repositoryId,
            variables: [],
          },
        })}
        repositories={repositories}
        onClose={vi.fn()}
        onDelete={vi.fn(async () => true)}
        onSubmit={vi.fn(async () => true)}
      />,
    )

    expect(
      (await screen.findByRole('button', { name: 'Save changes' })) as HTMLButtonElement,
    ).toHaveProperty('disabled', true)
  })

  it('defaults the first selected repository as primary and keeps the primary selection valid', async () => {
    const onSubmit = vi.fn(async () => true)
    render(
      <WorkflowConfigDrawer
        value={drawerWorkflow()}
        repositories={repositories}
        onClose={vi.fn()}
        onDelete={vi.fn(async () => true)}
        onSubmit={onSubmit}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: /Web/ }))
    expect((screen.getByRole('radio', { name: /Web/ }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /API/ }))
    fireEvent.click(screen.getByRole('radio', { name: /API/ }))
    expect((screen.getByRole('radio', { name: /API/ }) as HTMLInputElement).checked).toBe(true)

    fireEvent.click(screen.getByRole('checkbox', { name: /API/ }))
    expect(screen.queryByRole('radio', { name: /API/ })).toBeNull()
    expect((screen.getByRole('radio', { name: /Web/ }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          configuration: {
            repositoryIds: ['repository-web'],
            primaryRepositoryId: 'repository-web',
            variables: [],
          },
        }),
      ),
    )
  })

  it('blocks invalid graph JSON and saves a valid edited graph', async () => {
    const onSubmit = vi.fn(async () => true)
    render(
      <WorkflowConfigDrawer
        value={drawerWorkflow()}
        repositories={repositories}
        onClose={vi.fn()}
        onDelete={vi.fn(async () => true)}
        onSubmit={onSubmit}
      />,
    )

    const editor = await screen.findByRole('textbox', { name: 'Workflow graph JSON' })
    const save = screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement
    fireEvent.change(editor, { target: { value: '{' } })
    expect(screen.getByRole('alert').textContent).toContain('Graph definition is not valid JSON')
    expect(save.disabled).toBe(true)

    fireEvent.change(editor, {
      target: {
        value: JSON.stringify({
          startNodeId: null,
          nodes: 'invalid',
          edges: [],
          maxTransitions: 42,
        }),
      },
    })
    expect(save.disabled).toBe(true)

    const graph = {
      startNodeId: null,
      nodes: [],
      edges: [],
      maxTransitions: 42,
    }
    fireEvent.change(editor, { target: { value: JSON.stringify(graph) } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining(graph)))
  })

  it('preserves dirty graph source and blocks saving after an external conflict', async () => {
    const onDirtyChange = vi.fn()
    const { rerender } = render(
      <WorkflowConfigDrawer
        value={drawerWorkflow()}
        repositories={repositories}
        onClose={vi.fn()}
        onDelete={vi.fn(async () => true)}
        onDirtyChange={onDirtyChange}
        onSubmit={vi.fn(async () => true)}
      />,
    )
    const editor = await screen.findByRole('textbox', { name: 'Workflow graph JSON' })
    fireEvent.change(editor, { target: { value: '{' } })
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true))

    rerender(
      <WorkflowConfigDrawer
        conflict="This workflow changed outside Slopify. Close and reopen to load the latest file."
        value={drawerWorkflow({ name: 'Externally changed workflow' })}
        repositories={repositories}
        onClose={vi.fn()}
        onDelete={vi.fn(async () => true)}
        onDirtyChange={onDirtyChange}
        onSubmit={vi.fn(async () => true)}
      />,
    )

    expect((editor as HTMLTextAreaElement).value).toBe('{')
    expect(screen.getByText(/changed outside Slopify/i)).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
