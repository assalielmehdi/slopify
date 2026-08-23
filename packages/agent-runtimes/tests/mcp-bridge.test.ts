import { describe, expect, it, vi } from 'vitest'

import {
  connectMcpGuestBridge,
  type AgentSandboxExecProcess,
  type AgentSandboxVm,
} from '../src/index.js'

const tools = [
  {
    name: 'get_metadata',
    title: 'Get metadata',
    description: 'Read the Figma node tree.',
    inputSchema: {
      type: 'object',
      properties: { fileKey: { type: 'string' } },
      required: ['fileKey'],
      additionalProperties: false,
    },
  },
]

class FakeMcpProcess implements AgentSandboxExecProcess {
  readonly writes: Record<string, unknown>[] = []
  readonly #chunks: Readonly<{ stream: 'stdout'; data: Buffer; text: string }>[] = []
  #wake: (() => void) | undefined
  #closed = false
  #failureCode: string | undefined

  constructor(failureCode?: string) {
    this.#failureCode = failureCode
  }

  write(data: string | Buffer): void {
    for (const line of data.toString().trim().split('\n')) {
      const message = JSON.parse(line) as Record<string, unknown>
      this.writes.push(message)
      if (message.type === 'initialize') {
        this.respond({ id: message.id, ok: true, result: { tools } })
      } else if (message.type === 'call') {
        if (this.#failureCode !== undefined) {
          const code = this.#failureCode
          this.#failureCode = undefined
          this.respond({
            id: message.id,
            ok: false,
            error: { code, message: 'MCP request failed' },
          })
          continue
        }
        this.respond({
          id: message.id,
          ok: true,
          result: {
            content: [
              {
                type: 'text',
                text: 'Frame 1\nhttp://127.0.0.1:3845/assets/icon.svg',
              },
              { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' },
            ],
            structuredContent: {
              nodeId: '1:2',
              assetUrl: 'http://localhost:3845/assets/icon.svg',
            },
          },
        })
      } else if (message.type === 'cancel') {
        this.respond({
          id: message.requestId,
          ok: false,
          error: { code: 'CANCELLED', message: 'MCP request cancelled' },
        })
      } else if (message.type === 'close') {
        this.respond({ id: message.id, ok: true, result: {} })
        this.end()
      }
    }
  }

  end(): void {
    this.#closed = true
    this.#wake?.()
  }

  respond(value: unknown): void {
    const text = `${JSON.stringify(value)}\n`
    this.#chunks.push({ stream: 'stdout', data: Buffer.from(text), text })
    this.#wake?.()
    this.#wake = undefined
  }

  async *output() {
    while (!this.#closed || this.#chunks.length > 0) {
      const chunk = this.#chunks.shift()
      if (chunk !== undefined) yield chunk
      else await new Promise<void>((resolve) => (this.#wake = resolve))
    }
  }

  then<TResult1 = Readonly<{ exitCode: number }>, TResult2 = never>(
    onfulfilled?:
      ((value: Readonly<{ exitCode: number }>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ exitCode: 0 }).then(onfulfilled, onrejected)
  }
}

const fixture = (failureCode?: string) => {
  const process = new FakeMcpProcess(failureCode)
  const exec = vi.fn(() => process)
  const vm = {
    id: 'vm-01',
    fs: {
      access: vi.fn(),
      mkdir: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
    },
    exec,
    close: vi.fn(async () => undefined),
  } as unknown as AgentSandboxVm
  return { exec, process, vm }
}

describe('Gondolin MCP bridge', () => {
  it('registers exact MCP schemas as native prefixed Pi tools and maps multimodal results', async () => {
    const { exec, process, vm } = fixture()
    const bridge = await connectMcpGuestBridge({
      vm,
      connectorName: 'figma',
      serverUrl: 'http://figma-desktop.slopify/mcp',
      expectedTools: tools,
      guestScriptPath: '/opt/slopify/mcp/mcp-guest-sidecar.js',
      resultUrlRewrites: [
        { from: 'http://127.0.0.1:3845', to: 'http://figma-desktop.slopify' },
        { from: 'http://localhost:3845', to: 'http://figma-desktop.slopify' },
      ],
    })

    expect(exec).toHaveBeenCalledWith('/usr/bin/node /opt/slopify/mcp/mcp-guest-sidecar.js', {
      env: {
        SLOPIFY_MCP_SERVER_URL: 'http://figma-desktop.slopify/mcp',
      },
      stdin: true,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(bridge.tools).toHaveLength(1)
    expect(bridge.tools[0]).toMatchObject({
      name: 'figma_get_metadata',
      label: 'Figma · Get metadata',
      description: 'Read the Figma node tree.',
      parameters: tools[0]?.inputSchema,
    })

    await expect(
      bridge.tools[0]?.execute(
        'tool-01',
        { fileKey: 'abc' },
        new AbortController().signal,
        undefined,
        {} as never,
      ),
    ).resolves.toEqual({
      content: [
        {
          type: 'text',
          text: 'Frame 1\nhttp://figma-desktop.slopify/assets/icon.svg',
        },
        { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' },
      ],
      details: {
        connector: 'figma',
        tool: 'get_metadata',
        structuredContent: {
          nodeId: '1:2',
          assetUrl: 'http://figma-desktop.slopify/assets/icon.svg',
        },
      },
    })
    expect(process.writes).toContainEqual(
      expect.objectContaining({
        type: 'call',
        tool: 'get_metadata',
        arguments: { fileKey: 'abc' },
      }),
    )

    await bridge.close()
    expect(process.writes).toContainEqual(expect.objectContaining({ type: 'close' }))
  })

  it('refuses a changed server tool catalog instead of silently changing the agent surface', async () => {
    const { vm } = fixture()

    await expect(
      connectMcpGuestBridge({
        vm,
        connectorName: 'figma',
        serverUrl: 'http://figma-desktop.slopify/mcp',
        expectedTools: tools.map((tool) => ({
          ...tool,
          description: 'Different schema snapshot.',
        })),
        guestScriptPath: '/opt/slopify/mcp/mcp-guest-sidecar.js',
      }),
    ).rejects.toThrow(/catalog changed/i)
  })

  it('retries one transient guest network reset', async () => {
    const { process, vm } = fixture('TRANSIENT_NETWORK')
    const bridge = await connectMcpGuestBridge({
      vm,
      connectorName: 'figma',
      serverUrl: 'http://figma-desktop.slopify/mcp',
      expectedTools: tools,
      guestScriptPath: '/opt/slopify/mcp/mcp-guest-sidecar.js',
    })

    await expect(
      bridge.tools[0]?.execute('tool-01', {}, new AbortController().signal, undefined, {} as never),
    ).resolves.toMatchObject({ content: expect.any(Array) })
    expect(process.writes.filter(({ type }) => type === 'call')).toHaveLength(2)
    await bridge.close()
  })

  it('rejects a tool call that is already cancelled without sending it to MCP', async () => {
    const { process, vm } = fixture()
    const bridge = await connectMcpGuestBridge({
      vm,
      connectorName: 'figma',
      serverUrl: 'http://figma-desktop.slopify/mcp',
      expectedTools: tools,
      guestScriptPath: '/opt/slopify/mcp/mcp-guest-sidecar.js',
    })
    const controller = new AbortController()
    controller.abort()

    await expect(
      bridge.tools[0]?.execute('tool-01', {}, controller.signal, undefined, {} as never),
    ).rejects.toThrow(/cancelled/i)
    expect(process.writes.filter(({ type }) => type === 'call')).toHaveLength(0)
    await bridge.close()
  })
})
