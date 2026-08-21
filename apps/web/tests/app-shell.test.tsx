// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppShell } from '../components/app-shell'

const navigation = vi.hoisted(() => ({ pathname: '/' }))
const storedPreferences = new Map<string, string>()

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}))

beforeEach(() => {
  navigation.pathname = '/'
  storedPreferences.clear()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      clear: () => storedPreferences.clear(),
      getItem: (key: string) => storedPreferences.get(key) ?? null,
      removeItem: (key: string) => storedPreferences.delete(key),
      setItem: (key: string, value: string) => storedPreferences.set(key, value),
    },
  })
  window.localStorage.clear()
  document.documentElement.classList.remove('dark')
  document.documentElement.style.colorScheme = ''
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
    })),
  })
})

afterEach(cleanup)

describe('AppShell', () => {
  it('groups workflow and configuration destinations with a current-page cue', () => {
    render(
      <AppShell>
        <p>Workflow graph</p>
      </AppShell>,
    )

    expect(screen.getByRole('navigation', { name: 'Workflow' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Configuration' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Slopify' }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('link', { name: 'Editor' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Runs' }).getAttribute('href')).toBe('/runs')
    expect(screen.getByRole('link', { name: 'Providers' }).getAttribute('href')).toBe('/providers')
    expect(screen.getByRole('link', { name: 'Connectors' }).getAttribute('href')).toBe(
      '/connectors',
    )
    expect(screen.getByRole('link', { name: 'Skills' }).getAttribute('href')).toBe('/skills')
    expect(screen.getByRole('link', { name: 'Agent profiles' }).getAttribute('href')).toBe(
      '/agent-profiles',
    )
    expect(screen.getByRole('link', { name: 'Project profiles' }).getAttribute('href')).toBe(
      '/project-profiles',
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Editor' })).toBeTruthy()
    expect(screen.getByText('Workflow graph')).toBeTruthy()
  })

  it('supports the visible toggle and documented keyboard shortcut', () => {
    render(
      <AppShell>
        <p>Workbench</p>
      </AppShell>,
    )

    const sidebar = document.querySelector('[data-slot="sidebar"]')
    expect(sidebar?.getAttribute('data-state')).toBe('expanded')
    const keyboardToggles = screen
      .getAllByRole('button', { name: 'Toggle Sidebar' })
      .filter((button) => button.tabIndex === 0)
    expect(keyboardToggles).toHaveLength(1)

    fireEvent.keyDown(window, { ctrlKey: true, key: 'b' })

    expect(sidebar?.getAttribute('data-state')).toBe('collapsed')
  })

  it('persists an accessible light and dark appearance preference', async () => {
    window.localStorage.setItem('slopify-theme', 'dark')

    render(
      <AppShell>
        <p>Workbench</p>
      </AppShell>,
    )

    const toggle = await screen.findByRole('button', { name: 'Switch to light mode' })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')

    fireEvent.click(toggle)

    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeTruthy()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(window.localStorage.getItem('slopify-theme')).toBe('light')
  })

  it.each([
    ['/', 'Editor', 'Editor'],
    ['/runs/new', 'Editor', 'New run'],
    ['/runs', 'Runs', 'Runs'],
    ['/runs/run-123', 'Runs', 'Run detail'],
    ['/providers', 'Providers', 'Providers'],
    ['/connectors', 'Connectors', 'Connectors'],
    ['/skills', 'Skills', 'Skills'],
    ['/agent-profiles', 'Agent profiles', 'Agent profiles'],
    ['/project-profiles', 'Project profiles', 'Project profiles'],
  ])('maps %s to one current destination and the %s shell title', (pathname, linkName, title) => {
    navigation.pathname = pathname

    render(
      <AppShell>
        <p>Workbench</p>
      </AppShell>,
    )

    const currentLinks = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
    expect(currentLinks).toHaveLength(1)
    expect(currentLinks[0]?.textContent).toContain(linkName)
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy()
  })
})
