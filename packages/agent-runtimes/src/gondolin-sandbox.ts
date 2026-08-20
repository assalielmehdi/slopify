import { dirname, isAbsolute } from 'node:path'

import {
  BASE64URL_ALPHABET,
  ReadonlyProvider,
  RealFSProvider,
  VM,
  createHttpHooks,
  makePlaceholderFunc,
  type VMOptions,
  type VmFs,
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

const identifier = z
  .string()
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u)
  .max(128)
const SandboxInputSchema = z.strictObject({
  executionId: z.string().trim().min(1).max(256),
  worktrees: z
    .array(z.strictObject({ repositoryId: identifier, hostPath: z.string().refine(isAbsolute) }))
    .min(1)
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
      z.strictObject({
        connectionId: identifier,
        type: z.enum(['gitlab', 'clickup']),
        authority: z.string().trim().min(1).max(2_048),
        secret: z.string().min(1),
        allowedHosts: z.array(z.string().trim().min(1)).min(1).max(8),
      }),
    )
    .max(32),
})

export type CreateAgentSandboxInput = z.input<typeof SandboxInputSchema>

interface AgentSandboxExecProcess extends PromiseLike<Readonly<{ exitCode: number }>> {
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

const environmentName = (type: string, connectionId: string): string =>
  `SLOPIFY_${type}_${connectionId}`.replaceAll(/[^A-Za-z0-9_]/gu, '_').toUpperCase()

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
        exposeSessionEnvironment: false,
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
    createVm?: (options: VMOptions) => Promise<AgentSandboxVm>
  }> = {},
): AgentSandboxFactory => ({
  async create(input) {
    const parsed = SandboxInputSchema.parse(input)
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
      ...parsed.worktrees.map(({ repositoryId, hostPath }) => [
        `/workspace/${repositoryId}`,
        new RealFSProvider(hostPath),
      ]),
      ...parsed.skills.map(({ skillId, hostPath }) => [
        `/skills/${skillId}`,
        new ReadonlyProvider(new RealFSProvider(hostPath)),
      ]),
    ])
    const secrets = Object.fromEntries(
      parsed.connectors.map((connector) => [
        environmentName(connector.type, connector.connectionId),
        {
          value: connector.secret,
          hosts: connector.allowedHosts,
          placeholder: makePlaceholderFunc({
            prefix: 'slopify_',
            length: 48,
            alphabet: BASE64URL_ALPHABET,
          }),
        },
      ]),
    )
    const network = createHttpHooks({
      allowedHosts: [...new Set(parsed.connectors.flatMap(({ allowedHosts }) => allowedHosts))],
      secrets,
      replaceSecretsInQuery: false,
      blockInternalRanges: true,
    })
    const createVm: (vmOptions: VMOptions) => Promise<AgentSandboxVm> =
      options.createVm ?? (async (vmOptions) => VM.create(vmOptions) as unknown as AgentSandboxVm)
    const vm = await createVm({
      httpHooks: network.httpHooks,
      env: network.env,
      vfs: { mounts },
      memory: '1G',
      cpus: 2,
      sessionLabel: `slopify:${parsed.executionId}`,
    })
    let closed = false
    return Object.freeze({
      sandboxId: vm.id,
      workspaceRoot: '/workspace' as const,
      tools: createGuestTools(vm),
      skills: Object.freeze(
        parsed.skills.map((skill) => ({
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
      ),
      async close() {
        if (closed) return
        closed = true
        for (const { name } of network.secretManager.listSecrets())
          network.secretManager.deleteSecret(name)
        await vm.close()
      },
    })
  },
})
