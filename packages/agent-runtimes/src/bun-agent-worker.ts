import type { Credential } from '@earendil-works/pi-ai'
import { z } from 'zod'

import {
  createGondolinPiSdkAgentExecutor,
  type GondolinPiExecutionContext,
} from './gondolin-pi-executor.js'
import { createGondolinAgentSandboxFactory } from './gondolin-sandbox.js'
import { createIpcPiCredentialStore } from './bun-child-agent-executor.js'
import { AgentExecutionInputSchema, type AgentExecutor } from './contract.js'
import type { LoadedResourceBundle } from './resource-loader.js'
import { createPiSessionFactory } from './session-factory.js'

const message = (value: Readonly<Record<string, unknown>>): void => {
  process.send?.({ version: 1, ...value })
}

interface PendingRequest {
  readonly expectedType: string
  readonly resolve: (message: Readonly<Record<string, unknown>>) => void
  readonly reject: () => void
}

const pending = new Map<string, PendingRequest>()
const request = (
  outbound: Readonly<Record<string, unknown>>,
  expectedType: string,
): Promise<Readonly<Record<string, unknown>>> => {
  const requestId =
    typeof outbound.requestId === 'string'
      ? outbound.requestId
      : `credential-${crypto.randomUUID()}`
  return new Promise((resolve, reject) => {
    pending.set(requestId, { expectedType, resolve, reject })
    message({ ...outbound, requestId })
  })
}

const secretValues = (credential: Credential | undefined): readonly string[] => {
  if (credential === undefined) return []
  if (credential.type === 'api_key') return credential.key === undefined ? [] : [credential.key]
  return [credential.access, credential.refresh]
}

interface StartContext {
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

const parseContext = (value: unknown): StartContext =>
  z
    .strictObject({
      outputSchemaRef: z.string().trim().min(1).max(512),
      inferenceConnectionId: z.string().trim().min(1).max(128),
      glabHostPath: z.string().trim().min(1).max(4_096),
      resourceBundle: z.custom<LoadedResourceBundle>(
        (candidate) => candidate !== null && typeof candidate === 'object',
      ),
      skills: z.array(
        z.strictObject({
          skillId: z.string().trim().min(1).max(128),
          name: z.string().trim().min(1).max(128),
          description: z.string().trim().min(1).max(2_048),
          hostPath: z.string().trim().min(1).max(4_096),
        }),
      ),
      connectors: z.array(
        z.strictObject({
          connectionId: z.string().trim().min(1).max(128),
          type: z.enum(['gitlab', 'clickup']),
          authority: z.string().trim().min(1).max(2_048),
          allowedHosts: z.array(z.string().trim().min(1).max(512)).min(1).max(8),
        }),
      ),
    })
    .parse(value)

let executor: AgentExecutor | undefined
let executionId: ReturnType<typeof AgentExecutionInputSchema.parse>['executionId'] | undefined
let started = false

const run = async (unparsedInput: unknown, unparsedContext: unknown): Promise<void> => {
  if (started) return
  started = true
  const input = AgentExecutionInputSchema.parse(unparsedInput)
  const context = parseContext(unparsedContext)
  executionId = input.executionId
  const inferenceCredentials = createIpcPiCredentialStore({
    connectionId: context.inferenceConnectionId,
    request,
  })
  const inferenceCredential = await inferenceCredentials.read(input.provider)
  const connectorCredentials = await Promise.all(
    context.connectors.map(async (connector) => ({
      connector,
      credential: (
        await request(
          { type: 'CREDENTIAL_READ', connectionId: connector.connectionId },
          'CREDENTIAL_VALUE',
        )
      ).credential as Credential | undefined,
    })),
  )
  const connectors = connectorCredentials.map(({ connector, credential }) => {
    if (credential?.type !== 'api_key' || credential.key === undefined)
      throw new Error('Connector credential is unavailable')
    return { ...connector, allowedHosts: [...connector.allowedHosts], secret: credential.key }
  })
  const sensitiveValues = [
    ...secretValues(inferenceCredential),
    ...connectorCredentials.flatMap(({ credential }) => secretValues(credential)),
  ]
  executor = createGondolinPiSdkAgentExecutor({
    sessionFactory: createPiSessionFactory({ credentialStore: inferenceCredentials }),
    sandboxFactory: createGondolinAgentSandboxFactory({ glabHostPath: context.glabHostPath }),
    sensitiveValues,
    async resolveContext(): Promise<GondolinPiExecutionContext> {
      return {
        outputSchema: z.json(),
        resourceBundle: context.resourceBundle,
        skills: context.skills.map((skill) => ({ ...skill })),
        connectors,
      }
    },
  })
  for await (const event of executor.execute(input)) message({ type: 'EVENT', event })
  message({ type: 'COMPLETE' })
  setTimeout(() => process.exit(0), 0)
}

process.on('message', (incoming: unknown) => {
  if (incoming === null || typeof incoming !== 'object') return
  const value = incoming as Readonly<Record<string, unknown>>
  if (value.version !== 1 || typeof value.type !== 'string') return
  if (value.type === 'CREDENTIAL_ERROR' && typeof value.requestId === 'string') {
    const requestState = pending.get(value.requestId)
    if (requestState === undefined) return
    pending.delete(value.requestId)
    requestState.reject()
    return
  }
  if (typeof value.requestId === 'string') {
    const requestState = pending.get(value.requestId)
    if (requestState !== undefined && value.type === requestState.expectedType) {
      pending.delete(value.requestId)
      requestState.resolve(value)
      return
    }
  }
  if (value.type === 'START') {
    void run(value.input, value.context).catch(() => {
      message({ type: 'COMPLETE' })
      setTimeout(() => process.exit(1), 0)
    })
    return
  }
  if (value.type === 'CANCEL') {
    if (executor === undefined || executionId === undefined) {
      message({ type: 'CANCELLED', cleanupConfirmed: false })
      return
    }
    void executor.cancel(executionId).then(
      ({ status }) => message({ type: 'CANCELLED', cleanupConfirmed: status === 'cancelled' }),
      () => message({ type: 'CANCELLED', cleanupConfirmed: false }),
    )
  }
})
