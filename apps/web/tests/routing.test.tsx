// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import RootLayout from '../app/layout'
import Page from '../app/page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(
        {
          schemaVersion: 1,
          appearance: { theme: 'dark' },
          git: { connections: [] },
        },
        { headers: { etag: `"${'a'.repeat(64)}"` } },
      ),
    ),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('App Router root', () => {
  it('leaves the visible route heading to the shared application shell', async () => {
    render(await Page({ searchParams: Promise.resolve({}) }))

    expect(screen.queryByRole('heading', { level: 1, name: 'Editor' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Editor' })).toBeTruthy()
  })

  it('provides the file-backed theme to the English root document before hydration', async () => {
    const layout = await RootLayout({ children: <p>Workbench</p> })

    expect(layout.type).toBe('html')
    expect(layout.props.lang).toBe('en')
    expect(layout.props.suppressHydrationWarning).toBe(true)
    expect(layout.props.children.type).toBe('body')
    expect(layout.props.children.props.suppressHydrationWarning).toBe(true)
    const bodyChildren = layout.props.children.props.children
    expect(bodyChildren[0].props.dangerouslySetInnerHTML.__html).toContain('dark')
    expect(bodyChildren[1].props.initialSettings).toMatchObject({
      value: { appearance: { theme: 'dark' } },
      etag: `"${'a'.repeat(64)}"`,
    })
  })
})
