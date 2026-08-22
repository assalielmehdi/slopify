import { fork } from 'node:child_process'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai'

import {
  AgentExecutionEventSchema,
  AgentExecutionInputSchema,
  type AgentCancelResult,
  type AgentExecutionEvent,
  type AgentExecutionId,
  type AgentExecutionInput,
  type AgentExecutor,
} from './contract.js'
import type { LoadedResourceBundle } from './resource-loader.js'

export interface WorkerCredentialStore {
  read(connectionId: string): Promise<Credential | undefined>
  modify(
    connectionId: string,
    update: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined>
}

export interface BunWorkerExecutionContext {
  readonly outputSchemaRef: string
  readonly inferenceConnectionId: string
  readonly glabHostPath: string
  readonly resourceBundle: LoadedResourceBundle
  readonly skills: readonly Readonly<{
    skillId: string
    name: string
    description: string
    hostPath: string
  }>[]
  readonly connectors: readonly Readonly<{
    connectionId: string
    type: 'gitlab' | 'clickup'
    authority: string
    allowedHosts: readonly string[]
  }>[]
}

export interface BunWorkerProcess {
  readonly pid: number
  readonly exited: Promise<number>
  send(message: unknown): void
  kill(signal?: 'SIGTERM' | 'SIGKILL'): void
  disconnect(): void
}

export interface BunWorkerSpawnInput {
  readonly scriptPath: string
  readonly cwd: string
  readonly environment: Readonly<Record<string, string>>
  readonly onMessage: (message: unknown) => void
  readonly onExit: (exitCode: number) => void
}

export interface BunWorkerSpawner {
  spawn(input: BunWorkerSpawnInput): BunWorkerProcess
}

export const getBunAgentWorkerScriptPath = (): string => {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url))
  return join(
    basename(moduleDirectory) === 'src' ? join(moduleDirectory, '..', 'dist') : moduleDirectory,
    'bun-agent-worker.js',
  )
}

