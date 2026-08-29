import { AgentNodeResultSchema, type AgentNodeResult } from './contract.js'

const REDACTED = '[REDACTED]'
const PRIVATE_KEY =
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu
const AUTHORIZATION = /(\bAuthorization\s*:\s*(?:Bearer|Basic)\s+)[^\s]+/giu
const SECRET_ASSIGNMENT =
  /(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|credential)\b\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,\n]+)/giu

export interface RedactionStream {
  push(chunk: string): string
  finish(): string
}

export interface EventRedactor {
  redact(content: string): string
  redactSnapshot(content: string): string
  createStream(): RedactionStream
}

export interface CreateEventRedactorOptions {
  readonly sensitiveValues: readonly string[]
}

const possibleSecretPrefixLength = (
  content: string,
  sensitiveValues: readonly string[],
): number => {
  let longest = 0
  for (const value of sensitiveValues) {
    const maximum = Math.min(value.length - 1, content.length)
    for (let length = maximum; length > longest; length -= 1) {
      if (value.startsWith(content.slice(-length))) {
        longest = length
        break
      }
    }
  }
  return longest
}

export const createEventRedactor = (options: CreateEventRedactorOptions): EventRedactor => {
  const sensitiveValues = [
    ...new Set(options.sensitiveValues.filter((value) => value.length > 0)),
  ].sort((left, right) => right.length - left.length)
  const redact = (content: string): string => {
    let redacted = content
    for (const value of sensitiveValues) redacted = redacted.replaceAll(value, REDACTED)
    return redacted
      .replace(PRIVATE_KEY, REDACTED)
      .replace(AUTHORIZATION, `$1${REDACTED}`)
      .replace(SECRET_ASSIGNMENT, `$1${REDACTED}`)
  }

  return {
    redact,
    redactSnapshot(content) {
      const redacted = redact(content)
      const withheldLength = possibleSecretPrefixLength(redacted, sensitiveValues)
      return withheldLength === 0 ? redacted : redacted.slice(0, -withheldLength)
    },
    createStream() {
      let pending = ''
      return {
        push(chunk) {
          const redacted = redact(`${pending}${chunk}`)
          const withheldLength = possibleSecretPrefixLength(redacted, sensitiveValues)
          if (withheldLength === 0) {
            pending = ''
            return redacted
          }
          pending = redacted.slice(-withheldLength)
          return redacted.slice(0, -withheldLength)
        },
        finish() {
          pending = ''
          return ''
        },
      }
    },
  }
}

const redactUnknown = (value: unknown, redactor: EventRedactor): unknown => {
  if (typeof value === 'string') return redactor.redact(value)
  if (Array.isArray(value)) return value.map((item) => redactUnknown(item, redactor))
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      redactor.redact(key),
      redactUnknown(item, redactor),
    ]),
  )
}

export const redactAgentNodeResult = (
  result: AgentNodeResult,
  redactor: EventRedactor,
): AgentNodeResult =>
  AgentNodeResultSchema.parse({
    ...result,
    summary: redactor.redact(result.summary),
    data: redactUnknown(result.data, redactor),
    evidence: result.evidence.map((evidence) => ({
      ...evidence,
      value: redactor.redact(evidence.value),
    })),
  })
