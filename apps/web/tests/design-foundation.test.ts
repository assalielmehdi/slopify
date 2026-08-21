import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('the application design foundation', () => {
  it('uses a single tokenized motion system with a reduced-motion fallback', () => {
    const stylesheet = source('app/globals.css')

    expect(stylesheet).toContain('--duration-quick: 150ms')
    expect(stylesheet).toContain('--duration-overlay: 240ms')
    expect(stylesheet).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('uses Geist for interface text and monospace evidence', () => {
    const layout = source('app/layout.tsx')

    expect(layout).toContain("import { Geist, Geist_Mono } from 'next/font/google'")
    expect(layout).toContain("variable: '--font-sans'")
    expect(layout).toContain("variable: '--font-mono'")
  })

  it('sets the saved color scheme before the application hydrates', () => {
    const layout = source('app/layout.tsx')

    expect(layout).toContain('slopify-theme')
    expect(layout).toContain('suppressHydrationWarning')
  })

  it.each([
    'components/ui/button.tsx',
    'components/ui/card.tsx',
    'components/ui/input.tsx',
    'components/ui/textarea.tsx',
    'components/ui/native-select.tsx',
    'components/ui/select.tsx',
    'components/ui/badge.tsx',
    'components/ui/table.tsx',
  ])('%s respects the shared radius instead of forcing square corners', (path) => {
    expect(source(path)).not.toContain('rounded-none')
  })

  it('limits button animation to properties that communicate state', () => {
    const button = source('components/ui/button.tsx')

    expect(button).not.toContain('transition-all')
    expect(button).toContain(
      'transition-[color,background-color,border-color,box-shadow,transform]',
    )
  })
})
