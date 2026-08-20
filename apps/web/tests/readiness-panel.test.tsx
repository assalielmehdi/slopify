// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ProjectProfileReadinessSchema } from '@loop/contracts'

import { ReadinessPanel } from '../components/settings/readiness-panel'

afterEach(cleanup)

describe('ReadinessPanel', () => {
  it('shows connection booleans and distinct findings per repository without secret values', () => {
    const readiness = ProjectProfileReadinessSchema.parse({
      profileId: 'local-profile',
      ready: false,
      repositories: [
        {
          repositoryId: 'api',
          ready: false,
          findings: [
            { category: 'filesystem', code: 'PATH_MISSING', message: 'Path is unavailable' },
            { category: 'git', code: 'REMOTE_MISMATCH', message: 'Remote does not match' },
            { category: 'tool', code: 'TOOL_MISSING', message: 'Required check failed' },
          ],
        },
        {
          repositoryId: 'web',
          ready: false,
          findings: [
            { category: 'clickup', code: 'CLICKUP_UNAVAILABLE', message: 'ClickUp unavailable' },
            { category: 'gitlab', code: 'GITLAB_UNAVAILABLE', message: 'GitLab unavailable' },
            {
              category: 'model-provider',
              code: 'MODEL_UNAVAILABLE',
              message: 'Model provider unavailable',
            },
          ],
        },
      ],
    })

    const { container } = render(
      <ReadinessPanel
        connectors={{ clickup: false, gitlab: true, modelProvider: false }}
        readiness={readiness}
        repositoryNames={{ api: 'API', web: 'Web' }}
      />,
    )

    const connectorCard = screen
      .getByText('Connector status')
      .closest<HTMLElement>('[data-slot="card"]')
    if (connectorCard === null) throw new Error('Expected connector card')
    expect(within(connectorCard).getByText('ClickUp').nextElementSibling?.textContent).toBe(
      'Not connected',
    )
    expect(within(connectorCard).getByText('GitLab').nextElementSibling?.textContent).toBe(
      'Connected',
    )
    expect(within(connectorCard).getByText('Model provider').nextElementSibling?.textContent).toBe(
      'Not connected',
    )

    const api = screen.getByRole('group', { name: 'API readiness' })
    expect(within(api).getByText('Filesystem')).toBeTruthy()
    expect(within(api).getByText('Git')).toBeTruthy()
    expect(within(api).getByText('Required tools')).toBeTruthy()

    const web = screen.getByRole('group', { name: 'Web readiness' })
    expect(within(web).getByText('ClickUp')).toBeTruthy()
    expect(within(web).getByText('GitLab')).toBeTruthy()
    expect(within(web).getByText('Model provider')).toBeTruthy()
    expect(container.textContent).not.toMatch(/token|api key|secret/i)
  })
})
