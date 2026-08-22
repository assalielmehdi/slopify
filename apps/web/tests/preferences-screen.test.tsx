// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppShell } from '../components/app-shell'
import { PreferencesScreen } from '../components/preferences/preferences-screen'

vi.mock('next/navigation', () => ({ usePathname: () => '/preferences' }))

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

describe('PreferencesScreen', () => {
  it('renders the approved Interface group without repeating the page title', () => {
    render(
      <AppShell>
        <PreferencesScreen />
      </AppShell>,
    )

    const themeOptions = screen.getByRole('radiogroup', { name: 'Theme' })

    expect(screen.queryByRole('heading', { name: 'Preferences', level: 1 })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Interface', level: 2 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Theme', level: 3 })).toBeTruthy()
    expect(
      within(themeOptions).getByRole('radio', { name: 'Light' }).getAttribute('aria-checked'),
    ).toBe('true')
    expect(
      within(themeOptions).getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked'),
    ).toBe('false')
    expect(
      within(themeOptions).getByRole('radio', { name: 'System' }).getAttribute('aria-checked'),
    ).toBe('false')
    expect(screen.getByTestId('theme-selection-indicator')).toBeTruthy()
  })

  it('keeps exactly one theme selected and applies the same global theme state', () => {
    render(
      <AppShell>
        <PreferencesScreen />
      </AppShell>,
    )

    const dark = screen.getByRole('radio', { name: 'Dark' })
    const system = screen.getByRole('radio', { name: 'System' })

    fireEvent.click(dark)
    expect(dark.getAttribute('aria-checked')).toBe('true')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(window.localStorage.getItem('slopify-theme')).toBe('dark')

    fireEvent.click(system)
    expect(system.getAttribute('aria-checked')).toBe('true')
    expect(dark.getAttribute('aria-checked')).toBe('false')
    expect(window.localStorage.getItem('slopify-theme')).toBe('system')
  })
})
