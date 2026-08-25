import { z } from 'zod'

import {
  HarnessIdSchema,
  HarnessThinkingLevelSchema,
  NodeIdSchema,
  OutcomeNameSchema,
  RepositoryIdSchema,
  RunIdSchema,
} from './schemas.js'

const OPAQUE_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/u

const identifier = z.string().min(1).max(128).regex(OPAQUE_ID_PATTERN)
const absolutePath = z
  .string()
  .min(1)
  .max(4_096)
  .refine((value) => value.startsWith('/'))
const boundedText = z.string().trim().min(1).max(16_384)
const content = z
  .string()
  .min(1)
  .max(1_000_000)
  .refine((value) => value.trim().length > 0)
const durationMs = z.number().int().nonnegative().safe()
const tokenCount = z.number().int().nonnegative().safe()

export const AgentExecutionIdSchema = identifier.brand<'AgentExecutionId'>()

const AgentWorkspaceRepositorySchema = z
  .strictObject({
    repositoryId: RepositoryIdSchema,
    path: absolutePath,
  })
  .readonly()

export const AgentWorkspaceSchema = z
  .strictObject({
    rootPath: absolutePath,
    primaryRepositoryId: RepositoryIdSchema,
    repositories: z.array(AgentWorkspaceRepositorySchema).min(1).max(32).readonly(),
  })
  .superRefine((workspace, context) => {
    const repositoryIds = new Set<string>()
    const repositoryPaths = new Set<string>()
    const workspacePrefix = workspace.rootPath.endsWith('/')
      ? workspace.rootPath
      : `${workspace.rootPath}/`
    for (const [index, repository] of workspace.repositories.entries()) {
      if (repositoryIds.has(repository.repositoryId)) {
        context.addIssue({
          code: 'custom',
          message: 'Repository IDs must be unique',
          path: ['repositories', index, 'repositoryId'],
        })
      }
      if (repositoryPaths.has(repository.path)) {
        context.addIssue({
          code: 'custom',
          message: 'Repository paths must be unique',
          path: ['repositories', index, 'path'],
        })
      }
      if (!repository.path.startsWith(workspacePrefix)) {
        context.addIssue({
          code: 'custom',
          message: 'Repository path must be a child of the workspace root',
          path: ['repositories', index, 'path'],
        })
      }
      repositoryIds.add(repository.repositoryId)
      repositoryPaths.add(repository.path)
    }
    if (!repositoryIds.has(workspace.primaryRepositoryId)) {
      context.addIssue({
        code: 'custom',
        message: 'Primary repository must belong to the workspace',
        path: ['primaryRepositoryId'],
      })
    }
  })
  .readonly()

export const AgentExecutionInputSchema = z
  .strictObject({
    executionId: AgentExecutionIdSchema,
    runId: RunIdSchema,
    nodeId: NodeIdSchema,
    workspace: AgentWorkspaceSchema,
    model: z.string().trim().min(1).max(256).optional(),
    thinkingLevel: HarnessThinkingLevelSchema.optional(),
    renderedPrompt: content,
    declaredOutcomes: z.array(OutcomeNameSchema).min(1).max(32).readonly(),
    timeoutSeconds: z.number().int().positive().safe(),
  })
  .superRefine((input, context) => {
    if (new Set(input.declaredOutcomes).size !== input.declaredOutcomes.length) {
      context.addIssue({
        code: 'custom',
        message: 'Declared outcomes must be unique',
        path: ['declaredOutcomes'],
      })
    }
  })
  .readonly()

const AgentEvidenceSchema = z
  .strictObject({
    kind: z.enum(['command', 'test', 'file', 'url', 'note']),
    value: boundedText,
  })
  .readonly()

export const AgentNodeResultSchema = z
  .strictObject({
    outcome: OutcomeNameSchema,
    summary: z.string().trim().min(1).max(4_096),
    data: z.json(),
    evidence: z.array(AgentEvidenceSchema).max(128).readonly(),
  })
  .readonly()

