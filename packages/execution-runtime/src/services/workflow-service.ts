import { WorkflowIdSchema } from '@slopify/contracts'
import {
  PREDEFINED_V1_TRANSITION_LIMIT,
  SkillSnapshotReferenceSchema,
  WorkflowSchema,
  isLinearAgentWorkflow,
  type AgentNode,
  type SkillSnapshotReference,
  type Workflow,
} from '@slopify/workflow-model'

import type { WorkflowRepository } from '../persistence/workflow-repository.js'
import {
  SkillCatalogError,
  type SkillCatalog,
  type SkillSnapshotStore,
} from '../skills/skill-catalog.js'

export type WorkflowServiceErrorCode =
  'WORKFLOW_ID_MISMATCH' | 'WORKFLOW_NOT_FOUND' | 'WORKFLOW_NOT_LINEAR' | 'WORKFLOW_SKILL_MISMATCH'

export class WorkflowServiceError extends Error {
  override readonly name = 'WorkflowServiceError'

  constructor(
    readonly code: WorkflowServiceErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export interface WorkflowService {
  list(): readonly Workflow[]
  get(workflowId: string): Workflow
  update(workflowId: string, workflow: unknown): Promise<Workflow>
}

export const createWorkflowService = (options: {
  readonly workflows: WorkflowRepository
  readonly skills?: SkillCatalog
  readonly skillSnapshots?: SkillSnapshotStore
  readonly connectorSkillIds?: (connectorIds: readonly string[]) => readonly string[]
  readonly now?: () => string
}): WorkflowService => {
  const get = (workflowIdInput: string): Workflow => {
    const workflowId = WorkflowIdSchema.parse(workflowIdInput)
    const workflow = options.workflows.get(workflowId)
    if (workflow === undefined)
      throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Workflow was not found')
    return workflow
  }

  const resolveSkillReference = async (
    requested: SkillSnapshotReference,
    existing: SkillSnapshotReference | undefined,
  ): Promise<SkillSnapshotReference> => {
    if (
      existing !== undefined &&
      existing.skillId === requested.skillId &&
      existing.snapshotId === requested.snapshotId &&
      existing.digest === requested.digest
    ) {
      return existing
    }

    if (options.skills === undefined || options.skillSnapshots === undefined)
      throw new WorkflowServiceError(
        'WORKFLOW_SKILL_MISMATCH',
        'Workflow skill selection no longer matches the live catalog',
      )

    try {
      const live = await options.skills.get(requested.skillId)
      if (!live.valid || live.digest !== requested.digest)
        throw new WorkflowServiceError(
          'WORKFLOW_SKILL_MISMATCH',
          'Workflow skill selection no longer matches the live catalog',
        )
      const snapshot = await options.skillSnapshots.capture(live)
      return SkillSnapshotReferenceSchema.parse({
        skillId: snapshot.skillId,
        snapshotId: snapshot.snapshotId,
        digest: snapshot.digest,
        name: snapshot.name,
        description: snapshot.description,
      })
    } catch (error) {
      if (error instanceof WorkflowServiceError) throw error
      if (error instanceof SkillCatalogError)
        throw new WorkflowServiceError(
          'WORKFLOW_SKILL_MISMATCH',
          'Workflow skill selection no longer matches the live catalog',
        )
      throw error
    }
  }

  const captureSkillReference = async (
    skillId: string,
    existing: SkillSnapshotReference | undefined,
  ): Promise<SkillSnapshotReference> => {
    if (options.skills === undefined || options.skillSnapshots === undefined)
      throw new WorkflowServiceError(
        'WORKFLOW_SKILL_MISMATCH',
        'Workflow connector skill is unavailable',
      )
    try {
      const live = await options.skills.get(skillId)
      if (!live.valid)
        throw new WorkflowServiceError(
          'WORKFLOW_SKILL_MISMATCH',
          'Workflow connector skill is invalid',
        )
      if (existing?.digest === live.digest) return existing
      const snapshot = await options.skillSnapshots.capture(live)
      return SkillSnapshotReferenceSchema.parse({
        skillId: snapshot.skillId,
        snapshotId: snapshot.snapshotId,
        digest: snapshot.digest,
        name: snapshot.name,
        description: snapshot.description,
      })
    } catch (error) {
      if (error instanceof WorkflowServiceError) throw error
      if (error instanceof SkillCatalogError)
        throw new WorkflowServiceError(
          'WORKFLOW_SKILL_MISMATCH',
          'Workflow connector skill is unavailable',
        )
      throw error
    }
  }

  return {
    list: () => options.workflows.list(),
    get,
    async update(workflowIdInput, workflowInput) {
      const workflowId = WorkflowIdSchema.parse(workflowIdInput)
      const existing = get(workflowId)
      const requested = WorkflowSchema.parse(workflowInput)
      if (requested.workflowId !== workflowId)
        throw new WorkflowServiceError(
          'WORKFLOW_ID_MISMATCH',
          'Workflow ID does not match the requested resource',
        )
      if (!isLinearAgentWorkflow(requested))
        throw new WorkflowServiceError(
          'WORKFLOW_NOT_LINEAR',
          'Workflow agents must form one linear chain',
        )

      const existingAgents = new Map(
        existing.nodes
          .filter((node): node is AgentNode => node.type === 'agent')
          .map((node) => [node.id, node]),
      )
      const nodes = await Promise.all(
        requested.nodes.map(async (node) => {
          if (node.type !== 'agent') return node
          const existingAgent = existingAgents.get(node.id)
          const existingReferences = new Map(
            existingAgent?.job.skillSnapshotRefs.map((reference) => [reference.skillId, reference]),
          )
          const skillSnapshotRefs = await Promise.all(
            node.job.skillSnapshotRefs.map((reference) =>
              resolveSkillReference(reference, existingReferences.get(reference.skillId)),
            ),
          )
          const connectorSkillRefs = await Promise.all(
            (options.connectorSkillIds?.(node.job.connectorIds.map(String)) ?? []).map((skillId) =>
              captureSkillReference(
                skillId,
                existingReferences.get(
                  SkillSnapshotReferenceSchema.unwrap().shape.skillId.parse(skillId),
                ),
              ),
            ),
          )
          const allSkillSnapshotRefs = [...skillSnapshotRefs, ...connectorSkillRefs].filter(
            (reference, index, all) =>
              all.findIndex(({ skillId }) => skillId === reference.skillId) === index,
          )
          return {
            ...node,
            ...(existingAgent === undefined
              ? {}
              : {
                  description: existingAgent.description,
                  timeoutSeconds: existingAgent.timeoutSeconds,
                  result: existingAgent.result,
                  sandbox: existingAgent.sandbox,
                }),
            job: { ...node.job, skillSnapshotRefs: allSkillSnapshotRefs },
          }
        }),
      )
      const workflow = WorkflowSchema.parse({
        ...requested,
        workflowId,
        nodes,
        maxTransitions: PREDEFINED_V1_TRANSITION_LIMIT,
        createdAt: existing.createdAt,
        updatedAt: (options.now ?? (() => new Date().toISOString()))(),
      })
      options.workflows.save(workflow)
      return workflow
    },
  }
}
