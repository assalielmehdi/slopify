// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppShell } from '../components/app-shell'
import { SettingsScreen } from '../components/settings/settings-screen'
import type { ResourceEventStreamHandlers } from '../lib/resource-event-stream'

vi.mock('next/navigation', () => ({
  usePathname: () => '/settings',
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const connection = {
  provider: 'GITHUB' as const,
  accountUsername: 'operator',
  connectedAt: '2026-08-24T00:00:00Z',
  updatedAt: '2026-08-24T00:00:00Z',
}

const createClient = (overrides: Record<string, unknown> = {}) => ({
  getSettings: vi.fn(async () => ({
    value: {
      schemaVersion: 1 as const,
      appearance: { theme: 'system' as const },
      git: { connections: [] },
    },
    etag: '"missing"',
  })),
  updateSettings: vi.fn(async (input: { appearance: { theme: 'light' | 'dark' | 'system' } }) => ({
    value: {
      schemaVersion: 1 as const,
      appearance: input.appearance,
      git: { connections: [] },
    },
    etag: `"${'a'.repeat(64)}"`,
  })),
  listGitConnections: vi.fn(async () => []),
  configureGitConnection: vi.fn(async () => connection),
  disconnectGitConnection: vi.fn(async () => undefined),
  ...overrides,
})

beforeEach(() => {
  const storedPreferences = new Map<string, string>()
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
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      matches: false,
      media: query,
      removeEventListener: vi.fn(),
    })),
  })
})

afterEach(cleanup)

describe('SettingsScreen', () => {
  it('renders Interface and Git without repeating the page title', async () => {
    const client = createClient()
    render(
      <AppShell themeClient={client}>
        <SettingsScreen client={client} />
      </AppShell>,
    )

    const themeOptions = screen.getByRole('radiogroup', { name: 'Theme' })
    expect(screen.queryByRole('heading', { name: 'Settings', level: 1 })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Interface', level: 2 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Git', level: 2 })).toBeTruthy()
    expect(
      within(themeOptions).getByRole('radio', { name: 'System' }).getAttribute('aria-checked'),
    ).toBe('true')
    expect(await screen.findByLabelText('GitHub personal access token')).toBeTruthy()
    expect(screen.getByLabelText('GitLab personal access token')).toBeTruthy()
    expect(screen.getByTestId('github-logo')).toBeTruthy()
    expect(screen.getByTestId('gitlab-logo')).toBeTruthy()
  })

  it('persists one selected theme through the shared settings API', async () => {
    const client = createClient()
    render(
      <AppShell themeClient={client}>
        <SettingsScreen client={client} />
      </AppShell>,
    )

    const dark = screen.getByRole('radio', { name: 'Dark' })
    fireEvent.click(dark)
    await waitFor(() =>
      expect(client.updateSettings).toHaveBeenCalledWith(
        { appearance: { theme: 'dark' } },
        '"missing"',
      ),
    )
    expect(dark.getAttribute('aria-checked')).toBe('true')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('validates and stores a PAT without ever rendering it back', async () => {
    const client = createClient()
    render(
      <AppShell>
        <SettingsScreen client={client} />
      </AppShell>,
    )

    const input = await screen.findByLabelText('GitHub personal access token')
    fireEvent.change(input, { target: { value: 'secret-token' } })
    const connectButton = screen.getAllByRole('button', { name: 'Connect' })[0]
    expect(connectButton).toBeDefined()
    if (!connectButton) throw new Error('Expected a GitHub connect button')
    fireEvent.click(connectButton)

    await waitFor(() =>
      expect(client.configureGitConnection).toHaveBeenCalledWith('GITHUB', {
        token: 'secret-token',
      }),
    )
    expect(
      await screen.findByText(
        'Connected as operator. Tokens are stored in the system credential store.',
      ),
    ).toBeTruthy()
    expect(document.body.textContent).not.toContain('secret-token')
  })

  it('disconnects an existing provider connection', async () => {
    const client = createClient({ listGitConnections: vi.fn(async () => [connection]) })
    render(
      <AppShell>
        <SettingsScreen client={client} />
      </AppShell>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(client.disconnectGitConnection).toHaveBeenCalledWith('GITHUB'))
    expect(await screen.findByLabelText('GitHub personal access token')).toBeTruthy()
  })

  it('refreshes clean theme and Git settings after an external file change', async () => {
    let handlers: ResourceEventStreamHandlers | undefined
    const client = createClient({
      getSettings: vi.fn().mockResolvedValue({
        value: { schemaVersion: 1, appearance: { theme: 'dark' }, git: { connections: [] } },
        etag: `"${'a'.repeat(64)}"`,
      }),
      listGitConnections: vi.fn().mockResolvedValueOnce([]).mockResolvedValue([connection]),
    })
    render(
      <AppShell themeClient={client}>
        <SettingsScreen
          client={client}
          connectResourceEvents={(nextHandlers) => {
            handlers = nextHandlers
            return vi.fn()
          }}
        />
      </AppShell>,
    )

    expect(await screen.findByLabelText('GitHub personal access token')).toBeTruthy()
    await act(async () =>
      handlers?.onEvent({
        sequence: 1,
        timestamp: '2026-08-25T20:00:00.000Z',
        change: 'CHANGED',
        resource: { type: 'SETTINGS' },
        revision: 'a'.repeat(64),
      }),
    )

    expect(await screen.findByText(/Connected as operator/)).toBeTruthy()
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true'),
    )
  })
})
