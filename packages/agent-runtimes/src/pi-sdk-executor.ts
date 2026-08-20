import { z } from 'zod'

import {
  AgentExecutionEventSchema,
  AgentExecutionInputSchema,
  type AgentCancelResult,
  type AgentExecutionEvent,
  type AgentExecutionId,
  type AgentExecutionInput,
  type AgentExecutor,
} from './contract.js'
import {
  createPiEventNormalizer,
  type NormalizedPiEvent,
  type PiEventNormalizer,
} from './event-normalizer.js'
import { createEventRedactor, redactAgentNodeResult } from './redaction.js'
import type { LoadedResourceBundle } from './resource-loader.js'
import type { CreatePiSessionInput, PiSession, PiSessionFactory } from './session-factory.js'

export interface AgentExecutionContext {
  readonly outputSchema: z.ZodType<unknown>
  readonly resourceBundle: LoadedResourceBundle
  readonly sandbox?: CreatePiSessionInput['sandbox']
  readonly cleanup?: () => Promise<void>
}

export interface CreatePiSdkAgentExecutorOptions {
  readonly sessionFactory: PiSessionFactory
  readonly resolveContext: (input: AgentExecutionInput) => Promise<AgentExecutionContext>
  readonly sensitiveValues: readonly string[]
  readonly now?: () => number
}

interface ActiveExecution {
  readonly session: PiSession
  readonly cancellation: Promise<{ readonly kind: 'cancelled' }>
  readonly resolveCancellation: () => void
  unsubscribe: (() => void) | undefined
  cancelRequested: boolean
  released: boolean
  readonly cleanup?: () => Promise<void>
  stopPromise: Promise<boolean> | undefined
}

type PromptOutcome =
  | { readonly kind: 'completed' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'timed-out' }

type ExecutionLoopOutcome = PromptOutcome | { readonly kind: 'observations' }

class ObservationQueue {
  readonly #items: NormalizedPiEvent[] = []
  #signal: Promise<{ readonly kind: 'observations' }>
  #resolveSignal: () => void = () => undefined

  constructor() {
    this.#signal = this.#createSignal()
  }

  #createSignal(): Promise<{ readonly kind: 'observations' }> {
    return new Promise((resolve) => {
      this.#resolveSignal = () => resolve({ kind: 'observations' })
    })
  }

  push(events: readonly NormalizedPiEvent[]): void {
    if (events.length === 0) return
    const wasEmpty = this.#items.length === 0
    this.#items.push(...events)
    if (wasEmpty) this.#resolveSignal()
  }

  shift(): NormalizedPiEvent | undefined {
    const event = this.#items.shift()
    if (this.#items.length === 0) this.#signal = this.#createSignal()
    return event
  }

  wait(): Promise<{ readonly kind: 'observations' }> {
    return this.#items.length === 0 ? this.#signal : Promise.resolve({ kind: 'observations' })
  }
}

const terminalMessages = {
  AGENT_SESSION_FAILED: 'Agent session failed',
  AGENT_STOP_UNCONFIRMED: 'Agent session stop could not be confirmed',
  AGENT_TIMEOUT: 'Agent execution timed out',
} as const

const createActiveExecution = (
  session: PiSession,
  cleanup?: () => Promise<void>,
): ActiveExecution => {
  let resolveCancellation: () => void = () => undefined
  const cancellation = new Promise<{ readonly kind: 'cancelled' }>((resolve) => {
    resolveCancellation = () => resolve({ kind: 'cancelled' })
  })
  return {
    session,
    cancellation,
    resolveCancellation,
    unsubscribe: undefined,
    cancelRequested: false,
    released: false,
    ...(cleanup === undefined ? {} : { cleanup }),
    stopPromise: undefined,
  }
}

const release = async (active: ActiveExecution): Promise<void> => {
  if (active.released) return
  active.released = true
  active.unsubscribe?.()
  active.unsubscribe = undefined
  active.session.dispose()
  await active.cleanup?.()
}

const stop = (active: ActiveExecution): Promise<boolean> => {
  if (active.stopPromise !== undefined) return active.stopPromise
  active.stopPromise = (async () => {
    let confirmed = true
    try {
      await active.session.abort()
    } catch {
      confirmed = false
    }
    try {
      await active.session.waitForIdle()
    } catch {
      confirmed = false
    }
    try {
      if (!active.session.isIdle()) confirmed = false
    } catch {
      confirmed = false
    }
    await release(active)
    return confirmed
  })()
  return active.stopPromise
}

