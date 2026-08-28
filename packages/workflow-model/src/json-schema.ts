import { z } from 'zod'

import { WorkflowFileSchema } from './schemas.js'

export function createWorkflowFileJsonSchema() {
  return {
    ...z.toJSONSchema(WorkflowFileSchema, {
      target: 'draft-2020-12',
      io: 'input',
      cycles: 'throw',
      reused: 'inline',
    }),
    $id: 'https://schemas.slopify.local/workflow.v3.schema.json',
    title: 'Slopify workflow v3',
  }
}
