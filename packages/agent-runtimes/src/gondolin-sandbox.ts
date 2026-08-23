import { basename, dirname, isAbsolute } from 'node:path'

import {
  BASE64URL_ALPHABET,
  MemoryProvider,
  ReadonlyProvider,
  RealFSProvider,
  VM,
  createHttpHooks,
  makePlaceholderFunc,
  type VmFs,
  type VMOptions,
} from '@earendil-works/gondolin'
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  defineTool,
  type Skill,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { z } from 'zod'

import {
  connectMcpGuestBridge,
  getMcpGuestSidecarScriptPath,
  type McpGuestBridge,
} from './mcp-bridge.js'
import { FIGMA_DESKTOP_MCP_URL } from './desktop-mcp.js'

const FIGMA_DESKTOP_PROXY_HOST = 'figma-desktop.slopify'
const FIGMA_DESKTOP_PROXY_ORIGIN = `http://${FIGMA_DESKTOP_PROXY_HOST}`

const identifier = z
  .string()
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u)
  .max(128)
const SandboxInputSchema = z.strictObject({
  executionId: z.string().trim().min(1).max(256),
  worktrees: z
    .array(z.strictObject({ repositoryId: identifier, hostPath: z.string().refine(isAbsolute) }))
    .max(32),
  skills: z
    .array(
      z.strictObject({
        skillId: identifier,
        name: identifier,
        description: z.string().trim().min(1).max(2_048),
        hostPath: z.string().refine(isAbsolute),
      }),
    )
    .max(32),
  connectors: z
    .array(
      z.discriminatedUnion('type', [
        z.strictObject({
          connectionId: identifier,
          type: z.literal('gitlab'),
          authority: z.string().trim().min(1).max(2_048),
          secret: z.string().min(1),
          allowedHosts: z.array(z.string().trim().min(1)).min(1).max(8),
        }),
        z.strictObject({
          connectionId: identifier,
          type: z.literal('clickup'),
          authority: z.string().trim().min(1).max(2_048),
          secret: z.string().min(1),
          allowedHosts: z.array(z.string().trim().min(1)).min(1).max(8),
        }),
        z.strictObject({
          connectionId: identifier,
          type: z.literal('figma'),
          authority: z.string().trim().min(1).max(2_048),
          allowedHosts: z.array(z.literal(FIGMA_DESKTOP_PROXY_HOST)).length(1),
          mcpServerUrl: z.literal(FIGMA_DESKTOP_MCP_URL),
          tools: z.array(z.record(z.string(), z.unknown())).min(1).max(128),
        }),
      ]),
    )
    .max(32),
})

export type CreateAgentSandboxInput = z.input<typeof SandboxInputSchema>

export interface AgentSandboxExecProcess extends PromiseLike<Readonly<{ exitCode: number }>> {
  write(data: string | Buffer): void
  end(): void
  output(): AsyncIterable<Readonly<{ stream: 'stdout' | 'stderr'; data: Buffer; text: string }>>
}

export interface AgentSandboxVm {
  readonly id: string
  readonly fs: Pick<VmFs, 'access' | 'mkdir' | 'readFile' | 'writeFile'>
  exec(
    command: string,
    options: Readonly<{
      cwd?: string
      env?: Record<string, string>
      signal?: AbortSignal
      stdin?: boolean
      stdout?: 'pipe'
      stderr?: 'pipe'
    }>,
  ): AgentSandboxExecProcess
  close(): Promise<void>
}

export interface AgentSandbox {
  readonly sandboxId: string
  readonly workspaceRoot: '/workspace'
  readonly tools: readonly ToolDefinition[]
  readonly skills: readonly Skill[]
  close(): Promise<void>
}

export interface AgentSandboxFactory {
  create(input: CreateAgentSandboxInput): Promise<AgentSandbox>
}

const environmentName = (type: string): string =>
  type === 'gitlab'
    ? 'GITLAB_TOKEN'
    : `SLOPIFY_${type}`.replaceAll(/[^A-Za-z0-9_]/gu, '_').toUpperCase()

const GUEST_PATH = '/opt/slopify/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

