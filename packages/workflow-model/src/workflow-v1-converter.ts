import { z } from 'zod'

import { WorkflowSchema } from './schemas.js'
import type { Workflow } from './types.js'
import { validateWorkflow } from './validate-workflow.js'

const LegacyWorkflowEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    configuration: z.object({
      projectIds: z.unknown(),
      primaryProjectId: z.unknown(),
      variables: z.unknown(),
    }),
  })
  .passthrough()

export const convertWorkflowV1 = (input: unknown): Workflow => {
  const legacy = LegacyWorkflowEnvelopeSchema.parse(input)
  const { projectIds, primaryProjectId, ...configuration } = legacy.configuration
  const workflow = { ...legacy }
  Reflect.deleteProperty(workflow, 'name')

  const converted = WorkflowSchema.parse({
    ...workflow,
    schemaVersion: 3,
    configuration: {
      ...configuration,
      repositoryIds: projectIds,
      primaryRepositoryId: primaryProjectId,
    },
  })
  const validation = validateWorkflow(converted)
  if (!validation.valid)
    throw new TypeError(validation.findings.map(({ message }) => message).join(' '))
  return validation.workflow
}
