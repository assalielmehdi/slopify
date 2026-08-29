import { HarnessIdSchema, type AgentExecutor, type HarnessId } from '@slopify/shared'

import {
  createHarnessCatalog,
  type HarnessCatalog,
  type HarnessInspector,
} from './harness-catalog.js'

export interface HarnessAdapter {
  readonly inspector: HarnessInspector
  readonly executor: AgentExecutor
}

export interface HarnessService extends HarnessCatalog {
  resolveExecutor(harnessId: string): AgentExecutor | undefined
}

export const createHarnessService = (options: {
  readonly adapters: readonly HarnessAdapter[]
  readonly cacheTtlMs?: number
  readonly now?: () => number
}): HarnessService => {
  const executors = new Map<HarnessId, AgentExecutor>()

  for (const adapter of options.adapters) {
    const harnessId = HarnessIdSchema.parse(adapter.inspector.harnessId)
    if (executors.has(harnessId)) throw new TypeError(`Duplicate harness adapter: ${harnessId}`)
    executors.set(harnessId, adapter.executor)
  }

  const catalog = createHarnessCatalog({
    inspectors: options.adapters.map(({ inspector }) => inspector),
    ...(options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
    ...(options.now === undefined ? {} : { now: options.now }),
  })

  return {
    list: () => catalog.list(),
    get: (harnessId, readOptions) => catalog.get(harnessId, readOptions),
    requireAvailable: (harnessId, modelId, thinkingLevel, readOptions) =>
      catalog.requireAvailable(harnessId, modelId, thinkingLevel, readOptions),
    resolveExecutor: (harnessId) => {
      const parsed = HarnessIdSchema.safeParse(harnessId)
      return parsed.success ? executors.get(parsed.data) : undefined
    },
  }
}