const createDefaultSpawner = (): BunWorkerSpawner => ({
  spawn(input) {
    // Gondolin supports Node and its TLS MITM bridge resets guest HTTPS under Bun 1.4.
    // Keep the Bun coordinator as the credential broker and isolate Gondolin in Node.
    const child = fork(input.scriptPath, [], {
      cwd: input.cwd,
      env: input.environment,
      serialization: 'json',
      execPath: 'node',
      execArgv: [],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    child.on('message', input.onMessage)
    const exited = new Promise<number>((resolve) => {
      child.once('exit', (exitCode) => {
        const code = exitCode ?? 1
        input.onExit(code)
        resolve(code)
      })
    })
    return {
      pid: child.pid ?? 0,
      exited,
      send: (message) => {
        child.send(message as Parameters<typeof child.send>[0])
      },
      kill: (signal) => {
        child.kill(signal)
      },
      disconnect: () => {
        if (child.connected) child.disconnect()
      },
    }
  },
})

class AsyncEventQueue {
  readonly #events: AgentExecutionEvent[] = []
  #closed = false
  #waiter: ((result: IteratorResult<AgentExecutionEvent>) => void) | undefined

  push(event: AgentExecutionEvent): void {
    if (this.#closed) return
    const waiter = this.#waiter
    if (waiter === undefined) this.#events.push(event)
    else {
      this.#waiter = undefined
      waiter({ value: event, done: false })
    }
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#waiter?.({ value: undefined, done: true })
    this.#waiter = undefined
  }

  next(): Promise<IteratorResult<AgentExecutionEvent>> {
    const event = this.#events.shift()
    if (event !== undefined) return Promise.resolve({ value: event, done: false })
    if (this.#closed) return Promise.resolve({ value: undefined, done: true })
    return new Promise((resolve) => {
      this.#waiter = resolve
    })
  }
}

interface ActiveWorker {
  readonly input: AgentExecutionInput
  readonly context: BunWorkerExecutionContext
  readonly directory: string
  readonly process: BunWorkerProcess
  readonly events: AsyncEventQueue
  readonly secrets: Set<string>
  readonly allowedConnectionIds: ReadonlySet<string>
  readonly pendingModifications: Map<string, (credential: Credential | undefined) => void>
  complete: boolean
  exited: boolean
  cancellationAcknowledgement: Promise<boolean>
  acknowledgeCancellation(value: boolean): void
}

const credentialSecrets = (credential: Credential | undefined): readonly string[] => {
  if (credential === undefined) return []
  if (credential.type === 'api_key') return credential.key === undefined ? [] : [credential.key]
  return [credential.access, credential.refresh]
}

const sanitisedEnvironment = (directory: string): Readonly<Record<string, string>> => ({
  HOME: directory,
  TMPDIR: directory,
  PATH: process.env.PATH ?? '/usr/bin:/bin',
  NO_COLOR: '1',
})

const waitFor = async <Value>(
  promise: Promise<Value>,
  milliseconds: number,
): Promise<Value | undefined> => {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => resolve(undefined), milliseconds)
      }),
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

const failureEvent = (input: AgentExecutionInput): AgentExecutionEvent =>
  AgentExecutionEventSchema.parse({
    executionId: input.executionId,
    runId: input.runId,
    nodeId: input.nodeId,
    timestamp: new Date().toISOString(),
    type: 'AGENT_FAILED',
    data: {
      code: 'AGENT_WORKER_FAILED',
      message: 'Agent worker failed before producing a result',
      durationMs: 0,
    },
  })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export const createBunChildAgentExecutor = (
  options: Readonly<{
    childScriptPath: string
    credentials: WorkerCredentialStore
    resolveContext(input: AgentExecutionInput): Promise<BunWorkerExecutionContext>
    spawner?: BunWorkerSpawner
    createExecutionDirectory?: (executionId: AgentExecutionId) => Promise<string>
    cancellationGraceMs?: number
  }>,
): AgentExecutor => {
  const spawner = options.spawner ?? createDefaultSpawner()
  const cancellationGraceMs = options.cancellationGraceMs ?? 5_000
  const active = new Map<AgentExecutionId, ActiveWorker>()
  const createExecutionDirectory =
    options.createExecutionDirectory ??
    (async () => {
      const directory = await mkdtemp(join(tmpdir(), 'slopify-agent-'))
      await chmod(directory, 0o700)
      return directory
    })

  const sendCredentialError = (worker: ActiveWorker, requestId: string, code: string) => {
    worker.process.send({ version: 1, type: 'CREDENTIAL_ERROR', requestId, code })
  }

  const handleMessage = async (worker: ActiveWorker, message: unknown): Promise<void> => {
    if (!isRecord(message) || message.version !== 1 || typeof message.type !== 'string') return
    if (message.type === 'EVENT') {
      const parsed = AgentExecutionEventSchema.safeParse(message.event)
      if (!parsed.success) return
      const serialized = JSON.stringify(parsed.data)
      if ([...worker.secrets].some((secret) => secret.length > 0 && serialized.includes(secret))) {
        worker.events.push(failureEvent(worker.input))
        worker.process.kill('SIGKILL')
        return
      }
      worker.events.push(parsed.data)
      return
    }
    if (message.type === 'COMPLETE') {
      worker.complete = true
      return
    }
    if (message.type === 'CANCELLED') {
      worker.acknowledgeCancellation(message.cleanupConfirmed === true)
      return
    }
    if (
      (message.type === 'CREDENTIAL_READ' || message.type === 'CREDENTIAL_MODIFY_BEGIN') &&
      typeof message.requestId === 'string' &&
      typeof message.connectionId === 'string'
    ) {
      if (!worker.allowedConnectionIds.has(message.connectionId)) {
        sendCredentialError(worker, message.requestId, 'CREDENTIAL_NOT_GRANTED')
        return
      }
      if (message.type === 'CREDENTIAL_READ') {
        try {
          const credential = await options.credentials.read(message.connectionId)
          for (const secret of credentialSecrets(credential)) worker.secrets.add(secret)
          worker.process.send({
            version: 1,
            type: 'CREDENTIAL_VALUE',
            requestId: message.requestId,
            credential,
          })
        } catch {
          sendCredentialError(worker, message.requestId, 'CREDENTIAL_READ_FAILED')
        }
        return
      }
      void options.credentials
        .modify(message.connectionId, async (current) => {
          for (const secret of credentialSecrets(current)) worker.secrets.add(secret)
          const next = await new Promise<Credential | undefined>((resolve) => {
            worker.pendingModifications.set(message.requestId as string, resolve)
            worker.process.send({
              version: 1,
              type: 'CREDENTIAL_MODIFY_CURRENT',
              requestId: message.requestId,
              credential: current,
            })
          })
          for (const secret of credentialSecrets(next)) worker.secrets.add(secret)
          return next
        })
        .then(
          (credential) => {
            worker.process.send({
              version: 1,
              type: 'CREDENTIAL_MODIFY_RESULT',
              requestId: message.requestId,
              credential,
            })
          },
          () =>
            sendCredentialError(worker, message.requestId as string, 'CREDENTIAL_MODIFY_FAILED'),
        )
      return
    }
    if (message.type === 'CREDENTIAL_MODIFY_COMMIT' && typeof message.requestId === 'string') {
      const resolve = worker.pendingModifications.get(message.requestId)
      if (resolve === undefined) return
      worker.pendingModifications.delete(message.requestId)
      resolve(message.credential as Credential | undefined)
    }
  }

  const executor: AgentExecutor = {
    async *execute(unparsedInput) {
      const input = AgentExecutionInputSchema.parse(unparsedInput)
      if (active.has(input.executionId)) {
        yield failureEvent(input)
        return
      }
      let directory: string | undefined
      let worker: ActiveWorker | undefined
      try {
        const context = await options.resolveContext(input)
        directory = await createExecutionDirectory(input.executionId)
        const events = new AsyncEventQueue()
        let acknowledgeCancellation: (value: boolean) => void = () => undefined
        const cancellationAcknowledgement = new Promise<boolean>((resolve) => {
          acknowledgeCancellation = resolve
        })
        const onExit = () => {
          const current = worker
          if (current === undefined || current.exited) return
          current.exited = true
          if (!current.complete) current.events.push(failureEvent(input))
          current.events.close()
          active.delete(input.executionId)
          current.process.disconnect()
          void rm(current.directory, { recursive: true, force: true })
        }
        const process = spawner.spawn({
          scriptPath: options.childScriptPath,
          cwd: directory,
          environment: sanitisedEnvironment(directory),
          onMessage: (message) => {
            if (worker !== undefined) void handleMessage(worker, message)
          },
          onExit,
        })
        worker = {
          input,
          context,
          directory,
          process,
          events,
          secrets: new Set(),
          allowedConnectionIds: new Set([
            context.inferenceConnectionId,
            ...context.connectors.map(({ connectionId }) => connectionId),
          ]),
          pendingModifications: new Map(),
          complete: false,
          exited: false,
          cancellationAcknowledgement,
          acknowledgeCancellation,
        }
        active.set(input.executionId, worker)
        void process.exited.then(onExit, onExit)
        process.send({ version: 1, type: 'START', input, context })

        while (true) {
          const next = await events.next()
          if (next.done) break
          yield next.value
        }
      } catch {
        yield failureEvent(input)
      } finally {
        const current = active.get(input.executionId)
        if (current !== undefined && !current.exited) await executor.cancel(input.executionId)
        if (worker === undefined && directory !== undefined)
          await rm(directory, { recursive: true, force: true })
      }
    },

    async cancel(executionId): Promise<AgentCancelResult> {
      const worker = active.get(executionId)
      if (worker === undefined) return { status: 'unconfirmed' }
      worker.process.send({
        version: 1,
        type: 'CANCEL',
        reason: 'Cancellation requested',
      })
      const confirmed = await waitFor(worker.cancellationAcknowledgement, cancellationGraceMs)
      if (confirmed !== true) {
        worker.process.kill('SIGTERM')
        return { status: 'unconfirmed' }
      }
      const exited = await waitFor(worker.process.exited, cancellationGraceMs)
      if (exited === undefined) {
        worker.process.kill('SIGKILL')
        return { status: 'unconfirmed' }
      }
      return { status: 'cancelled' }
    },
  }

  return executor
}

export const createIpcPiCredentialStore = (
  options: Readonly<{
    connectionId: string
    request(
      message: Readonly<Record<string, unknown>>,
      expectedType: string,
    ): Promise<Readonly<Record<string, unknown>>>
  }>,
): CredentialStore => ({
  async read() {
    const response = await options.request(
      { type: 'CREDENTIAL_READ', connectionId: options.connectionId },
      'CREDENTIAL_VALUE',
    )
    return response.credential as Credential | undefined
  },
  async list() {
    const credential = await this.read(options.connectionId)
    return credential === undefined
      ? []
      : ([{ providerId: options.connectionId, type: credential.type }] satisfies CredentialInfo[])
  },
  async modify(_providerId, update) {
    const current = await options.request(
      { type: 'CREDENTIAL_MODIFY_BEGIN', connectionId: options.connectionId },
      'CREDENTIAL_MODIFY_CURRENT',
    )
    const next = await update(current.credential as Credential | undefined)
    const result = await options.request(
      {
        type: 'CREDENTIAL_MODIFY_COMMIT',
        requestId: current.requestId,
        credential: next,
      },
      'CREDENTIAL_MODIFY_RESULT',
    )
    return result.credential as Credential | undefined
  },
  async delete() {
    throw new Error('Worker credentials cannot be deleted')
  },
})
