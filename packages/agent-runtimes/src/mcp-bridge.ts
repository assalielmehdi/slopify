import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Type, type TSchema } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { z } from 'zod'

import type { AgentSandboxExecProcess, AgentSandboxVm } from './gondolin-sandbox.js'

const McpToolSchema = z.looseObject({
  name: z.string().trim().min(1).max(256),
  title: z.string().trim().min(1).max(512).optional(),
  description: z.string().max(16_384).optional(),
  inputSchema: z.record(z.string(), z.unknown()),
})

export type McpToolSnapshot = z.infer<typeof McpToolSchema>

export interface McpGuestBridge {
  readonly tools: readonly ToolDefinition[]
  close(): Promise<void>
}

export const getMcpGuestSidecarScriptPath = (): string => {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url))
  return join(
    basename(moduleDirectory) === 'src' ? join(moduleDirectory, '..', 'dist') : moduleDirectory,
    'mcp-guest-sidecar.js',
  )
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void
  readonly reject: (reason: Error) => void
  readonly cleanup: () => void
}

export class McpGuestBridgeError extends Error {
  override readonly name = 'McpGuestBridgeError'

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

const catalogFingerprint = (tools: readonly McpToolSnapshot[]): string =>
  stable(
    tools
      .map(({ name, title, description, inputSchema, outputSchema, annotations }) => ({
        name,
        title,
        description,
        inputSchema,
        outputSchema,
        annotations,
      }))
      .toSorted((left, right) => left.name.localeCompare(right.name)),
  )

const toolName = (connectorName: string, originalName: string): string =>
  `${connectorName}_${originalName}`.replaceAll(/[^A-Za-z0-9_-]/gu, '_').slice(0, 128)

const displayName = (value: string): string =>
  `${value.slice(0, 1).toLocaleUpperCase()}${value.slice(1)}`

const stringify = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

const rewriteResultUrls = (
  value: unknown,
  rewrites: readonly Readonly<{ from: string; to: string }>[],
): unknown => {
  if (typeof value === 'string')
    return rewrites.reduce(
      (current, rewrite) => current.replaceAll(rewrite.from, rewrite.to),
      value,
    )
  if (Array.isArray(value)) return value.map((entry) => rewriteResultUrls(entry, rewrites))
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, rewriteResultUrls(entry, rewrites)]),
    )
  return value
}

const resultContent = (result: Record<string, unknown>) => {
  const content = Array.isArray(result.content) ? result.content : []
  const blocks = content.map((candidate) => {
    const block = candidate as Record<string, unknown>
    if (block.type === 'text' && typeof block.text === 'string')
      return { type: 'text' as const, text: block.text }
    if (
      block.type === 'image' &&
      typeof block.data === 'string' &&
      typeof block.mimeType === 'string'
    ) {
      return { type: 'image' as const, data: block.data, mimeType: block.mimeType }
    }
    if (
      block.type === 'resource' &&
      block.resource !== null &&
      typeof block.resource === 'object'
    ) {
      const resource = block.resource as Record<string, unknown>
      const uri = typeof resource.uri === 'string' ? resource.uri : '(no URI)'
      const value = typeof resource.text === 'string' ? resource.text : stringify(resource)
      return { type: 'text' as const, text: `[Resource: ${uri}]\n${value}` }
    }
    if (block.type === 'resource_link') {
      const name = typeof block.name === 'string' ? block.name : 'resource'
      const uri = typeof block.uri === 'string' ? block.uri : '(no URI)'
      return { type: 'text' as const, text: `[Resource Link: ${name}]\nURI: ${uri}` }
    }
    if (block.type === 'audio') {
      const mimeType = typeof block.mimeType === 'string' ? block.mimeType : 'audio/*'
      return { type: 'text' as const, text: `[Audio content: ${mimeType}]` }
    }
    return { type: 'text' as const, text: stringify(candidate) }
  })
  if (blocks.length > 0) return blocks
  if (result.structuredContent !== undefined)
    return [{ type: 'text' as const, text: stringify(result.structuredContent) }]
  return [{ type: 'text' as const, text: '(empty result)' }]
}

const errorMessage = (result: Record<string, unknown>): string => {
  const text = resultContent(result)
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map(({ text }) => text)
    .join('\n')
    .trim()
  return text === '' ? 'MCP tool execution failed' : text.slice(0, 4_096)
}

