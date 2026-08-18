const REDACTED = '[REDACTED]'
const PRIVATE_KEY =
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu
const AUTHORIZATION = /(\bAuthorization\s*:\s*(?:Bearer|Basic)\s+)[^\s]+/giu
const SECRET_ASSIGNMENT =
  /(\b(?:api[_-]?key|access[_-]?token|token|password|secret|credential)\b\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,\n]+)/giu
const HIDDEN_REASONING = /<\/?(?:analysis|thinking|reasoning)>/iu

export const containsHiddenReasoning = (content: string): boolean => HIDDEN_REASONING.test(content)

export const redactArtifactContent = (
  content: string,
  sensitiveValues: readonly string[],
): string => {
  let redacted = content
  const values = [...new Set(sensitiveValues)].sort((left, right) => right.length - left.length)
  for (const value of values) redacted = redacted.replaceAll(value, REDACTED)
  return redacted
    .replace(PRIVATE_KEY, REDACTED)
    .replace(AUTHORIZATION, `$1${REDACTED}`)
    .replace(SECRET_ASSIGNMENT, `$1${REDACTED}`)
}
