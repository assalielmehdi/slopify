// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProjectSchema } from '@slopify/contracts'

import { WorkflowConfigDrawer } from '../components/workflow/workflow-config-drawer'

const projects = ProjectSchema.array().parse([
  {
    projectId: 'project-api',
    name: 'API',
    repositoryPath: '/Users/developer/workspace/api',
    availability: 'AVAILABLE',
    createdAt: '2026-08-23T10:00:00Z',
    updatedAt: '2026-08-23T10:00:00Z',
  },
  {
    projectId: 'project-web',
    name: 'Web',
    repositoryPath: '/Users/developer/workspace/web',
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
        configuration={{
          projectIds: projects.slice(0, 1).map(({ projectId }) => projectId),
          primaryProjectId: apiProject.projectId,
          variables: ['topic'],
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
        projectIds: ['project-api', 'project-web'],
        primaryProjectId: 'project-web',
        variables: ['topic', 'release context'],
      }),
    )
  })

  it('does not allow duplicate or blank variable names to be saved', async () => {
    render(
      <WorkflowConfigDrawer
        configuration={{ projectIds: [], primaryProjectId: null, variables: ['topic'] }}
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
        configuration={{
          projectIds: [webProject.projectId, apiProject.projectId],
          primaryProjectId: webProject.projectId,
          variables: [],
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
        configuration={{ projectIds: [], primaryProjectId: null, variables: [] }}
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
        projectIds: ['project-web'],
        primaryProjectId: 'project-web',
        variables: [],
      }),
    )
  })
})
