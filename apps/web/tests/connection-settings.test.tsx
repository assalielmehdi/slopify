// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConnectionSettings } from '../components/settings/connection-settings'
import { toast } from '../components/ui/toast'

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
    skillId: 'gitlab-connector',
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
    skillId: 'clickup-connector',
  },
  {
    type: 'openrouter' as const,
    category: 'inference' as const,
    name: 'OpenRouter',
    icon: 'openrouter' as const,
    eyebrow: 'Inference provider',
    summary: 'Run agents across models available through OpenRouter.',
    description:
      'Use one OpenRouter API key to make its model catalog available to workflow agent jobs.',
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
  cancelChatGptOAuth: vi.fn(),
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

const connectionFor = (type: (typeof catalog)[number]['type']) => {
  const definition = catalog.find((entry) => entry.type === type)
  if (definition === undefined) throw new Error(`Missing catalog definition for ${type}`)
  return {
    ...gitLabConnection,
    connectionId: type,
    type,
    category: definition.category,
    label: definition.name,
  }
}

it.each(['providers', 'connectors'] as const)(
  'shows card skeletons while %s are loading',
  async (kind) => {
    let resolve: ((value: { catalog: typeof catalog; connections: [] }) => void) | undefined
    const listConnections = vi.fn(
      () =>
        new Promise<{ catalog: typeof catalog; connections: [] }>((next) => {
          resolve = next
        }),
    )

    render(<ConnectionSettings kind={kind} client={createClient({ listConnections })} />)

    expect(screen.getByRole('status', { name: `Loading ${kind}` })).toBeTruthy()
    expect(screen.getAllByTestId('catalog-card-skeleton')).toHaveLength(3)
    expect(screen.queryByText(new RegExp(`No ${kind} configured`, 'i'))).toBeNull()

    await act(async () => resolve?.({ catalog, connections: [] }))
    await waitFor(() =>
      expect(screen.queryByRole('status', { name: `Loading ${kind}` })).toBeNull(),
    )
  },
)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ConnectionSettings', () => {
  it('opens a linked connector after confirming it is still configured', async () => {
    render(
      <ConnectionSettings
        kind="connectors"
        initialConnectionId="gitlab"
        client={createClient({
          listConnections: vi.fn(async () => ({ catalog, connections: [gitLabConnection] })),
        })}
      />,
    )

    expect(await screen.findByRole('dialog', { name: 'GitLab' })).toBeTruthy()
  })

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
    await within(providers).findByText('No providers configured')
    await within(connectors).findByText('No connectors configured')
    expect(connectors.className).toBe(providers.className)
  })

  it.each([
    {
      kind: 'providers' as const,
      title: 'Providers',
      singular: 'provider',
      query: 'chat',
      visible: /ChatGPT/,
      hidden: /OpenRouter/,
    },
    {
      kind: 'connectors' as const,
      title: 'Connectors',
      singular: 'connector',
      query: 'task',
      visible: /ClickUp/,
      hidden: /GitLab/,
    },
  ])(
    'uses the shared compact toolbar and filters $title while typing',
    async ({ kind, title, singular, query, visible, hidden }) => {
      const connections =
        kind === 'providers'
          ? [connectionFor('openrouter'), connectionFor('chatgpt-subscription')]
          : [connectionFor('gitlab'), connectionFor('clickup')]
      render(
        <ConnectionSettings
          kind={kind}
          client={createClient({
            listConnections: vi.fn(async () => ({ catalog, connections })),
          })}
        />,
      )

      const catalogRegion = screen.getByRole('region', { name: title })
      await within(catalogRegion).findByRole('button', { name: visible })
      const searchSlot = within(catalogRegion).getByRole('search')
      const add = within(catalogRegion).getByRole('button', { name: `Add ${singular}` })

      expect(searchSlot.className).toContain('[--resize-dur:var(--duration-very-slow)]')
      expect(add.className).toContain('t-resize')
      expect(add.className).toContain('w-8')
      expect(add.className).toContain('hover:w-max')
      expect(add.className).not.toMatch(/hover:w-\d/)
      expect(add.className).toContain('[--resize-dur:var(--duration-very-slow)]')
      expect(
        within(catalogRegion).queryByRole('button', { name: 'Refresh from filesystem' }),
      ).toBeNull()

      fireEvent.click(
        within(catalogRegion).getByRole('button', { name: `Open ${singular} search` }),
      )
      const search = within(catalogRegion).getByRole('searchbox', {
        name: `Search ${title.toLocaleLowerCase()}`,
      })
      expect(document.activeElement).toBe(search)
      fireEvent.change(search, { target: { value: query } })

      expect(within(catalogRegion).getByRole('button', { name: visible })).toBeTruthy()
      expect(within(catalogRegion).queryByRole('button', { name: hidden })).toBeNull()
    },
  )

  it.each([
    { kind: 'providers' as const, singular: 'provider', choices: ['OpenRouter', 'ChatGPT'] },
    { kind: 'connectors' as const, singular: 'connector', choices: ['GitLab', 'ClickUp'] },
  ])('opens the supported Add $singular chooser', async ({ kind, singular, choices }) => {
    const client = createClient()
    render(<ConnectionSettings kind={kind} client={client} />)

    fireEvent.click(screen.getByRole('button', { name: `Add ${singular}` }))
    const drawer = await screen.findByRole('dialog', { name: `Add ${singular}` })

    expect(drawer.getAttribute('aria-modal')).toBe('false')
    expect(drawer.getAttribute('data-layout')).toBe('floating')
    expect(within(drawer).getByText(`Choose a supported ${singular}`)).toBeTruthy()
    for (const choice of choices) {
      expect(within(drawer).getByRole('button', { name: `Configure ${choice}` })).toBeTruthy()
    }
    expect(client.connect).not.toHaveBeenCalled()
    expect(client.startChatGptOAuth).not.toHaveBeenCalled()
  })

  it('renders only configured providers and opens their management panel', async () => {
    render(
      <ConnectionSettings
        kind="providers"
        client={createClient({
          listConnections: vi.fn(async () => ({
            catalog,
            connections: [connectionFor('openrouter')],
          })),
        })}
      />,
    )

    expect(screen.getByRole('region', { name: 'Providers' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Providers' })).toBeNull()
    const providerCard = await screen.findByRole('button', { name: /OpenRouter/ })
    const providerCardClasses = providerCard.className.split(/\s+/)
    expect(providerCardClasses).toContain('h-auto')
    expect(providerCardClasses).toContain('min-h-[140px]')
    expect(providerCardClasses).not.toContain('h-[140px]')
    expect(screen.queryByRole('button', { name: /ChatGPT/ })).toBeNull()
    expect(screen.queryByLabelText('Label')).toBeNull()
    expect(screen.queryByLabelText('Base URL (optional)')).toBeNull()

    const catalogRegion = screen.getByRole('region', { name: 'Providers' })
    const grid = await within(catalogRegion).findByTestId('connection-grid')

    expect(within(catalogRegion).queryByRole('radiogroup', { name: 'View options' })).toBeNull()
    expect(catalogRegion.className).toContain('px-6')
    expect(catalogRegion.className).toContain('pt-6')
    expect(grid.className).toContain('auto-fill')
    expect(within(catalogRegion).getByTestId('openrouter-mark')).toBeTruthy()
    expect(within(catalogRegion).queryByTestId('chatgpt-mark')).toBeNull()
    expect(within(catalogRegion).queryByText('View setup')).toBeNull()
    const tags = within(catalogRegion)
      .getByText('Connected')
      .closest('[data-slot="catalog-card-tags"]')
    expect(tags?.className).toContain('justify-end')
    expect(tags?.className).toContain('pt-2')

    fireEvent.click(screen.getByRole('button', { name: /OpenRouter/ }))
    const drawer = await screen.findByRole('dialog', { name: 'OpenRouter' })
    expect(drawer.getAttribute('aria-modal')).toBe('false')
    expect(drawer.getAttribute('data-layout')).toBe('floating')
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull()
    expect(within(drawer).getByText('Connected')).toBeTruthy()
    expect(within(drawer).queryByLabelText('OpenRouter API key')).toBeNull()
    expect(within(drawer).getByRole('link', { name: 'Create an API key' })).toHaveProperty(
      'href',
      'https://openrouter.ai/settings/keys',
    )
  })

  it('renders only configured connectors with the approved branded cards', async () => {
    render(
      <ConnectionSettings
        kind="connectors"
        client={createClient({
          listConnections: vi.fn(async () => ({
            catalog,
            connections: [connectionFor('clickup')],
          })),
        })}
      />,
    )

    const catalogRegion = screen.getByRole('region', { name: 'Connectors' })
    const grid = await within(catalogRegion).findByTestId('connection-grid')

    expect(await within(catalogRegion).findByRole('button', { name: /ClickUp/ })).toBeTruthy()
    expect(within(catalogRegion).queryByRole('button', { name: /GitLab/ })).toBeNull()
    expect(within(catalogRegion).queryByTestId('gitlab-mark')).toBeNull()
    expect(within(catalogRegion).getByTestId('clickup-mark')).toBeTruthy()
    expect(within(catalogRegion).queryByRole('radiogroup', { name: 'View options' })).toBeNull()
    expect(catalogRegion.className).toContain('px-6')
    expect(catalogRegion.className).toContain('pt-6')
    expect(grid.className).toContain('auto-fill')
    expect(within(catalogRegion).queryByText('View setup')).toBeNull()

    fireEvent.click(within(catalogRegion).getByRole('button', { name: /ClickUp/ }))
    const drawer = await screen.findByRole('dialog', { name: 'ClickUp' })
    expect(drawer.getAttribute('aria-modal')).toBe('false')
    expect(drawer.getAttribute('data-layout')).toBe('floating')
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull()
    expect(within(drawer).queryByLabelText('Personal API token')).toBeNull()
    expect(within(drawer).getByRole('link', { name: 'Open ClickUp API settings' })).toHaveProperty(
      'href',
      'https://app.clickup.com/settings/apps',
    )
  })

  it('connects the fixed GitLab entry with defaults and never renders the secret', async () => {
    const connect = vi.fn(async () => gitLabConnection)
    render(<ConnectionSettings kind="connectors" client={createClient({ connect })} />)

    expect(await screen.findByText('No connectors configured')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add connector' }))
    const chooser = await screen.findByRole('dialog', { name: 'Add connector' })
    fireEvent.click(within(chooser).getByRole('button', { name: 'Configure GitLab' }))

    const drawer = await screen.findByRole('dialog', { name: 'GitLab' })
    expect(within(drawer).getByRole('link', { name: 'View skill' })).toHaveProperty(
      'href',
      'http://localhost:3000/skills?skill=gitlab-connector',
    )
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
        type: 'gitlab',
        configuration: {},
        credential: { type: 'api_key', key: 'secret-pat' },
      }),
    )
    expect(document.body.textContent).not.toContain('secret-pat')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByRole('button', { name: /GitLab, Connected/ })).toBeTruthy()
  })

  it('keeps failed validation empty and never renders the submitted credential', async () => {
    const connect = vi.fn(async () => {
      throw new Error('Credential could not be validated')
    })
    render(<ConnectionSettings kind="providers" client={createClient({ connect })} />)

    const addProvider = await screen.findByRole('button', { name: 'Add provider' })
    expect(addProvider.className).toContain('hover:w-max')
    expect(addProvider.className).toContain('gap-2')
    fireEvent.click(addProvider)
    const chooser = await screen.findByRole('dialog', { name: 'Add provider' })
    fireEvent.click(within(chooser).getByRole('button', { name: 'Configure OpenRouter' }))
    const drawer = await screen.findByRole('dialog', { name: 'OpenRouter' })
    fireEvent.change(within(drawer).getByLabelText('OpenRouter API key'), {
      target: { value: 'invalid-secret' },
    })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Connect OpenRouter' }))

    expect(await screen.findByText('Credential could not be validated')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /OpenRouter, Connected/ })).toBeNull()
    expect(document.body.textContent).not.toContain('invalid-secret')
  })

  it('offers only supported types that are not already configured', async () => {
    render(
      <ConnectionSettings
        kind="connectors"
        client={createClient({
          listConnections: vi.fn(async () => ({ catalog, connections: [gitLabConnection] })),
        })}
      />,
    )

    const addConnector = await screen.findByRole('button', { name: 'Add connector' })
    expect(addConnector.className).toContain('hover:w-max')
    expect(addConnector.className).toContain('gap-2')
    fireEvent.click(addConnector)
    const drawer = await screen.findByRole('dialog', { name: 'Add connector' })
    expect(within(drawer).queryByRole('button', { name: 'Configure GitLab' })).toBeNull()
    expect(within(drawer).getByRole('button', { name: 'Configure ClickUp' })).toBeTruthy()
  })

  it('manages an existing singleton connection from its drawer', async () => {
    const toastAdd = vi.spyOn(toast, 'add')
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
    const shell = screen.getByTestId('connection-panel-shell')
    const content = within(drawer).getByTestId('connection-panel-content')
    const actions = within(drawer).getByTestId('connection-panel-actions')
    expect(within(drawer).getByText('Connected')).toBeTruthy()
    expect(shell.className).toContain('top-[4.25rem]')
    expect(shell.className).toContain('bottom-3')
    expect(shell.className).not.toContain('inset-y-3')
    expect(content.className).toContain('gap-8')
    expect(within(drawer).queryByRole('separator')).toBeNull()
    expect(actions.className).toContain('justify-end')
    expect(content.lastElementChild).toBe(actions)

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

    fireEvent.click(within(drawer).getByRole('button', { name: 'Delete connector' }))
    const confirmation = within(drawer).getByLabelText('Type GitLab to confirm')
    expect(document.activeElement).toBe(confirmation)
    expect(
      within(drawer).getByRole<HTMLButtonElement>('button', { name: 'Confirm' }).disabled,
    ).toBe(true)
    fireEvent.change(confirmation, {
      target: { value: 'GitLab' },
    })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(deleteConnection).toHaveBeenCalledWith('gitlab'))
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Connector deleted', type: 'success' }),
    )
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /GitLab, Connected/ })).toBeNull(),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add connector' }))
    const chooser = await screen.findByRole('dialog', { name: 'Add connector' })
    expect(within(chooser).getByRole('button', { name: 'Configure GitLab' })).toBeTruthy()
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

    fireEvent.click(await screen.findByRole('button', { name: 'Add provider' }))
    const chooser = await screen.findByRole('dialog', { name: 'Add provider' })
    fireEvent.click(within(chooser).getByRole('button', { name: 'Configure ChatGPT' }))
    const drawer = await screen.findByRole('dialog', { name: 'ChatGPT' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Connect ChatGPT' }))

    await waitFor(() => expect(startChatGptOAuth).toHaveBeenCalledWith())
    expect(
      await within(drawer).findByRole('link', { name: 'Continue with ChatGPT' }),
    ).toHaveProperty('href', 'https://auth.openai.com/authorize')
  })

  it('cancels pending ChatGPT authentication when the drawer closes', async () => {
    const pendingOAuth = {
      id: 'oauth-01',
      status: 'PENDING' as const,
      authorizationUrl: 'https://auth.openai.com/authorize',
    }
    const cancelChatGptOAuth = vi.fn(async () => undefined)
    render(
      <ConnectionSettings
        kind="providers"
        client={createClient({
          startChatGptOAuth: vi.fn(async () => pendingOAuth),
          getChatGptOAuth: vi.fn(async () => pendingOAuth),
          cancelChatGptOAuth,
        })}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Add provider' }))
    const chooser = await screen.findByRole('dialog', { name: 'Add provider' })
    fireEvent.click(within(chooser).getByRole('button', { name: 'Configure ChatGPT' }))
    const drawer = await screen.findByRole('dialog', { name: 'ChatGPT' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Connect ChatGPT' }))
    await within(drawer).findByRole('link', { name: 'Continue with ChatGPT' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close connection details' }))

    await waitFor(() => expect(cancelChatGptOAuth).toHaveBeenCalledWith('oauth-01'))
  })

  it('surfaces ChatGPT authentication polling failures in the drawer', async () => {
    const pendingOAuth = {
      id: 'oauth-01',
      status: 'PENDING' as const,
      authorizationUrl: 'https://auth.openai.com/authorize',
    }
    render(
      <ConnectionSettings
        kind="providers"
        client={createClient({
          startChatGptOAuth: vi.fn(async () => pendingOAuth),
          getChatGptOAuth: vi.fn(async () => {
            throw new Error('Authentication status unavailable')
          }),
        })}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Add provider' }))
    const chooser = await screen.findByRole('dialog', { name: 'Add provider' })
    fireEvent.click(within(chooser).getByRole('button', { name: 'Configure ChatGPT' }))
    const drawer = await screen.findByRole('dialog', { name: 'ChatGPT' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Connect ChatGPT' }))

    expect(
      await within(drawer).findByText('Authentication status unavailable', {}, { timeout: 2_500 }),
    ).toBeTruthy()
  })
})
