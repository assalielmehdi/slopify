// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppShell } from '../components/app-shell'

const navigation = vi.hoisted(() => ({ pathname: '/' }))

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}))

beforeEach(() => {
  navigation.pathname = '/'
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
  it('renders the workbench navigation and route content with a current-page cue', () => {
    render(
      <AppShell>
        <h1>Workflow graph</h1>
      </AppShell>,
    )

    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Slopify' }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('link', { name: 'Workflow' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'New run' }).getAttribute('href')).toBe('/runs/new')
    expect(screen.getByRole('link', { name: 'Run history' }).getAttribute('href')).toBe('/runs')
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings')
    expect(screen.getByRole('heading', { level: 1, name: 'Workflow graph' })).toBeTruthy()
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

  it.each([
    ['/', 'Workflow', 'Workflow'],
    ['/runs/new', 'New run', 'New run'],
    ['/runs', 'Run history', 'Run history'],
    ['/runs/run-123', 'Run history', 'Run detail'],
    ['/settings', 'Settings', 'Settings'],
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
    expect(screen.getByText(title, { selector: 'header p' })).toBeTruthy()
  })
})
