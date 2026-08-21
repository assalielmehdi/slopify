// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConnectionSettings } from '../components/settings/connection-settings'

const catalog = [
  {
    type: 'gitlab' as const,
    category: 'connector' as const,
    name: 'GitLab',
    icon: 'gitlab' as const,
    eyebrow: 'Source control',
    summary: 'Read repositories and manage delivery through GitLab.',
    description:
      'Connect GitLab so workflows can inspect projects, create branches, push changes, and manage merge requests available to your user.',
    setup: [
      'Open GitLab personal access token settings.',
      'Create a token named Slopify with the api scope and an appropriate expiration.',
      'Copy the token and paste it below. GitLab only shows it once.',
    ],
    access:
      'This scope grants read and write API access, limited by the projects and permissions already available to your GitLab user.',
    credentialLabel: 'Personal access token',
    replacementLabel: 'New personal access token',
    resourceHref:
      'https://gitlab.com/-/user_settings/personal_access_tokens?name=Slopify&description=Slopify+local+workflow+connector&scopes=api',
    resourceLabel: 'Create a personal access token',
  },
  {
    type: 'clickup' as const,
    category: 'connector' as const,
    name: 'ClickUp',
    icon: 'clickup' as const,
    eyebrow: 'Task management',
    summary: 'Resolve tasks and publish workflow evidence to ClickUp.',
    description:
      'Connect your ClickUp account so workflows can read task context, add review artifacts, and update task status in your accessible Workspaces.',
    setup: [
      'Open ClickUp Settings, then Apps.',
      'Generate or reveal your personal API token under API Token.',
      'Copy the token and paste it below.',
    ],
    access:
      'A personal token inherits your ClickUp access. Slopify validates it by loading your user and available Workspaces.',
    credentialLabel: 'Personal API token',
    replacementLabel: 'New personal API token',
    resourceHref: 'https://app.clickup.com/settings/apps',
    resourceLabel: 'Open ClickUp API settings',
  },
  {
    type: 'openrouter' as const,
    category: 'inference' as const,
    name: 'OpenRouter',
    icon: 'openrouter' as const,
    eyebrow: 'Inference provider',
    summary: 'Run agents across models available through OpenRouter.',
    description:
      'Use one OpenRouter API key to make its model catalog available to Slopify agent profiles.',
    setup: [
      'Create a key in OpenRouter settings.',
      'Optionally set a spending limit for the key.',
      'Copy the key and paste it below. Slopify validates it before storing it locally.',
    ],
    access:
      'The key is used only by the trusted worker for model inference. It is never exposed to workflow prompts or agent sandboxes.',
    credentialLabel: 'OpenRouter API key',
    replacementLabel: 'New OpenRouter API key',
    resourceHref: 'https://openrouter.ai/settings/keys',
    resourceLabel: 'Create an API key',
  },
  {
    type: 'chatgpt-subscription' as const,
    category: 'inference' as const,
    name: 'ChatGPT',
    icon: 'chatgpt' as const,
    eyebrow: 'Subscription provider',
    summary: 'Use a ChatGPT subscription through Pi’s OpenAI Codex provider.',
    description:
      'Connect your ChatGPT account in the browser. Pi stores the resulting OAuth credential in Slopify’s owner-only local credential store.',
    setup: [
      'Start the connection from Slopify.',
      'Continue in the browser and approve the ChatGPT sign-in flow.',
      'Return to Slopify; connection status updates automatically.',
    ],
    access:
      'This uses ChatGPT subscription authentication through Pi’s OpenAI Codex provider, not an OpenAI Platform API key.',
    resourceHref: 'https://chatgpt.com/',
    resourceLabel: 'Open ChatGPT',
  },
]

