import { describe, expect, it } from 'vitest'

import { displayRunId } from '@/lib/run-id'

describe('displayRunId', () => {
  it('removes only the backend run prefix', () => {
    expect(displayRunId('run-491cb622')).toBe('491cb622')
    expect(displayRunId('custom-run-491cb622')).toBe('custom-run-491cb622')
  })
})
