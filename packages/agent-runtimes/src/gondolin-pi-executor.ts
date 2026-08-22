import { z } from 'zod'

import type { AgentExecutionInput, AgentExecutor } from './contract.js'
import type { AgentSandboxFactory, CreateAgentSandboxInput } from './gondolin-sandbox.js'
import { createPiSdkAgentExecutor } from './pi-sdk-executor.js'
import type { LoadedResourceBundle } from './resource-loader.js'
import type { PiSessionFactory } from './session-factory.js'

export interface GondolinPiExecutionContext {
  readonly outputSchema: z.ZodType<unknown>
  readonly resourceBundle: LoadedResourceBundle
  readonly skills: CreateAgentSandboxInput['skills']
  readonly connectors: CreateAgentSandboxInput['connectors']
}

export const createGondolinPiSdkAgentExecutor = (
  options: Readonly<{
    sessionFactory: PiSessionFactory
    sandboxFactory: AgentSandboxFactory
    resolveContext: (input: AgentExecutionInput) => Promise<GondolinPiExecutionContext>
    sensitiveValues: readonly string[]
    now?: () => number
  }>,
): AgentExecutor =>
  createPiSdkAgentExecutor({
    sessionFactory: options.sessionFactory,
    sensitiveValues: options.sensitiveValues,
    ...(options.now === undefined ? {} : { now: options.now }),
    async resolveContext(input) {
      const context = await options.resolveContext(input)
      const sandbox = await options.sandboxFactory.create({
        executionId: input.executionId,
        worktrees: input.workspace.repositories.map(({ repositoryId, path }) => ({
          repositoryId,
          hostPath: path,
        })),
        skills: context.skills,
        connectors: context.connectors,
      })
      return {
        outputSchema: context.outputSchema,
        resourceBundle: context.resourceBundle,
        sandbox: {
          workspaceRoot: sandbox.workspaceRoot,
          tools: sandbox.tools,
          skills: sandbox.skills,
        },
        cleanup: () => sandbox.close(),
      }
    },
  })
