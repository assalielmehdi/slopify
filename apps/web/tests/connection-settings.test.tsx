// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConnectionSettings } from '../components/settings/connection-settings'

afterEach(cleanup)

describe('ConnectionSettings', () => {
  it('submits a secret only to the connection endpoint and renders non-secret metadata', async () => {
    const connect = vi.fn(async () => ({
      connectionId: 'gitlab-primary',
      type: 'gitlab' as const,
      category: 'connector' as const,
      label: 'GitLab',
      authority: 'GitLab access',
      configuration: { baseUrl: 'https://gitlab.com' },
      metadata: { username: 'operator' },
      status: 'CONNECTED' as const,
      validatedAt: '2026-08-20T00:00:00.000Z',
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z',
    }))
    render(
      <ConnectionSettings
        client={{
          listConnections: vi.fn(async () => []),
          connect,
          revalidateConnection: vi.fn(),
          replaceConnectionCredential: vi.fn(),
          deleteConnection: vi.fn(),
          startChatGptOAuth: vi.fn(),
          getChatGptOAuth: vi.fn(),
        }}
      />,
    )
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'GitLab' } })
    fireEvent.change(screen.getByLabelText('Base URL (optional)'), {
      target: { value: 'https://gitlab.com' },
    })
    fireEvent.change(screen.getByLabelText('PAT or API key'), { target: { value: 'secret-pat' } })
    fireEvent.click(screen.getByRole('button', { name: 'Validate and connect' }))

    await waitFor(() =>
      expect(connect).toHaveBeenCalledWith({
        type: 'gitlab',
        label: 'GitLab',
        configuration: { baseUrl: 'https://gitlab.com' },
        credential: { type: 'api_key', key: 'secret-pat' },
      }),
    )
    expect(await screen.findByText('GitLab access', { exact: false })).toBeTruthy()
    expect(document.body.textContent).not.toContain('secret-pat')
  })

  it('replaces and revalidates an API credential without rendering it', async () => {
    const connection = {
      connectionId: 'gitlab-primary',
      type: 'gitlab' as const,
      category: 'connector' as const,
      label: 'GitLab',
      authority: 'GitLab access',
      configuration: { baseUrl: 'https://gitlab.com' },
      metadata: { username: 'operator' },
      status: 'CONNECTED' as const,
      validatedAt: '2026-08-20T00:00:00.000Z',
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z',
    }
    const replaceConnectionCredential = vi.fn(async () => connection)
    render(
      <ConnectionSettings
        client={{
          listConnections: vi.fn(async () => [connection]),
          connect: vi.fn(),
          revalidateConnection: vi.fn(),
          replaceConnectionCredential,
          deleteConnection: vi.fn(),
          startChatGptOAuth: vi.fn(),
          getChatGptOAuth: vi.fn(),
        }}
      />,
    )

    await screen.findByText('GitLab access', { exact: false })
    fireEvent.click(screen.getByRole('button', { name: 'Replace credential for GitLab' }))
    fireEvent.change(screen.getByLabelText('New credential for GitLab'), {
      target: { value: 'replacement-secret' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Validate replacement for GitLab' }))

    await waitFor(() =>
      expect(replaceConnectionCredential).toHaveBeenCalledWith(
        'gitlab-primary',
        'replacement-secret',
      ),
    )
    expect(document.body.textContent).not.toContain('replacement-secret')
  })
})
