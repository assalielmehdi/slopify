import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')

const token = (scope: ':root' | '.dark', name: string): string => {
  const block = new RegExp(`\\${scope} \\{(?<tokens>[\\s\\S]*?)\\n\\}`).exec(stylesheet)?.groups
    ?.tokens
  const value = new RegExp(`--${name}:\\s*(?<value>#[0-9a-f]{6});`, 'i').exec(block ?? '')?.groups
    ?.value
  if (value === undefined) throw new Error(`Missing ${name} in ${scope}`)
  return value
}

const relativeLuminance = (value: string): number => {
  const channels = [value.slice(1, 3), value.slice(3, 5), value.slice(5, 7)].map((channel) => {
    const srgb = Number.parseInt(channel, 16) / 255
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0)
}

const contrastRatio = (first: string, second: string): number => {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (lighter + 0.05) / (darker + 0.05)
}

describe('focus indicator contrast', () => {
  it.each([
    [':root', 'ring', 'background'],
    [':root', 'sidebar-ring', 'sidebar'],
    ['.dark', 'ring', 'background'],
    ['.dark', 'sidebar-ring', 'sidebar'],
  ] as const)('%s %s contrasts with %s by at least 3:1', (scope, indicator, surface) => {
    expect(contrastRatio(token(scope, indicator), token(scope, surface))).toBeGreaterThanOrEqual(3)
  })
})
