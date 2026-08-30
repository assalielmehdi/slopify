import { describe, expect, it } from 'vitest'

import { formatDuration } from '../lib/run-format'

describe('formatDuration', () => {
  it.each([
    [12_500, '12.5 s'],
    [65_000, '1m 5s'],
    [1_800_000, '30m'],
    [10_800_000, '3h'],
    [3_661_000, '1h 1m 1s'],
  ])('formats %i milliseconds as %s', (durationMs, expected) => {
    expect(formatDuration(durationMs)).toBe(expected)
  })
})
