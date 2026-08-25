import { createHash } from 'node:crypto'

import { z } from 'zod'

export const ResourceRevisionSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u)
  .brand<'ResourceRevision'>()

export type ResourceRevision = z.infer<typeof ResourceRevisionSchema>

export const calculateResourceRevision = (source: string | Uint8Array): ResourceRevision =>
  ResourceRevisionSchema.parse(createHash('sha256').update(source).digest('hex'))
