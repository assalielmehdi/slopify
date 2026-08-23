import { createInterface } from 'node:readline'

import { LATEST_PROTOCOL_VERSION, type Tool } from '@modelcontextprotocol/client'

const serverUrl = process.env.SLOPIFY_MCP_SERVER_URL
const tokenEnvironmentName = process.env.SLOPIFY_MCP_TOKEN_ENV
if (serverUrl === undefined) throw new Error('MCP sidecar configuration is missing')
const accessToken =
  tokenEnvironmentName === undefined ? undefined : process.env[tokenEnvironmentName]
if (tokenEnvironmentName !== undefined && accessToken === undefined)
  throw new Error('MCP sidecar credential placeholder is missing')

class GuestMcpError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

const requests = new Map<string, AbortController>()
let sequence = 0
let sessionId: string | undefined
let protocolVersion = LATEST_PROTOCOL_VERSION
let initialized: Promise<void> | undefined
let tools: readonly Tool[] = []

const send = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

const isTransientNetworkError = (cause: unknown): boolean => {
  if (!(cause instanceof TypeError) || cause.cause === null || typeof cause.cause !== 'object')
    return false
  const code = (cause.cause as Readonly<{ code?: unknown }>).code
  return typeof code === 'string' && ['ECONNRESET', 'EPIPE', 'ETIMEDOUT'].includes(code)
}

const parseMessages = (body: string, contentType: string): readonly Record<string, unknown>[] => {
  const payloads = contentType.includes('text/event-stream')
    ? body
        .split(/\r?\n/u)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .filter((line) => line !== '')
    : [body.trim()].filter((value) => value !== '')
  return payloads.flatMap((payload) => {
    const parsed = JSON.parse(payload) as unknown
    const values = Array.isArray(parsed) ? parsed : [parsed]
    return values.filter(
      (value): value is Record<string, unknown> =>
        value !== null && typeof value === 'object' && !Array.isArray(value),
    )
  })
}

const post = async (
  message: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
): Promise<readonly Record<string, unknown>[]> => {
  const execute = async () => {
    const response = await fetch(serverUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        ...(accessToken === undefined ? {} : { authorization: `Bearer ${accessToken}` }),
        'content-type': 'application/json',
        'mcp-protocol-version': protocolVersion,
        ...(sessionId === undefined ? {} : { 'mcp-session-id': sessionId }),
      },
      body: JSON.stringify(message),
      signal,
    })
    if (!response.ok) throw new GuestMcpError('MCP_REQUEST_FAILED', 'MCP request failed')
    sessionId = response.headers.get('mcp-session-id') ?? sessionId
    return parseMessages(await response.text(), response.headers.get('content-type') ?? '')
  }
  try {
    return await execute()
  } catch (cause) {
    if (!isTransientNetworkError(cause)) throw cause
    return execute()
  }
}

const rpc = async (
  method: string,
  params: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
): Promise<Record<string, unknown>> => {
  const id = ++sequence
  const messages = await post({ jsonrpc: '2.0', id, method, params }, signal)
  const response = messages.find((message) => message.id === id)
  if (response === undefined)
    throw new GuestMcpError('MCP_PROTOCOL_FAILED', 'MCP response was missing')
  if (response.error !== undefined)
    throw new GuestMcpError('MCP_REQUEST_FAILED', 'MCP request failed')
  if (response.result === null || typeof response.result !== 'object')
    throw new GuestMcpError('MCP_PROTOCOL_FAILED', 'MCP result was malformed')
  return response.result as Record<string, unknown>
}

const notify = async (
  method: string,
  params: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
): Promise<void> => {
  await post({ jsonrpc: '2.0', method, params }, signal)
}

const ensureConnected = async (signal: AbortSignal): Promise<void> => {
  if (initialized === undefined) {
    initialized = (async () => {
      const result = await rpc(
        'initialize',
        {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'Slopify', version: '1.0.0' },
        },
        signal,
      )
      if (typeof result.protocolVersion === 'string') protocolVersion = result.protocolVersion
      await notify('notifications/initialized', {}, signal)
    })()
  }
  try {
    await initialized
  } catch (cause) {
    initialized = undefined
    throw cause
  }
}

const listTools = async (signal: AbortSignal): Promise<readonly Tool[]> => {
  const discovered: Tool[] = []
  let cursor: string | undefined
  for (let page = 0; page < 8; page += 1) {
    const result = await rpc('tools/list', cursor === undefined ? {} : { cursor }, signal)
    if (!Array.isArray(result.tools))
      throw new GuestMcpError('MCP_PROTOCOL_FAILED', 'MCP tool catalog was malformed')
    discovered.push(...(result.tools as Tool[]))
    if (typeof result.nextCursor !== 'string') return discovered
    cursor = result.nextCursor
  }
  throw new GuestMcpError('MCP_PROTOCOL_FAILED', 'MCP tool catalog pagination exceeded the limit')
}

const error = (cause: unknown): Readonly<{ code: string; message: string }> => {
  if (cause instanceof GuestMcpError) return { code: cause.code, message: cause.message }
  if (cause instanceof Error && cause.name === 'AbortError')
    return { code: 'CANCELLED', message: 'MCP request cancelled' }
  if (isTransientNetworkError(cause))
    return { code: 'TRANSIENT_NETWORK', message: 'MCP network request failed' }
  return { code: 'MCP_REQUEST_FAILED', message: 'MCP request failed' }
}

const handle = async (message: Record<string, unknown>): Promise<void> => {
  if (message.type === 'cancel' && typeof message.requestId === 'string') {
    requests.get(message.requestId)?.abort()
    return
  }
  if (typeof message.id !== 'string') return
  const controller = new AbortController()
  requests.set(message.id, controller)
  try {
    if (message.type === 'initialize') {
      await ensureConnected(controller.signal)
      tools = await listTools(controller.signal)
      send({ id: message.id, ok: true, result: { tools } })
      return
    }
    if (message.type === 'call' && typeof message.tool === 'string') {
      await ensureConnected(controller.signal)
      if (!tools.some(({ name }) => name === message.tool))
        throw new GuestMcpError('MCP_UNKNOWN_TOOL', 'MCP tool is unavailable')
      const result = await rpc(
        'tools/call',
        {
          name: message.tool,
          arguments:
            message.arguments !== null && typeof message.arguments === 'object'
              ? message.arguments
              : {},
        },
        controller.signal,
      )
      send({ id: message.id, ok: true, result })
      return
    }
    if (message.type === 'close') {
      for (const [id, active] of requests) if (id !== message.id) active.abort()
      send({ id: message.id, ok: true, result: {} })
      process.exit(0)
      return
    }
    throw new GuestMcpError('MCP_PROTOCOL_FAILED', 'Unknown MCP sidecar request')
  } catch (cause) {
    send({ id: message.id, ok: false, error: error(cause) })
  } finally {
    requests.delete(message.id)
  }
}

const lines = createInterface({ input: process.stdin, terminal: false })
lines.on('line', (line) => {
  try {
    const message = JSON.parse(line) as Record<string, unknown>
    void handle(message)
  } catch {
    // Ignore malformed host input. The trusted host owns this private channel.
  }
})
lines.on('close', () => {
  for (const controller of requests.values()) controller.abort()
  process.exit(0)
})
