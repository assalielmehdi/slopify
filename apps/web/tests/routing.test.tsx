// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import RootLayout from '../app/layout'
import Page from '../app/page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

afterEach(cleanup)

describe('App Router root', () => {
  it('leaves the visible route heading to the shared application shell', async () => {
    render(await Page({ searchParams: Promise.resolve({}) }))

    expect(screen.queryByRole('heading', { level: 1, name: 'Editor' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Editor' })).toBeTruthy()
  })

  it('provides the required English root document layout', () => {
    const layout = RootLayout({ children: <p>Workbench</p> })

    expect(layout.type).toBe('html')
    expect(layout.props.lang).toBe('en')
    expect(layout.props.suppressHydrationWarning).toBe(true)
    expect(layout.props.children.type).toBe('body')
    expect(layout.props.children.props.suppressHydrationWarning).toBe(true)
  })
})