const createGuestTools = (vm: AgentSandboxVm): readonly ToolDefinition[] => {
  const read = {
    readFile: (path: string) => vm.fs.readFile(path),
    access: (path: string) => vm.fs.access(path),
  }
  const write = {
    async writeFile(path: string, content: string) {
      await vm.fs.writeFile(path, content)
    },
    mkdir: (path: string) => vm.fs.mkdir(path, { recursive: true }).then(() => undefined),
  }
  return Object.freeze([
    defineTool(createReadToolDefinition('/workspace', { operations: read })),
    defineTool(
      createBashToolDefinition('/workspace', {
        commandPrefix: `export PATH=${GUEST_PATH}`,
        exposeSessionEnvironment: false,
        spawnHook: ({ command, cwd }) => ({ command, cwd, env: {} }),
        operations: {
          async exec(command, cwd, options) {
            const environment = Object.fromEntries(
              Object.entries(options.env ?? {}).filter(
                (entry): entry is [string, string] => entry[1] !== undefined,
              ),
            )
            const process = vm.exec(command, {
              cwd,
              ...(Object.keys(environment).length === 0 ? {} : { env: environment }),
              ...(options.signal === undefined ? {} : { signal: options.signal }),
              stdout: 'pipe',
              stderr: 'pipe',
            })
            for await (const chunk of process.output()) options.onData(chunk.data)
            return { exitCode: (await process).exitCode }
          },
        },
      }),
    ),
    defineTool(
      createEditToolDefinition('/workspace', {
        operations: {
          ...read,
          writeFile: write.writeFile,
        },
      }),
    ),
    defineTool(
      createWriteToolDefinition('/workspace', {
        operations: {
          async writeFile(path, content) {
            await write.mkdir(dirname(path))
            await write.writeFile(path, content)
          },
          mkdir: write.mkdir,
        },
      }),
    ),
  ])
}

