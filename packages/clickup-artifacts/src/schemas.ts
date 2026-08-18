import { z } from 'zod'

const boundedText = z.string().max(1_000_000)
const identifier = z.union([z.string().trim().min(1).max(128), z.number().safe()]).transform(String)
const timestamp = z
  .union([z.string().trim().min(1).max(32), z.number().safe()])
  .transform(String)
  .refine((value) => /^\d+$/u.test(value) && Number.isSafeInteger(Number(value)))

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

const ClickUpAttachmentResponseSchema = z.looseObject({
  url: z.url().max(4_096).optional(),
})

const ClickUpCommentAuthorResponseSchema = z
  .looseObject({
    username: z.string().trim().min(1).max(10_000).optional(),
    name: z.string().trim().min(1).max(10_000).optional(),
  })
  .refine((author) => author.username !== undefined || author.name !== undefined)

const ClickUpCommentSegmentResponseSchema = z.looseObject({
  text: boundedText,
})

export const ClickUpCommentResponseSchema = z
  .looseObject({
    id: identifier,
    date: timestamp,
    comment: z
      .union([boundedText, z.array(ClickUpCommentSegmentResponseSchema).max(1_000)])
      .optional(),
    comment_text: boundedText.optional(),
    user: ClickUpCommentAuthorResponseSchema.optional(),
    created_by: ClickUpCommentAuthorResponseSchema.optional(),
  })
  .refine((comment) => comment.comment !== undefined || comment.comment_text !== undefined)
  .refine((comment) => comment.user !== undefined || comment.created_by !== undefined)

export const ClickUpCommentsResponseSchema = z.looseObject({
  comments: z.array(ClickUpCommentResponseSchema).max(25),
})

export const ClickUpCreateCommentResponseSchema = z.looseObject({
  id: identifier,
  date: timestamp,
})

export const ClickUpTaskResponseSchema = z.looseObject({
  id: z.string().trim().min(1).max(128),
  custom_id: z.string().trim().min(1).max(128).nullable().optional(),
  name: z.string().trim().min(1).max(10_000),
  description: boundedText.nullable().optional(),
  text_content: boundedText.nullable().optional(),
  status: ClickUpStatusResponseSchema,
  priority: ClickUpPriorityResponseSchema.nullable(),
  url: z.url().max(4_096),
  attachments: z.array(ClickUpAttachmentResponseSchema).max(1_000).optional(),
})

export type ClickUpCommentResponse = z.infer<typeof ClickUpCommentResponseSchema>
export type ClickUpCreateCommentResponse = z.infer<typeof ClickUpCreateCommentResponseSchema>
export type ClickUpTaskResponse = z.infer<typeof ClickUpTaskResponseSchema>