const createChannel = (process: AgentSandboxExecProcess) => {
  let sequence = 0
  let closed = false
  const pending = new Map<string, PendingRequest>()

  const failPending = (error: Error) => {
    for (const request of pending.values()) {
      request.cleanup()
      request.reject(error)
    }
    pending.clear()
  }

  void (async () => {
    let buffer = ''
    try {
      for await (const chunk of process.output()) {
        if (chunk.stream !== 'stdout') continue
        buffer += chunk.text
        if (buffer.length > 64 * 1_024 * 1_024)
          throw new McpGuestBridgeError('MCP_RESPONSE_TOO_LARGE', 'MCP response exceeded 64 MiB')
        while (true) {
          const newline = buffer.indexOf('\n')
          if (newline < 0) break
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          if (line.trim() === '') continue
          const response = JSON.parse(line) as Record<string, unknown>
          if (typeof response.id !== 'string') continue
          const request = pending.get(response.id)
          if (request === undefined) continue
          pending.delete(response.id)
          request.cleanup()
          if (response.ok === true) request.resolve(response.result)
          else {
            const error = response.error as Record<string, unknown> | undefined
            request.reject(
              new McpGuestBridgeError(
                typeof error?.code === 'string' ? error.code : 'MCP_REQUEST_FAILED',
                typeof error?.message === 'string' ? error.message : 'MCP request failed',
              ),
            )
          }
        }
      }
      if (!closed) failPending(new McpGuestBridgeError('MCP_SIDECAR_EXITED', 'MCP sidecar exited'))
    } catch {
      failPending(new McpGuestBridgeError('MCP_PROTOCOL_FAILED', 'MCP sidecar protocol failed'))
    }
  })()

  const request = <Result>(
    message: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<Result> => {
    if (closed) return Promise.reject(new McpGuestBridgeError('MCP_CLOSED', 'MCP bridge is closed'))
    const id = `mcp-${++sequence}`
    return new Promise<Result>((resolve, reject) => {
      const onAbort = () => {
        const current = pending.get(id)
        if (current === undefined) return
        pending.delete(id)
        signal?.removeEventListener('abort', onAbort)
        process.write(`${JSON.stringify({ type: 'cancel', requestId: id })}\n`)
        reject(new McpGuestBridgeError('CANCELLED', 'MCP request cancelled'))
      }
      const cleanup = () => signal?.removeEventListener('abort', onAbort)
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject, cleanup })
      if (signal?.aborted === true) {
        onAbort()
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      process.write(`${JSON.stringify({ ...message, id })}\n`)
    })
  }

  return {
    request,
    async close() {
      if (closed) return
      try {
        await request({ type: 'close' }, AbortSignal.timeout(5_000))
      } finally {
        closed = true
        process.end()
        await Promise.resolve(process).catch(() => undefined)
        failPending(new McpGuestBridgeError('MCP_CLOSED', 'MCP bridge is closed'))
      }
    },
  }
}

export const connectMcpGuestBridge = async (
  options: Readonly<{
    vm: AgentSandboxVm
    connectorName: string
    serverUrl: string
    tokenEnvironmentName?: string
    expectedTools: readonly unknown[]
    guestScriptPath: string
    resultUrlRewrites?: readonly Readonly<{ from: string; to: string }>[]
  }>,
): Promise<McpGuestBridge> => {
  const expectedTools = z.array(McpToolSchema).min(1).max(128).parse(options.expectedTools)
  const guestServerUrl = new URL(options.serverUrl)
  if (
    guestServerUrl.protocol !== 'http:' ||
    guestServerUrl.username !== '' ||
    guestServerUrl.password !== ''
  )
    throw new TypeError('Guest MCP bridge requires an HTTP server URL without credentials')
  const process = options.vm.exec(`/usr/bin/node ${options.guestScriptPath}`, {
    env: {
      SLOPIFY_MCP_SERVER_URL: guestServerUrl.toString(),
      ...(options.tokenEnvironmentName === undefined
        ? {}
        : { SLOPIFY_MCP_TOKEN_ENV: options.tokenEnvironmentName }),
    },
    stdin: true,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const channel = createChannel(process)
  try {
    const initialized = (await channel.request(
      { type: 'initialize' },
      AbortSignal.timeout(30_000),
    )) as Record<string, unknown>
    const discoveredTools = z.array(McpToolSchema).min(1).max(128).parse(initialized.tools)
    if (catalogFingerprint(expectedTools) !== catalogFingerprint(discoveredTools))
      throw new McpGuestBridgeError(
        'MCP_CATALOG_CHANGED',
        'MCP tool catalog changed; revalidate the connector',
      )
    const nativeNames = expectedTools.map(({ name }) => toolName(options.connectorName, name))
    if (new Set(nativeNames).size !== nativeNames.length)
      throw new McpGuestBridgeError('MCP_TOOL_COLLISION', 'MCP tool names collide after prefixing')
    const connectorLabel = displayName(options.connectorName)
    const tools = expectedTools.map((tool): ToolDefinition => ({
      name: toolName(options.connectorName, tool.name),
      label: `${connectorLabel} · ${tool.title ?? tool.name}`,
      description: tool.description ?? `${connectorLabel} MCP tool ${tool.name}`,
      parameters: Type.Unsafe(tool.inputSchema as TSchema),
      async execute(_toolCallId, parameters, signal) {
        const call = () =>
          channel.request(
            { type: 'call', tool: tool.name, arguments: parameters },
            signal,
          ) as Promise<Record<string, unknown>>
        let result: Record<string, unknown>
        try {
          result = await call()
        } catch (cause) {
          if (cause instanceof McpGuestBridgeError && cause.code === 'TRANSIENT_NETWORK') {
            result = await call()
          } else {
            throw cause
          }
        }
        const rewritten = rewriteResultUrls(result, options.resultUrlRewrites ?? []) as Record<
          string,
          unknown
        >
        if (rewritten.isError === true) throw new Error(errorMessage(rewritten))
        return {
          content: resultContent(rewritten),
          details: {
            connector: options.connectorName,
            tool: tool.name,
            ...(rewritten.structuredContent === undefined
              ? {}
              : { structuredContent: rewritten.structuredContent }),
          },
        }
      },
    }))
    return Object.freeze({ tools: Object.freeze(tools), close: channel.close })
  } catch (cause) {
    await channel.close().catch(() => undefined)
    throw cause
  }
}