export const createGondolinAgentSandboxFactory = (
  options: Readonly<{
    glabHostPath: string
    mcpSidecarHostPath?: string
    hostFetch?: typeof globalThis.fetch
    createVm?: (options: VMOptions) => Promise<AgentSandboxVm>
  }>,
): AgentSandboxFactory => ({
  async create(input) {
    const parsed = SandboxInputSchema.parse(input)
    if (!isAbsolute(options.glabHostPath) || basename(options.glabHostPath) !== 'glab')
      throw new TypeError('Guest glab path must be an absolute glab binary path')
    const mcpConnectors = parsed.connectors.filter(
      (connector): connector is Extract<(typeof parsed.connectors)[number], { type: 'figma' }> =>
        connector.type === 'figma',
    )
    const mcpSidecarHostPath = options.mcpSidecarHostPath ?? getMcpGuestSidecarScriptPath()
    if (
      mcpConnectors.length > 0 &&
      (!isAbsolute(mcpSidecarHostPath) || basename(mcpSidecarHostPath) !== 'mcp-guest-sidecar.js')
    ) {
      throw new TypeError('Guest MCP sidecar path must be an absolute mcp-guest-sidecar.js file')
    }
    const repositoryIds = parsed.worktrees.map(({ repositoryId }) => repositoryId)
    const skillIds = parsed.skills.map(({ skillId }) => skillId)
    const connectorIds = parsed.connectors.map(({ connectionId }) => connectionId)
    if (
      new Set(repositoryIds).size !== repositoryIds.length ||
      new Set(skillIds).size !== skillIds.length ||
      new Set(connectorIds).size !== connectorIds.length
    ) {
      throw new TypeError('Sandbox resources must be unique')
    }

    const mounts = Object.fromEntries([
      ...(parsed.worktrees.length === 0 ? ([['/workspace', new MemoryProvider()]] as const) : []),
      ...parsed.worktrees.map(({ repositoryId, hostPath }) => [
        `/workspace/${repositoryId}`,
        new RealFSProvider(hostPath),
      ]),
      ...parsed.skills.map(({ skillId, hostPath }) => [
        `/skills/${skillId}`,
        new ReadonlyProvider(new RealFSProvider(hostPath)),
      ]),
      ['/opt/slopify/bin', new ReadonlyProvider(new RealFSProvider(dirname(options.glabHostPath)))],
      ...(mcpConnectors.length === 0
        ? []
        : [
            [
              '/opt/slopify/mcp',
              new ReadonlyProvider(new RealFSProvider(dirname(mcpSidecarHostPath))),
            ],
          ]),
    ])
    const secrets = Object.fromEntries(
      parsed.connectors.flatMap((connector) =>
        connector.type === 'figma'
          ? []
          : [
              [
                environmentName(connector.type),
                {
                  value: connector.secret,
                  hosts: connector.allowedHosts,
                  placeholder: makePlaceholderFunc({
                    prefix: 'slopify_',
                    length: 48,
                    alphabet: BASE64URL_ALPHABET,
                  }),
                },
              ] as const,
            ],
      ),
    )
    const mcpTargets = new Map(
      mcpConnectors.map((connector) => [FIGMA_DESKTOP_PROXY_HOST, new URL(connector.mcpServerUrl)]),
    )
    const hostFetch = options.hostFetch ?? globalThis.fetch
    const network = createHttpHooks({
      allowedHosts: [...new Set(parsed.connectors.flatMap(({ allowedHosts }) => allowedHosts))],
      secrets,
      replaceSecretsInQuery: false,
      blockInternalRanges: true,
      async onRequest(request) {
        const incoming = new URL(request.url)
        const configuredTarget = mcpTargets.get(incoming.hostname)
        if (configuredTarget === undefined || incoming.protocol !== 'http:') return request
        const target = new URL(incoming.pathname, configuredTarget.origin)
        target.search = incoming.search
        const canHaveBody = !['GET', 'HEAD'].includes(request.method.toUpperCase())
        const body = canHaveBody ? await request.arrayBuffer() : undefined
        const headers = new Headers(request.headers)
        headers.set('host', configuredTarget.host)
        return hostFetch(
          new Request(target, {
            method: request.method,
            headers,
            ...(body === undefined || body.byteLength === 0 ? {} : { body }),
          }),
        )
      },
    })
    const gitlab = parsed.connectors.find(({ type }) => type === 'gitlab')
    const environment = {
      ...network.env,
      PATH: GUEST_PATH,
      GLAB_CHECK_UPDATE: 'false',
      GLAB_SEND_TELEMETRY: 'false',
      GLAB_SHOW_WHATS_NEW: 'false',
      GLAB_CONFIG_DIR: '/tmp/glab',
      ...(gitlab === undefined ? {} : { GITLAB_HOST: gitlab.allowedHosts[0] }),
    }
    const createVm: (vmOptions: VMOptions) => Promise<AgentSandboxVm> =
      options.createVm ?? (async (vmOptions) => VM.create(vmOptions) as unknown as AgentSandboxVm)
    const vm = await createVm({
      httpHooks: network.httpHooks,
      env: environment,
      vfs: { mounts },
      memory: '1G',
      cpus: 2,
      sessionLabel: `slopify:${parsed.executionId}`,
    })
    const bridges: McpGuestBridge[] = []
    try {
      for (const connector of mcpConnectors) {
        bridges.push(
          await connectMcpGuestBridge({
            vm,
            connectorName: connector.type,
            serverUrl: `${FIGMA_DESKTOP_PROXY_ORIGIN}/mcp`,
            expectedTools: connector.tools,
            guestScriptPath: '/opt/slopify/mcp/mcp-guest-sidecar.js',
            resultUrlRewrites: [
              { from: new URL(connector.mcpServerUrl).origin, to: FIGMA_DESKTOP_PROXY_ORIGIN },
              { from: 'http://localhost:3845', to: FIGMA_DESKTOP_PROXY_ORIGIN },
            ],
          }),
        )
      }
    } catch (cause) {
      await Promise.allSettled(bridges.map(({ close }) => close()))
      for (const { name } of network.secretManager.listSecrets())
        network.secretManager.deleteSecret(name)
      await vm.close()
      throw cause
    }
    let closed = false
    return Object.freeze({
      sandboxId: vm.id,
      workspaceRoot: '/workspace' as const,
      tools: Object.freeze([...createGuestTools(vm), ...bridges.flatMap(({ tools }) => tools)]),
      skills: Object.freeze([
        ...parsed.skills.map((skill) => ({
          name: skill.name,
          description: skill.description,
          filePath: `/skills/${skill.skillId}/SKILL.md`,
          baseDir: `/skills/${skill.skillId}`,
          sourceInfo: {
            path: `/skills/${skill.skillId}/SKILL.md`,
            source: 'slopify-snapshot',
            scope: 'temporary' as const,
            origin: 'top-level' as const,
            baseDir: `/skills/${skill.skillId}`,
          },
          disableModelInvocation: false,
        })),
      ]),
      async close() {
        if (closed) return
        closed = true
        await Promise.allSettled(bridges.map(({ close }) => close()))
        for (const { name } of network.secretManager.listSecrets())
          network.secretManager.deleteSecret(name)
        await vm.close()
      },
    })
  },
})