const createClient = (overrides: Record<string, unknown> = {}) => ({
  listConnections: vi.fn(async () => ({ catalog, connections: [] })),
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
  it('renders no catalog entries when the API catalog is unavailable', async () => {
    render(
      <ConnectionSettings
        kind="connectors"
        client={createClient({
          listConnections: vi.fn(async () => {
            throw new Error('API service is unavailable')
          }),
        })}
      />,
    )

    expect(await screen.findByText('API service is unavailable')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /GitLab/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /ClickUp/ })).toBeNull()
  })

  it('uses the same catalog container spacing for providers and connectors', async () => {
    render(
      <>
        <ConnectionSettings kind="providers" client={createClient()} />
        <ConnectionSettings kind="connectors" client={createClient()} />
      </>,
    )

    const providers = screen.getByRole('region', { name: 'Providers' })
    const connectors = screen.getByRole('region', { name: 'Connectors' })
    await within(providers).findByRole('button', { name: /OpenRouter/ })
    await within(connectors).findByRole('button', { name: /GitLab/ })
    expect(connectors.className).toBe(providers.className)
  })

  it('renders the approved provider catalog, animated view choice, and floating setup panel', async () => {
    render(<ConnectionSettings kind="providers" client={createClient()} />)

    expect(screen.getByRole('region', { name: 'Providers' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Providers' })).toBeNull()
    expect(await screen.findByRole('button', { name: /OpenRouter/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /ChatGPT/ })).toBeTruthy()
    expect(screen.queryByLabelText('Label')).toBeNull()
    expect(screen.queryByLabelText('Base URL (optional)')).toBeNull()

    const catalog = screen.getByRole('region', { name: 'Providers' })
    const grid = within(catalog).getByTestId('connection-grid')
    const viewOptions = within(catalog).getByRole('radiogroup', { name: 'View options' })
    const gridView = within(viewOptions).getByRole('radio', { name: 'Grid view' })
    const listView = within(viewOptions).getByRole('radio', { name: 'List view' })

    expect(gridView.getAttribute('aria-checked')).toBe('true')
    expect(grid.getAttribute('data-layout')).toBe('grid')
    expect(catalog.className).toContain('px-6')
    expect(catalog.className).toContain('pt-6')
    expect(grid.className).toContain('auto-fill')
    expect(within(catalog).getByTestId('openrouter-mark')).toBeTruthy()
    expect(within(catalog).getByTestId('chatgpt-mark')).toBeTruthy()
    expect(within(catalog).queryByText('View setup')).toBeNull()

    fireEvent.click(listView)
    expect(listView.getAttribute('aria-checked')).toBe('true')
    expect(grid.getAttribute('data-layout')).toBe('list')

    fireEvent.click(screen.getByRole('button', { name: /OpenRouter/ }))
    const drawer = await screen.findByRole('dialog', { name: 'OpenRouter' })
    expect(drawer.getAttribute('aria-modal')).toBe('false')
    expect(drawer.getAttribute('data-layout')).toBe('floating')
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull()
    expect(within(drawer).getByText('Not connected')).toBeTruthy()
    expect(within(drawer).getByLabelText('OpenRouter API key')).toBeTruthy()
    expect(within(drawer).getByRole('link', { name: 'Create an API key' })).toHaveProperty(
      'href',
      'https://openrouter.ai/settings/keys',
    )
  })

  it('renders connectors with the approved catalog, branded marks, and floating setup panel', async () => {
    render(<ConnectionSettings kind="connectors" client={createClient()} />)

    const catalog = screen.getByRole('region', { name: 'Connectors' })
    const grid = within(catalog).getByTestId('connection-grid')
    const viewOptions = within(catalog).getByRole('radiogroup', { name: 'View options' })
    const gridView = within(viewOptions).getByRole('radio', { name: 'Grid view' })
    const listView = within(viewOptions).getByRole('radio', { name: 'List view' })

    expect(await within(catalog).findByRole('button', { name: /GitLab/ })).toBeTruthy()
    expect(within(catalog).getByRole('button', { name: /ClickUp/ })).toBeTruthy()
    expect(within(catalog).getByTestId('gitlab-mark')).toBeTruthy()
    expect(within(catalog).getByTestId('clickup-mark')).toBeTruthy()
    expect(gridView.getAttribute('aria-checked')).toBe('true')
    expect(grid.getAttribute('data-layout')).toBe('grid')
    expect(catalog.className).toContain('px-6')
    expect(catalog.className).toContain('pt-6')
    expect(grid.className).toContain('auto-fill')
    expect(within(catalog).queryByText('View setup')).toBeNull()

    fireEvent.click(listView)
    expect(listView.getAttribute('aria-checked')).toBe('true')
    expect(grid.getAttribute('data-layout')).toBe('list')

    fireEvent.click(within(catalog).getByRole('button', { name: /ClickUp/ }))
    const drawer = await screen.findByRole('dialog', { name: 'ClickUp' })
    expect(drawer.getAttribute('aria-modal')).toBe('false')
    expect(drawer.getAttribute('data-layout')).toBe('floating')
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull()
    expect(within(drawer).getByLabelText('Personal API token')).toBeTruthy()
    expect(within(drawer).getByRole('link', { name: 'Open ClickUp API settings' })).toHaveProperty(
      'href',
      'https://app.clickup.com/settings/apps',
    )
  })

  it('connects the fixed GitLab entry with defaults and never renders the secret', async () => {
    const connect = vi.fn(async () => gitLabConnection)
    render(<ConnectionSettings kind="connectors" client={createClient({ connect })} />)

    expect(await screen.findByRole('button', { name: /GitLab/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /ClickUp/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /GitLab/ }))

    const drawer = await screen.findByRole('dialog', { name: 'GitLab' })
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
          listConnections: vi.fn(async () => ({ catalog, connections: [gitLabConnection] })),
          revalidateConnection,
          replaceConnectionCredential,
          deleteConnection,
        })}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: /GitLab/ }))
    const drawer = await screen.findByRole('dialog', { name: 'GitLab' })
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
    const drawer = await screen.findByRole('dialog', { name: 'ChatGPT' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Connect ChatGPT' }))

    await waitFor(() => expect(startChatGptOAuth).toHaveBeenCalledWith('ChatGPT'))
    expect(
      await within(drawer).findByRole('link', { name: 'Continue with ChatGPT' }),
    ).toHaveProperty('href', 'https://auth.openai.com/authorize')
  })
})
