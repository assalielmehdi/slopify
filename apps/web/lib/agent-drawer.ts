import type { HarnessDescriptor } from '@slopify/contracts'
import type { AgentHarnessConfiguration, AgentNode } from '@slopify/workflow-model'

export interface AgentFormValue {
  readonly id: string
  readonly name: string
  readonly prompt: string
  readonly harness: AgentHarnessConfiguration
}

export type AgentDrawerMode =
  Readonly<{ kind: 'create' }> | Readonly<{ kind: 'edit'; agent: AgentNode }>

export interface AgentDrawerProps {
  readonly mode: AgentDrawerMode
  readonly existingNodeIds: ReadonlySet<string>
  readonly harnesses: readonly HarnessDescriptor[]
  readonly harnessError?: string | undefined
  readonly saveError?: string | undefined
  readonly saving?: boolean | undefined
  readonly onDelete: () => Promise<boolean>
  readonly onClose: () => void
  readonly onSubmit: (value: AgentFormValue) => Promise<boolean>
}

const slugify = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || 'agent'

export const createAgentId = (name: string, existingNodeIds: ReadonlySet<string>): string => {
  const base = slugify(name)
  if (!existingNodeIds.has(base)) return base
  let suffix = 2
  while (existingNodeIds.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}
