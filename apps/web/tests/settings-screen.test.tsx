// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppShell } from '../components/app-shell'
import { SettingsScreen } from '../components/settings/settings-screen'

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
    render(
      <AppShell>
        <SettingsScreen client={createClient()} />
      </AppShell>,
    )

    const themeOptions = screen.getByRole('radiogroup', { name: 'Theme' })
    expect(screen.queryByRole('heading', { name: 'Settings', level: 1 })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Interface', level: 2 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Git', level: 2 })).toBeTruthy()
    expect(
      within(themeOptions).getByRole('radio', { name: 'Light' }).getAttribute('aria-checked'),
    ).toBe('true')
    expect(await screen.findByLabelText('GitHub personal access token')).toBeTruthy()
    expect(screen.getByLabelText('GitLab personal access token')).toBeTruthy()
    expect(screen.getByTestId('github-logo')).toBeTruthy()
    expect(screen.getByTestId('gitlab-logo')).toBeTruthy()
  })

  it('keeps exactly one theme selected and applies the global theme state', () => {
    render(
      <AppShell>
        <SettingsScreen client={createClient()} />
      </AppShell>,
    )

    const dark = screen.getByRole('radio', { name: 'Dark' })
    fireEvent.click(dark)
    expect(dark.getAttribute('aria-checked')).toBe('true')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(window.localStorage.getItem('slopify-theme')).toBe('dark')
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
})
