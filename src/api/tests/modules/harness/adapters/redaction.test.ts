import { describe, expect, it } from 'vitest'

import type { AgentNodeResult } from '../../../../src/modules/harness/adapters/contract.js'
import {
  createEventRedactor,
  redactAgentNodeResult,
} from '../../../../src/modules/harness/adapters/redaction.js'

describe('agent event redaction', () => {
  it('redacts configured values and recognizable credential forms', () => {
    const secret = 'host-secret-value'
    const privateKey = [
      '-----BEGIN PRIVATE KEY-----',
      'private-material',
      '-----END PRIVATE KEY-----',
    ].join('\n')
    const redactor = createEventRedactor({ sensitiveValues: [secret, secret] })

    const redacted = redactor.redact(
      [
        `credential=${secret}`,
        'Authorization: Bearer bearer-value',
        'api_key="assigned-value"',
        privateKey,
      ].join('\n'),
    )

    expect(redacted).toContain('credential=[REDACTED]')
    expect(redacted).toContain('Authorization: Bearer [REDACTED]')
    expect(redacted).toContain('api_key=[REDACTED]')
    expect(redacted).not.toContain(secret)
    expect(redacted).not.toContain('bearer-value')
    expect(redacted).not.toContain('assigned-value')
    expect(redacted).not.toContain('private-material')
  })

  it('withholds a configured secret split across streaming chunks', () => {
    const redactor = createEventRedactor({ sensitiveValues: ['host-secret-value'] })
    const stream = redactor.createStream()

    expect(stream.push('Visible text host-secret-')).toBe('Visible text ')
    expect(stream.push('value remains visible afterward.')).toBe(
      '[REDACTED] remains visible afterward.',
    )
    expect(stream.finish()).toBe('')
  })

  it('withholds secret prefixes from snapshot-style tool updates', () => {
    const redactor = createEventRedactor({ sensitiveValues: ['host-secret-value'] })

    expect(redactor.redactSnapshot('command output: host-secret-')).toBe('command output: ')
    expect(redactor.redactSnapshot('command output: host-secret-value\ndone')).toBe(
      'command output: [REDACTED]\ndone',
    )
  })

  it('redacts every string field in the typed node result without mutating it', () => {
    const secret = 'host-secret-value'
    const result: AgentNodeResult = {
      outcome: 'planned',
      summary: `Planned with ${secret}`,
      data: { nested: [secret, { token: secret }], [secret]: 'key is redacted', count: 2 },
      evidence: [{ kind: 'note', value: `credential=${secret}` }],
    }
    const redactor = createEventRedactor({ sensitiveValues: [secret] })

    const redacted = redactAgentNodeResult(result, redactor)

    expect(JSON.stringify(redacted)).not.toContain(secret)
    expect(redacted).toMatchObject({
      outcome: 'planned',
      summary: 'Planned with [REDACTED]',
      data: {
        nested: ['[REDACTED]', { token: '[REDACTED]' }],
        '[REDACTED]': 'key is redacted',
        count: 2,
      },
      evidence: [{ value: 'credential=[REDACTED]' }],
    })
    expect(JSON.stringify(result)).toContain(secret)
  })
})
