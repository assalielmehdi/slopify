import { join } from 'node:path'

import { createWorkflowFileJsonSchema } from '@slopify/workflow-model'
import { z } from 'zod'

import { RepositoryCollectionSchema } from '../repositories/repository-store.js'
import { SettingsRecordSchema } from '../settings/settings-store.js'
import { createAtomicJsonResourceIO, type AtomicJsonResourceIO } from './atomic-json-resource.js'
import { resolveSlopifyPaths, type SlopifyPaths } from './slopify-home.js'

export interface ManagedJsonSchema {
  readonly fileName: string
  readonly schema: Readonly<Record<string, unknown>>
}

const JsonSchemaDocumentSchema = z.record(z.string(), z.json())

const createJsonSchema = (
  schema: z.ZodType,
  fileName: string,
  title: string,
): Readonly<Record<string, unknown>> => ({
  ...z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
    cycles: 'throw',
    reused: 'inline',
  }),
  $id: `https://schemas.slopify.local/${fileName}`,
  title,
})

export function createManagedJsonSchemas(): readonly ManagedJsonSchema[] {
  return Object.freeze([
    Object.freeze({
      fileName: 'settings.v1.schema.json',
      schema: createJsonSchema(
        SettingsRecordSchema,
        'settings.v1.schema.json',
        'Slopify settings v1',
      ),
    }),
    Object.freeze({
      fileName: 'repositories.v1.schema.json',
      schema: createJsonSchema(
        RepositoryCollectionSchema,
        'repositories.v1.schema.json',
        'Slopify repositories v1',
      ),
    }),
    Object.freeze({
      fileName: 'workflow.v2.schema.json',
      schema: createWorkflowFileJsonSchema(),
    }),
  ])
}

export async function publishManagedJsonSchemas(
  options: Readonly<{
    paths?: SlopifyPaths
    resources?: AtomicJsonResourceIO
  }> = {},
): Promise<void> {
  const paths = options.paths ?? resolveSlopifyPaths()
  const resources = options.resources ?? createAtomicJsonResourceIO()

  await Promise.all(
    createManagedJsonSchemas().map(({ fileName, schema }) =>
      resources.write({
        path: join(paths.schemasDirectory, fileName),
        schema: JsonSchemaDocumentSchema,
        value: schema,
      }),
    ),
  )
}