export const createPiSdkAgentExecutor = (
  options: CreatePiSdkAgentExecutorOptions,
): AgentExecutor => {
  const activeExecutions = new Map<AgentExecutionId, ActiveExecution>()
  const now = options.now ?? Date.now
  const redactor = createEventRedactor({ sensitiveValues: options.sensitiveValues })

  const event = (
    input: AgentExecutionInput,
    type: AgentExecutionEvent['type'],
    data: unknown,
  ): AgentExecutionEvent =>
    AgentExecutionEventSchema.parse({
      executionId: input.executionId,
      runId: input.runId,
      nodeId: input.nodeId,
      timestamp: new Date(now()).toISOString(),
      type,
      data,
    })

  const executor: AgentExecutor = {
    async *execute(unparsedInput) {
      const input = AgentExecutionInputSchema.parse(unparsedInput)
      const startedAt = now()
      const durationMs = () => Math.max(0, now() - startedAt)
      let active: ActiveExecution | undefined
      let contextCleanup: (() => Promise<void>) | undefined
      let normalizer: PiEventNormalizer | undefined
      let timeout: ReturnType<typeof setTimeout> | undefined

      yield event(input, 'AGENT_STARTED', {})

      try {
        if (activeExecutions.has(input.executionId)) {
          yield event(input, 'AGENT_FAILED', {
            code: 'AGENT_SESSION_FAILED',
            message: terminalMessages.AGENT_SESSION_FAILED,
            durationMs: durationMs(),
          })
          return
        }

        const context = await options.resolveContext(input)
        contextCleanup = context.cleanup
        const session = await options.sessionFactory.create({
          input,
          outputSchema: context.outputSchema,
          resourceBundle: context.resourceBundle,
          ...(context.sandbox === undefined ? {} : { sandbox: context.sandbox }),
        })
        active = createActiveExecution(session, context.cleanup)
        normalizer = createPiEventNormalizer({ redactor })
        const observations = new ObservationQueue()
        active.unsubscribe = session.subscribe((sdkEvent) => {
          observations.push(normalizer?.normalize(sdkEvent) ?? [])
        })
        activeExecutions.set(input.executionId, active)

        yield event(input, 'AGENT_SESSION_IDENTIFIED', { sessionId: session.sessionId })

        const timeoutOutcome = new Promise<PromptOutcome>((resolve) => {
          timeout = setTimeout(() => resolve({ kind: 'timed-out' }), input.timeoutSeconds * 1_000)
        })
        const promptOutcome: Promise<PromptOutcome> = active.cancelRequested
          ? Promise.resolve({ kind: 'cancelled' })
          : session.prompt().then(
              () => ({ kind: 'completed' }),
              () => ({ kind: 'failed' }),
            )
        let outcome: PromptOutcome | undefined
        while (outcome === undefined) {
          const observation = observations.shift()
          if (observation !== undefined) {
            yield event(input, observation.type, observation.data)
            continue
          }
          const next: ExecutionLoopOutcome = await Promise.race([
            promptOutcome,
            timeoutOutcome,
            active.cancellation,
            observations.wait(),
          ])
          if (next.kind !== 'observations') outcome = next
        }
        const stopConfirmed =
          outcome.kind === 'cancelled' || outcome.kind === 'timed-out'
            ? await stop(active)
            : undefined
        normalizer.finish()
        let remaining = observations.shift()
        while (remaining !== undefined) {
          yield event(input, remaining.type, remaining.data)
          remaining = observations.shift()
        }

        if (outcome.kind === 'cancelled') {
          yield stopConfirmed === true
            ? event(input, 'AGENT_CANCELLED', {
                reason: 'Cancellation requested',
                durationMs: durationMs(),
              })
            : event(input, 'AGENT_FAILED', {
                code: 'AGENT_STOP_UNCONFIRMED',
                message: terminalMessages.AGENT_STOP_UNCONFIRMED,
                durationMs: durationMs(),
              })
          return
        }

        if (outcome.kind === 'timed-out') {
          yield event(input, 'AGENT_FAILED', {
            code: stopConfirmed === true ? 'AGENT_TIMEOUT' : 'AGENT_STOP_UNCONFIRMED',
            message:
              stopConfirmed === true
                ? terminalMessages.AGENT_TIMEOUT
                : terminalMessages.AGENT_STOP_UNCONFIRMED,
            durationMs: durationMs(),
          })
          return
        }

        if (outcome.kind === 'failed') {
          yield event(input, 'AGENT_FAILED', {
            code: 'AGENT_SESSION_FAILED',
            message: terminalMessages.AGENT_SESSION_FAILED,
            durationMs: durationMs(),
          })
          return
        }

        yield event(input, 'AGENT_RESULT', {
          result: redactAgentNodeResult(session.finish(), redactor),
          usage: session.getUsage(),
          durationMs: durationMs(),
        })
      } catch {
        if (active?.cancelRequested === true) {
          const confirmed = await stop(active)
          yield confirmed
            ? event(input, 'AGENT_CANCELLED', {
                reason: 'Cancellation requested',
                durationMs: durationMs(),
              })
            : event(input, 'AGENT_FAILED', {
                code: 'AGENT_STOP_UNCONFIRMED',
                message: terminalMessages.AGENT_STOP_UNCONFIRMED,
                durationMs: durationMs(),
              })
        } else {
          yield event(input, 'AGENT_FAILED', {
            code: 'AGENT_SESSION_FAILED',
            message: terminalMessages.AGENT_SESSION_FAILED,
            durationMs: durationMs(),
          })
        }
      } finally {
        normalizer?.finish()
        if (timeout !== undefined) clearTimeout(timeout)
        if (active !== undefined) {
          await release(active)
          if (activeExecutions.get(input.executionId) === active) {
            activeExecutions.delete(input.executionId)
          }
        } else {
          await contextCleanup?.()
        }
      }
    },

    async cancel(executionId): Promise<AgentCancelResult> {
      const active = activeExecutions.get(executionId)
      if (active === undefined) return { status: 'unconfirmed' }
      active.cancelRequested = true
      active.resolveCancellation()
      return (await stop(active)) ? { status: 'cancelled' } : { status: 'unconfirmed' }
    },
  }

  return executor
}
