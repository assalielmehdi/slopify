import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')

const token = (scope: ':root' | '.dark', name: string): string => {
  const block = new RegExp(`\\${scope} \\{(?<tokens>[\\s\\S]*?)\\n\\}`).exec(stylesheet)?.groups
    ?.tokens
  const value = new RegExp(`--${name}:\\s*(?<value>oklch\\([^;]+\\));`).exec(block ?? '')?.groups
    ?.value
  if (value === undefined) throw new Error(`Missing ${name} in ${scope}`)
  return value
}

const relativeLuminance = (value: string): number => {
  const match = /oklch\((?<lightness>[\d.]+)\s+(?<chroma>[\d.]+)\s+(?<hue>[\d.]+)\)/.exec(value)
  if (match?.groups === undefined) throw new Error(`Unsupported color ${value}`)

  const lightness = Number(match.groups.lightness)
  const chroma = Number(match.groups.chroma)
  const hue = (Number(match.groups.hue) * Math.PI) / 180
  const a = chroma * Math.cos(hue)
  const b = chroma * Math.sin(hue)
  const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b
  const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b
  const sPrime = lightness - 0.0894841775 * a - 1.291485548 * b
  const l = lPrime ** 3
  const m = mPrime ** 3
  const s = sPrime ** 3
  const clamp = (channel: number) => Math.min(1, Math.max(0, channel))
  const red = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
  const green = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
  const blue = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
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