const AgentUsageSchema = z
  .strictObject({
    inputTokens: tokenCount,
    outputTokens: tokenCount,
    cacheReadTokens: tokenCount,
    cacheWriteTokens: tokenCount,
  })
  .readonly()

const eventBase = {
  executionId: AgentExecutionIdSchema,
  runId: RunIdSchema,
  nodeId: NodeIdSchema,
  timestamp: z.iso.datetime({ offset: true }),
}

const toolCallId = z.string().min(1).max(512)
const toolName = z.string().min(1).max(128)

const AgentStartedEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal('AGENT_STARTED'),
  data: z.strictObject({}),
})

const AgentSessionIdentifiedEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal('AGENT_SESSION_IDENTIFIED'),
  data: z.strictObject({ sessionId: identifier }),
})

const AgentMessageEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal('AGENT_MESSAGE'),
  data: z.strictObject({ content }),
})

const AgentReasoningEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal('AGENT_REASONING'),
  data: z.strictObject({ content }),
})

const HarnessEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal('HARNESS_EVENT'),
  data: z.strictObject({ harnessId: HarnessIdSchema, event: z.json() }),
})

const AgentToolStartedEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal('AGENT_TOOL_STARTED'),
  data: z.strictObject({
    toolCallId,
    toolName,
    input: z.json().optional(),
  }),
})

const AgentToolUpdatedEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal('AGENT_TOOL_UPDATED'),
  data: z.strictObject({ toolCallId, content }),
})

const AgentToolCompletedEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal('AGENT_TOOL_COMPLETED'),
  data: z.strictObject({
    toolCallId,
    toolName,
    status: z.enum(['succeeded', 'failed']),
    content,
  }),
})

const AgentSkillInvokedEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal('AGENT_SKILL_INVOKED'),
  data: z.strictObject({
    skillName: z.string().min(1).max(128).regex(OPAQUE_ID_PATTERN),
    evidence: z.enum(['DIRECT', 'DERIVED']),
    sourceToolCallId: toolCallId.optional(),
  }),
})

const AgentResultEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal('AGENT_RESULT'),
  data: z.strictObject({
    result: AgentNodeResultSchema,
    usage: AgentUsageSchema,
    durationMs,
  }),
})

const AgentFailedEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal('AGENT_FAILED'),
  data: z.strictObject({
    code: z.string().min(1).max(128).regex(ERROR_CODE_PATTERN),
    message: z.string().trim().min(1).max(4_096),
    durationMs,
  }),
})

const AgentCancelledEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal('AGENT_CANCELLED'),
  data: z.strictObject({
    reason: z.string().trim().min(1).max(1_024),
    durationMs,
  }),
})

export const AgentExecutionEventSchema = z.discriminatedUnion('type', [
  AgentStartedEventSchema,
  AgentSessionIdentifiedEventSchema,
  AgentMessageEventSchema,
  AgentReasoningEventSchema,
  HarnessEventSchema,
  AgentToolStartedEventSchema,
  AgentToolUpdatedEventSchema,
  AgentToolCompletedEventSchema,
  AgentSkillInvokedEventSchema,
  AgentResultEventSchema,
  AgentFailedEventSchema,
  AgentCancelledEventSchema,
])

export const AgentCancelResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('cancelled') }),
  z.strictObject({ status: z.literal('unconfirmed') }),
])

export type AgentExecutionId = z.infer<typeof AgentExecutionIdSchema>
export type AgentWorkspace = z.infer<typeof AgentWorkspaceSchema>
export type AgentExecutionInput = z.infer<typeof AgentExecutionInputSchema>
export type AgentNodeResult = z.infer<typeof AgentNodeResultSchema>
export type AgentExecutionEvent = z.infer<typeof AgentExecutionEventSchema>
export type AgentCancelResult = z.infer<typeof AgentCancelResultSchema>

export interface AgentExecutor {
  execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent>
  cancel(executionId: AgentExecutionId): Promise<AgentCancelResult>
}
