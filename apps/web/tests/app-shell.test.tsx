// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
  document.documentElement.classList.remove('dark')
  document.documentElement.style.colorScheme = ''
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
  it('uses one base surface across navigation and the workspace', () => {
    const { container } = render(
      <AppShell>
        <p>Workflow graph</p>
      </AppShell>,
    )

    const navigation = container.querySelector('aside')
    expect(navigation?.getAttribute('data-surface')).toBe('base')
    expect(navigation?.className).toContain('bg-background')
    expect(navigation?.className).not.toContain('bg-sidebar')
    expect(container.querySelector('header')?.getAttribute('data-surface')).toBe('base')
    expect(screen.getByRole('main').getAttribute('data-surface')).toBe('base')
  })

  it('renders the approved navigation hierarchy and clickable breadcrumbs', () => {
    render(
      <AppShell>
        <p>Workflow graph</p>
      </AppShell>,
    )

    const primaryNavigation = screen.getByRole('navigation', { name: 'Primary navigation' })
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' })

    expect(primaryNavigation.getAttribute('data-state')).toBe('expanded')
    expect(within(primaryNavigation).getByText('Workflow')).toBeTruthy()
    expect(within(primaryNavigation).getByText('Configuration')).toBeTruthy()
    expect(
      within(primaryNavigation).getByRole('link', { name: 'Editor' }).getAttribute('aria-current'),
    ).toBe('page')
    expect(
      within(primaryNavigation).getByRole('link', { name: 'Harnesses' }).getAttribute('href'),
    ).toBe('/harnesses')
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings')
    expect(within(breadcrumb).getByRole('link', { name: 'Workflow' }).getAttribute('href')).toBe(
      '/',
    )
    expect(within(breadcrumb).getByRole('link', { name: 'Editor' }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('main').className).not.toContain('p-6')
    expect(screen.getByText('Workflow graph')).toBeTruthy()
  })

  it('places the collapse control in the title row and toggles with B outside inputs', () => {
    render(
      <AppShell>
        <input aria-label="Workflow name" />
      </AppShell>,
    )

    const navigation = screen.getByRole('navigation', { name: 'Primary navigation' })
    const collapseButton = screen.getByRole('button', { name: 'Collapse navigation' })

    expect(collapseButton.closest('aside')).not.toBeNull()
    expect(collapseButton.getAttribute('aria-keyshortcuts')).toBe('B')

    fireEvent.keyDown(window, { key: 'b' })
    expect(navigation.getAttribute('data-state')).toBe('collapsed')

    const expandButton = screen.getByRole('button', { name: 'Expand navigation' })
    expect(expandButton.closest('aside')).toBeNull()
    expect(expandButton.getAttribute('aria-keyshortcuts')).toBe('B')

    const input = screen.getByRole('textbox', { name: 'Workflow name' })
    input.focus()
    fireEvent.keyDown(input, { key: 'b' })
    expect(navigation.getAttribute('data-state')).toBe('collapsed')
  })

  it('uses D for a persisted direct light and dark toggle', () => {
    window.localStorage.setItem('slopify-theme', 'dark')

    render(
      <AppShell>
        <p>Workbench</p>
      </AppShell>,
    )

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')

    fireEvent.keyDown(window, { key: 'd' })

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(window.localStorage.getItem('slopify-theme')).toBe('light')
  })

  it.each([
    ['/runs', 'Runs', ['Runs']],
    ['/runs/new', 'Runs', ['Runs', 'New run']],
    ['/runs/run-123', 'Runs', ['Runs', '123']],
    ['/harnesses', 'Harnesses', ['Harnesses']],
    ['/projects', 'Projects', ['Projects']],
    ['/settings', 'Settings', ['Settings']],
  ])('maps %s to the %s destination and breadcrumb', (pathname, linkName, crumbs) => {
    navigation.pathname = pathname

    render(
      <AppShell>
        <p>Workbench</p>
      </AppShell>,
    )

    const primaryNavigation = screen.getByRole('navigation', { name: 'Primary navigation' })
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    const currentNavigationLinks = within(primaryNavigation)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')

    expect(currentNavigationLinks).toHaveLength(linkName === 'Settings' ? 0 : 1)
    if (linkName !== 'Settings') {
      expect(currentNavigationLinks[0]?.textContent).toContain(linkName)
    } else {
      const settingsLinks = screen.getAllByRole('link', { name: 'Settings' })
      expect(settingsLinks.some((link) => link.getAttribute('aria-current') === 'page')).toBe(true)
    }
    expect(
      within(breadcrumb)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(crumbs)
  })

  it.each(['/harnesses', '/projects', '/runs', '/runs/run-123'])(
    'does not add shell padding around the full-width route %s',
    (pathname) => {
      navigation.pathname = pathname

      render(
        <AppShell>
          <section className="w-full px-6 pt-6">Catalog</section>
        </AppShell>,
      )

      const main = screen.getByRole('main')
      expect(main.className).not.toContain('p-6')
      expect(main.className).not.toContain('sm:p-8')
      if (pathname.startsWith('/runs/')) expect(main.className).toContain('overflow-hidden')
    },
  )
})
