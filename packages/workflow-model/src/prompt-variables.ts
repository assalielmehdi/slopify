const PLACEHOLDER_PATTERN = /(\\)?\{\{\s*([^{}]*?)\s*\}\}/gu
const MAX_VARIABLE_NAME_LENGTH = 128

const variableName = (value: string): string | undefined => {
  const name = value.trim()
  return name.length === 0 || name.length > MAX_VARIABLE_NAME_LENGTH ? undefined : name
}

const renderValue = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value === undefined) return ''
  return JSON.stringify(value) ?? ''
}

export const renderPromptVariables = (
  template: string,
  configuredNames: readonly string[],
  variables: Readonly<Record<string, unknown>>,
): string => {
  const configured = new Set(configuredNames)
  return template.replaceAll(
    PLACEHOLDER_PATTERN,
    (placeholder, escaped: string | undefined, raw: string) => {
      if (escaped !== undefined) return placeholder.slice(1)
      const name = variableName(raw)
      if (name === undefined || !configured.has(name) || !Object.hasOwn(variables, name)) {
        return placeholder
      }
      return renderValue(variables[name])
    },
  )
}
