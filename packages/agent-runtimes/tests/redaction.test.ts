import { describe, expect, it } from 'vitest'

import type { AgentNodeResult } from '../src/contract.js'
import { createEventRedactor, redactAgentNodeResult } from '../src/redaction.js'

describe('agent event redaction', () => {
  it('redacts configured values and recognizable credential forms', () => {
    const secret = 'sk-provider-secret'
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
    const redactor = createEventRedactor({ sensitiveValues: ['sk-provider-secret'] })
    const stream = redactor.createStream()

    expect(stream.push('Visible text sk-provider-')).toBe('Visible text ')
    expect(stream.push('secret remains visible afterward.')).toBe(
      '[REDACTED] remains visible afterward.',
    )
    expect(stream.finish()).toBe('')
  })

  it('withholds secret prefixes from snapshot-style tool updates', () => {
    const redactor = createEventRedactor({ sensitiveValues: ['sk-provider-secret'] })

    expect(redactor.redactSnapshot('command output: sk-provider-')).toBe('command output: ')
    expect(redactor.redactSnapshot('command output: sk-provider-secret\ndone')).toBe(
      'command output: [REDACTED]\ndone',
    )
  })

  it('redacts every string field in the typed node result without mutating it', () => {
    const secret = 'sk-provider-secret'
    const result: AgentNodeResult = {
      outcome: 'planned',
      summary: `Planned with ${secret}`,
      data: { nested: [secret, { token: secret }], [secret]: 'key is redacted', count: 2 },
      artifacts: [
        {
          type: 'EXECUTION_PLAN',
          title: `Plan ${secret}`,
          content: `Authorization: Bearer ${secret}`,
        },
      ],
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
      artifacts: [{ title: 'Plan [REDACTED]' }],
      evidence: [{ value: 'credential=[REDACTED]' }],
    })
    expect(JSON.stringify(result)).toContain(secret)
  })
})
