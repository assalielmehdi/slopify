import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const token = (stylesheet: string, scope: ':root' | '.dark', name: string): string | undefined => {
  const block = new RegExp(`\\${scope} \\{(?<tokens>[\\s\\S]*?)\\n\\}`).exec(stylesheet)?.groups
    ?.tokens
  return new RegExp(`--${name}:\\s*(?<value>[^;]+);`, 'i').exec(block ?? '')?.groups?.value
}

describe('the application design foundation', () => {
  it('uses a single tokenized motion system with a reduced-motion fallback', () => {
    const stylesheet = source('app/globals.css')

    expect(stylesheet).toContain('--duration-quick: 150ms')
    expect(stylesheet).toContain('--duration-very-slow: 500ms')
    expect(stylesheet).toContain('--duration-overlay: 240ms')
    expect(stylesheet).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('uses one pure canvas for the shell and ordinary surfaces in both themes', () => {
    const stylesheet = source('app/globals.css')

    expect(token(stylesheet, ':root', 'background')).toBe('#ffffff')
    expect(token(stylesheet, ':root', 'card')).toBe('#ffffff')
    expect(token(stylesheet, ':root', 'popover')).toBe('#ffffff')
    expect(token(stylesheet, ':root', 'sidebar')).toBe('#ffffff')
    expect(token(stylesheet, '.dark', 'background')).toBe('#000000')
    expect(token(stylesheet, '.dark', 'card')).toBe('#000000')
    expect(token(stylesheet, '.dark', 'popover')).toBe('#000000')
    expect(token(stylesheet, '.dark', 'sidebar')).toBe('#000000')
  })

  it('uses the quiet structural border color for input boundaries in both themes', () => {
    const stylesheet = source('app/globals.css')

    expect(token(stylesheet, ':root', 'input')).toBe('var(--border)')
    expect(token(stylesheet, '.dark', 'input')).toBe('var(--border)')
  })

  it.each([
    'components/ui/input.tsx',
    'components/ui/textarea.tsx',
    'components/ui/native-select.tsx',
    'components/ui/select.tsx',
  ])('%s uses border-only focus and validation states without a halo', (path) => {
    const control = source(path)

    expect(control).toContain('focus-visible:border-ring')
    expect(control).toContain('aria-invalid:border-destructive')
    expect(control).not.toContain('focus-visible:ring')
    expect(control).not.toContain('aria-invalid:ring')
  })

  it('defines restrained raised and overlay shadows for semantic depth', () => {
    const stylesheet = source('app/globals.css')

    expect(stylesheet).toContain('--shadow-raised: 0 1px 2px rgb(24 24 27 / 3%);')
    expect(stylesheet).toContain('--shadow-raised-hover: 0 2px 6px rgb(24 24 27 / 4%);')
    expect(stylesheet).toContain(
      '--shadow-overlay: 0 8px 24px rgb(24 24 27 / 7%), 0 1px 3px rgb(24 24 27 / 4%);',
    )
    expect(stylesheet).toContain('--shadow-raised: 0 1px 2px rgb(0 0 0 / 12%);')
    expect(stylesheet).toContain('--shadow-raised-hover: 0 2px 6px rgb(0 0 0 / 14%);')
    expect(stylesheet).toContain(
      '--shadow-overlay: 0 8px 24px rgb(0 0 0 / 24%), 0 1px 3px rgb(0 0 0 / 16%);',
    )
  })

  it.each([
    'components/workflow/agent-drawer.tsx',
    'components/settings/project-settings.tsx',
    'components/runs/run-node-details-dialog.tsx',
    'components/ui/sheet.tsx',
    'components/ui/toast.tsx',
  ])('%s uses the shared overlay elevation instead of an arbitrary heavy shadow', (path) => {
    const component = source(path)

    expect(component).not.toContain('shadow-2xl')
    expect(component).toContain('shadow-[var(--shadow-overlay)]')
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
    'components/ui/toast.tsx',
  ])('%s respects the shared radius instead of forcing square corners', (path) => {
    expect(source(path)).not.toContain('rounded-none')
  })

  it('limits button animation to properties that communicate state', () => {
    const button = source('lib/button-variants.ts')

    expect(button).not.toContain('transition-all')
    expect(button).toContain(
      'transition-[color,background-color,border-color,box-shadow,transform]',
    )
  })

  it('renders tags with background and text color without borders', () => {
    const badge = source('components/ui/badge.tsx')
    const runFilters = source('components/runs/run-filters.tsx')
    const runStatus = source('components/runs/run-status.tsx')
    const agentTranscript = source('components/runs/agent-transcript.tsx')

    expect(badge).not.toMatch(/\bborder(?:-|\b)/)
    expect(badge).toContain("outline: 'bg-muted text-foreground")
    expect(runFilters).not.toContain('rounded-full border border-border bg-background')
    expect(runStatus).not.toContain('border-status')
    expect(agentTranscript).not.toContain('border-status-success')
  })
})
