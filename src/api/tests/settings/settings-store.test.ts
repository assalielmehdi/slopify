import { describe, expect, it } from 'vitest'

import { SettingsRecordSchema } from '../../src/index.js'

const record = {
  schemaVersion: 1,
  appearance: { theme: 'dark' },
  git: {
    connections: [
      {
        provider: 'GITLAB',
        accountUsername: 'operator',
        credentialReference: 'credential://gitlab',
        connectedAt: '2026-08-25T10:00:00.000Z',
        updatedAt: '2026-08-25T10:00:00.000Z',
      },
    ],
  },
}

describe('settings store contract', () => {
  it('validates versioned settings with internal credential references', () => {
    expect(SettingsRecordSchema.parse(record)).toEqual(record)
  })

  it('cannot store PAT bytes alongside Git metadata', () => {
    expect(
      SettingsRecordSchema.safeParse({
        ...record,
        git: {
          connections: [{ ...record.git.connections[0], token: 'glpat-secret' }],
        },
      }).success,
    ).toBe(false)
  })
})
