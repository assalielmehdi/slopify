import type { Workflow } from './types.js'

const PLACEHOLDER_PATTERN = /(\\)?\{\{\s*([^{}]*?)\s*\}\}/gu
const MAX_VARIABLE_NAME_LENGTH = 128

const variableName = (value: string): string | undefined => {
  const name = value.trim()
  return name.length === 0 || name.length > MAX_VARIABLE_NAME_LENGTH ? undefined : name
}

export const getPromptVariableNames = (template: string): readonly string[] => {
  const names: string[] = []
  const seen = new Set<string>()
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    if (match[1] !== undefined) continue
    const name = variableName(match[2] ?? '')
    if (name === undefined || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return Object.freeze(names)
}

export const getWorkflowPromptVariableNames = (workflow: Workflow): readonly string[] => {
  const names: string[] = []
  const seen = new Set<string>()
  for (const node of workflow.nodes) {
    if (node.type !== 'agent') continue
    for (const name of getPromptVariableNames(node.job.prompt)) {
      if (seen.has(name)) continue
      seen.add(name)
      names.push(name)
    }
  }
  return Object.freeze(names)
}

export const findMissingPromptVariables = (
  templates: readonly string[],
  variables: Readonly<Record<string, unknown>>,
): readonly string[] => {
  const missing: string[] = []
  const seen = new Set<string>()
  for (const template of templates) {
    for (const name of getPromptVariableNames(template)) {
      if (seen.has(name)) continue
      seen.add(name)
      if (!Object.hasOwn(variables, name)) missing.push(name)
    }
  }
  return Object.freeze(missing)
}

const renderValue = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value === undefined) return ''
  return JSON.stringify(value) ?? ''
}

export const renderPromptVariables = (
  template: string,
  variables: Readonly<Record<string, unknown>>,
): string =>
  template.replaceAll(
    PLACEHOLDER_PATTERN,
    (placeholder, escaped: string | undefined, raw: string) => {
      if (escaped !== undefined) return placeholder.slice(1)
      const name = variableName(raw)
      if (name === undefined || !Object.hasOwn(variables, name)) return ''
      return renderValue(variables[name])
    },
  )
