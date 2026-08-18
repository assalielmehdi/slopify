import { z } from 'zod'

const boundedText = z.string().max(1_000_000)
const identifier = z.union([z.string().trim().min(1).max(128), z.number().safe()]).transform(String)

const ClickUpStatusResponseSchema = z
  .looseObject({
    id: identifier.optional(),
    status: z.string().trim().min(1).max(256).optional(),
    status_name: z.string().trim().min(1).max(256).optional(),
    type: z.string().trim().min(1).max(128).optional(),
    status_type: z.string().trim().min(1).max(128).optional(),
  })
  .refine((status) => status.status !== undefined || status.status_name !== undefined)

const ClickUpPriorityResponseSchema = z
  .looseObject({
    id: identifier,
    priority: z.string().trim().min(1).max(128).optional(),
    name: z.string().trim().min(1).max(128).optional(),
  })
  .refine((priority) => priority.priority !== undefined || priority.name !== undefined)

export const ClickUpTaskResponseSchema = z.looseObject({
  id: z.string().trim().min(1).max(128),
  custom_id: z.string().trim().min(1).max(128).nullable().optional(),
  name: z.string().trim().min(1).max(10_000),
  description: boundedText.nullable().optional(),
  text_content: boundedText.nullable().optional(),
  status: ClickUpStatusResponseSchema,
  priority: ClickUpPriorityResponseSchema.nullable(),
  url: z.url().max(4_096),
  attachments: z.array(z.unknown()).max(1_000).optional(),
})

export type ClickUpTaskResponse = z.infer<typeof ClickUpTaskResponseSchema>
