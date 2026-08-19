import { RepositoryIdSchema } from '@loop/contracts'
import { z } from 'zod'

const boundedText = z.string().trim().min(1).max(16_384)
const singleLineText = z.string().trim().min(1).max(512)

export const MergeRequestTemplateInputSchema = z.strictObject({
  task: z.strictObject({
    taskId: singleLineText,
    title: singleLineText,
    url: z.url().max(4_096),
  }),
  repository: z.strictObject({
    repositoryId: RepositoryIdSchema,
    displayName: singleLineText,
    sourceBranch: singleLineText,
    targetBranch: singleLineText,
  }),
  summary: boundedText,
  changes: z.array(boundedText).min(1).max(128).readonly(),
  verification: z.array(boundedText).min(1).max(128).readonly(),
  risks: z.array(boundedText).max(128).readonly(),
  rollback: boundedText,
})

export const RenderedMergeRequestTemplateSchema = z.strictObject({
  templateVersion: z.literal('merge-request-v1'),
  title: z.string().trim().min(1).max(255),
  body: z.string().trim().min(1).max(1_000_000),
})

export type MergeRequestTemplateInput = z.input<typeof MergeRequestTemplateInputSchema>
export type RenderedMergeRequestTemplate = z.infer<typeof RenderedMergeRequestTemplateSchema>

export class MergeRequestTemplateError extends Error {
  override readonly name = 'MergeRequestTemplateError'
  readonly code = 'MR_TEMPLATE_INPUT_INVALID'

  constructor() {
    super('Merge request template input is invalid')
  }
}

const oneLine = (value: string): string => value.trim().replace(/\s+/gu, ' ')
const bullet = (value: string): string => `- ${oneLine(value)}`
const escapeLinkLabel = (value: string): string => value.replace(/[\\\[\]]/gu, '\\$&')

export const renderMergeRequestTemplate = (
  inputValue: MergeRequestTemplateInput,
): RenderedMergeRequestTemplate => {
  const parsed = MergeRequestTemplateInputSchema.safeParse(inputValue)
  if (!parsed.success) throw new MergeRequestTemplateError()
  const input = parsed.data
  const taskId = oneLine(input.task.taskId)
  const taskTitle = oneLine(input.task.title)
  const titlePrefix = `[${taskId}] `
  const title = `${titlePrefix}${taskTitle.slice(0, 255 - titlePrefix.length)}`
  const risks = input.risks.length === 0 ? ['- No known risks.'] : input.risks.map(bullet)
  const body = [
    '## Task',
    '',
    `[${escapeLinkLabel(`${taskId} — ${taskTitle}`)}](${input.task.url})`,
    '',
    '## Summary',
    '',
    input.summary.trim(),
    '',
    '## Changes',
    '',
    ...input.changes.map(bullet),
    '',
    '## Verification',
    '',
    ...input.verification.map(bullet),
    '',
    '## Risks',
    '',
    ...risks,
    '',
    '## Rollback',
    '',
    input.rollback.trim(),
  ].join('\n')
  const rendered = RenderedMergeRequestTemplateSchema.safeParse({
    templateVersion: 'merge-request-v1',
    title,
    body,
  })
  if (!rendered.success) throw new MergeRequestTemplateError()
  return rendered.data
}
