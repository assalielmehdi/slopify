// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConnectionSettings } from '../components/settings/connection-settings'

const createClient = (overrides: Record<string, unknown> = {}) => ({
  listConnections: vi.fn(async () => []),
  connect: vi.fn(),
  revalidateConnection: vi.fn(),
  replaceConnectionCredential: vi.fn(),
  deleteConnection: vi.fn(),
  startChatGptOAuth: vi.fn(),
  getChatGptOAuth: vi.fn(),
  ...overrides,
})

const gitLabConnection = {
  connectionId: 'gitlab',
  type: 'gitlab' as const,
  category: 'connector' as const,
  label: 'GitLab',
  authority: 'Read and write GitLab resources available to the connected user.',
  configuration: {},
  metadata: { username: 'operator' },
  status: 'CONNECTED' as const,
  validatedAt: '2026-08-20T00:00:00.000Z',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
}

afterEach(cleanup)

describe('ConnectionSettings', () => {
  it('renders fixed provider entries with card and list views plus useful setup details', async () => {
    render(<ConnectionSettings kind="providers" client={createClient()} />)

    expect(screen.getByRole('region', { name: 'Providers' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Providers' })).toBeNull()
    expect(await screen.findByRole('button', { name: /OpenRouter/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /ChatGPT/ })).toBeTruthy()
    expect(screen.queryByLabelText('Label')).toBeNull()
    expect(screen.queryByLabelText('Base URL (optional)')).toBeNull()

    const gridView = screen.getByRole('button', { name: 'Card view' })
    const listView = screen.getByRole('button', { name: 'List view' })
    expect(gridView.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(listView)
    expect(listView.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: /OpenRouter/ }))
    const drawer = screen.getByRole('dialog', { name: 'OpenRouter' })
    expect(within(drawer).getByText('Not connected')).toBeTruthy()
    expect(within(drawer).getByLabelText('OpenRouter API key')).toBeTruthy()
    expect(within(drawer).getByRole('link', { name: 'Create an API key' })).toHaveProperty(
      'href',
      'https://openrouter.ai/settings/keys',
    )
  })

  it('connects the fixed GitLab entry with defaults and never renders the secret', async () => {
    const connect = vi.fn(async () => gitLabConnection)
    render(<ConnectionSettings kind="connectors" client={createClient({ connect })} />)

    expect(await screen.findByRole('button', { name: /GitLab/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /ClickUp/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /GitLab/ }))

    const drawer = screen.getByRole('dialog', { name: 'GitLab' })
    expect(within(drawer).getByText(/api scope/)).toBeTruthy()
    expect(
      within(drawer).getByRole('link', { name: 'Create a personal access token' }),
    ).toHaveProperty(
      'href',
      expect.stringContaining('gitlab.com/-/user_settings/personal_access_tokens'),
    )
    fireEvent.change(within(drawer).getByLabelText('Personal access token'), {
      target: { value: 'secret-pat' },
    })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Connect GitLab' }))

    await waitFor(() =>
      expect(connect).toHaveBeenCalledWith({
        connectionId: 'gitlab',
        type: 'gitlab',
        label: 'GitLab',
        configuration: {},
        credential: { type: 'api_key', key: 'secret-pat' },
      }),
    )
    expect(document.body.textContent).not.toContain('secret-pat')
    expect(within(drawer).getByText('Connected')).toBeTruthy()
  })

  it('manages an existing singleton connection from its drawer', async () => {
    const revalidateConnection = vi.fn(async () => gitLabConnection)
    const replaceConnectionCredential = vi.fn(async () => gitLabConnection)
    const deleteConnection = vi.fn(async () => undefined)
    render(
      <ConnectionSettings
        kind="connectors"
        client={createClient({
          listConnections: vi.fn(async () => [gitLabConnection]),
          revalidateConnection,
          replaceConnectionCredential,
          deleteConnection,
        })}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: /GitLab/ }))
    const drawer = screen.getByRole('dialog', { name: 'GitLab' })
    expect(within(drawer).getByText('Connected')).toBeTruthy()

    fireEvent.click(within(drawer).getByRole('button', { name: 'Revalidate' }))
    await waitFor(() => expect(revalidateConnection).toHaveBeenCalledWith('gitlab'))

    fireEvent.click(within(drawer).getByRole('button', { name: 'Replace credential' }))
    fireEvent.change(within(drawer).getByLabelText('New personal access token'), {
      target: { value: 'replacement-secret' },
    })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Validate replacement' }))
    await waitFor(() =>
      expect(replaceConnectionCredential).toHaveBeenCalledWith('gitlab', 'replacement-secret'),
    )
    expect(document.body.textContent).not.toContain('replacement-secret')

    fireEvent.click(within(drawer).getByRole('button', { name: 'Disconnect GitLab' }))
    await waitFor(() => expect(deleteConnection).toHaveBeenCalledWith('gitlab'))
  })

  it('starts ChatGPT subscription OAuth from the ChatGPT drawer', async () => {
    const pendingOAuth = {
      id: 'oauth-01',
      status: 'PENDING' as const,
      authorizationUrl: 'https://auth.openai.com/authorize',
    }
    const startChatGptOAuth = vi.fn(async () => pendingOAuth)
    render(
      <ConnectionSettings
        kind="providers"
        client={createClient({
          startChatGptOAuth,
          getChatGptOAuth: vi.fn(async () => pendingOAuth),
        })}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: /ChatGPT/ }))
    const drawer = screen.getByRole('dialog', { name: 'ChatGPT' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Connect ChatGPT' }))

    await waitFor(() => expect(startChatGptOAuth).toHaveBeenCalledWith('ChatGPT'))
    expect(
      await within(drawer).findByRole('link', { name: 'Continue with ChatGPT' }),
    ).toHaveProperty('href', 'https://auth.openai.com/authorize')
  })
})
