// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProjectSchema } from '@slopify/contracts'

import { WorkflowConfigDrawer } from '../components/workflow/workflow-config-drawer'

const projects = ProjectSchema.array().parse([
  {
    projectId: 'project-api',
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
    projectId: 'project-web',
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
const apiProject = projects[0]
const webProject = projects[1]
if (apiProject === undefined || webProject === undefined) {
  throw new Error('Expected two project fixtures')
}

afterEach(cleanup)

describe('WorkflowConfigDrawer', () => {
  it('saves the workflow projects and declared variable names', async () => {
    const onSubmit = vi.fn(async () => true)

    render(
      <WorkflowConfigDrawer
        mode="edit"
        value={{
          name: 'Delivery workflow',
          description: 'Coordinate delivery.',
          configuration: {
            projectIds: projects.slice(0, 1).map(({ projectId }) => projectId),
            primaryProjectId: apiProject.projectId,
            variables: ['topic'],
          },
        }}
        projects={projects}
        onClose={vi.fn()}
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
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Delivery workflow',
        description: 'Coordinate delivery.',
        configuration: {
          projectIds: ['project-api', 'project-web'],
          primaryProjectId: 'project-web',
          variables: ['topic', 'release context'],
        },
      }),
    )
  })

  it('does not allow duplicate or blank variable names to be saved', async () => {
    render(
      <WorkflowConfigDrawer
        mode="edit"
        value={{
          name: 'Delivery workflow',
          description: 'Coordinate delivery.',
          configuration: { projectIds: [], primaryProjectId: null, variables: ['topic'] },
        }}
        projects={projects}
        onClose={vi.fn()}
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

  it('does not treat project catalog order as a configuration change', async () => {
    render(
      <WorkflowConfigDrawer
        mode="edit"
        value={{
          name: 'Delivery workflow',
          description: 'Coordinate delivery.',
          configuration: {
            projectIds: [webProject.projectId, apiProject.projectId],
            primaryProjectId: webProject.projectId,
            variables: [],
          },
        }}
        projects={projects}
        onClose={vi.fn()}
        onSubmit={vi.fn(async () => true)}
      />,
    )

    expect(
      (await screen.findByRole('button', { name: 'Save changes' })) as HTMLButtonElement,
    ).toHaveProperty('disabled', true)
  })

  it('defaults the first selected project as primary and keeps the primary selection valid', async () => {
    const onSubmit = vi.fn(async () => true)
    render(
      <WorkflowConfigDrawer
        mode="edit"
        value={{
          name: 'Delivery workflow',
          description: 'Coordinate delivery.',
          configuration: { projectIds: [], primaryProjectId: null, variables: [] },
        }}
        projects={projects}
        onClose={vi.fn()}
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
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Delivery workflow',
        description: 'Coordinate delivery.',
        configuration: {
          projectIds: ['project-web'],
          primaryProjectId: 'project-web',
          variables: [],
        },
      }),
    )
  })

  it('uses the same details and configuration fields when creating a workflow', async () => {
    const onSubmit = vi.fn(async () => false)
    render(
      <WorkflowConfigDrawer
        error="Workflow could not be created"
        mode="create"
        value={{
          name: '',
          description: '',
          configuration: { projectIds: [], primaryProjectId: null, variables: [] },
        }}
        projects={projects}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    )

    const create = await screen.findByRole('button', { name: 'Create workflow' })
    expect((create as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Release workflow' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), {
      target: { value: 'Prepare and review a release.' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /API/ }))
    fireEvent.click(create)

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Release workflow',
        description: 'Prepare and review a release.',
        configuration: {
          projectIds: ['project-api'],
          primaryProjectId: 'project-api',
          variables: [],
        },
      }),
    )
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe(
      'Release workflow',
    )
    expect(screen.getByRole('alert').textContent).toContain('Workflow could not be created')
  })
})
