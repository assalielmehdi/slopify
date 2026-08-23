import { Client, StreamableHTTPClientTransport, type Tool } from '@modelcontextprotocol/client'

export const FIGMA_DESKTOP_MCP_URL = 'http://127.0.0.1:3845/mcp'

export interface DesktopMcpInspection {
  readonly tools: readonly Tool[]
}

const requestSignal = (signal: AbortSignal | undefined, timeoutMs: number): AbortSignal => {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout])
}

export const inspectDesktopMcpServer = async (
  input: Readonly<{ serverUrl: string; signal?: AbortSignal }>,
): Promise<DesktopMcpInspection> => {
  const url = new URL(input.serverUrl)
  if (url.href !== FIGMA_DESKTOP_MCP_URL || url.username !== '' || url.password !== '')
    throw new TypeError('Figma Desktop MCP URL is invalid')
  const client = new Client({ name: 'Slopify', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(url)
  const signal = requestSignal(input.signal, 10_000)
  try {
    await client.connect(transport, { signal })
    const { tools } = await client.listTools(undefined, { signal, cacheMode: 'refresh' })
    if (tools.length === 0) throw new Error('Figma Desktop MCP exposed no tools')
    return structuredClone({ tools })
  } finally {
    await client.close().catch(() => undefined)
  }
}
