import { SettingsSchema, UpdateSettingsRequestSchema, type Settings } from '@slopify/shared'
import {
  SettingsRevisionSchema,
  type SettingsRecord,
  type SettingsRevision,
  type SettingsStore,
  type VersionedSettingsRecord,
} from '../index.js'
import type { Context, Hono } from 'hono'

import { ApiApplicationError, parseJsonBody } from '../api-error.js'

const MISSING_ETAG = '"missing"'

const responseSettings = (record: SettingsRecord): Settings =>
  SettingsSchema.parse({
    schemaVersion: record.schemaVersion,
    appearance: record.appearance,
    git: {
      connections: record.git.connections.map((connection) => ({
        provider: connection.provider,
        accountUsername: connection.accountUsername,
        connectedAt: connection.connectedAt,
        updatedAt: connection.updatedAt,
      })),
    },
  })

const etag = (revision: SettingsRevision | null): string =>
  revision === null ? MISSING_ETAG : `"${revision}"`

const expectedRevision = (header: string | undefined): SettingsRevision | null => {
  if (header === undefined)
    throw new ApiApplicationError({
      status: 428,
      code: 'SETTINGS_PRECONDITION_REQUIRED',
      message: 'If-Match is required when updating settings',
    })
  if (header === MISSING_ETAG) return null
  const match = /^"([a-f0-9]{64})"$/u.exec(header)
  if (match?.[1] === undefined)
    throw new ApiApplicationError({
      status: 400,
      code: 'SETTINGS_ETAG_INVALID',
      message: 'If-Match must contain one current settings ETag',
    })
  return SettingsRevisionSchema.parse(match[1])
}

const jsonResponse = (context: Context, snapshot: VersionedSettingsRecord): Response => {
  context.header('ETag', etag(snapshot.revision))
  context.header('Cache-Control', 'no-store')
  return context.json(responseSettings(snapshot.value), 200)
}

export const registerSettingsRoutes = (app: Hono, settings: SettingsStore): void => {
  app.get('/api/settings', async (context) => jsonResponse(context, await settings.read()))

  app.patch('/api/settings', async (context) => {
    const input = UpdateSettingsRequestSchema.parse(await parseJsonBody(context))
    const expected = expectedRevision(context.req.header('if-match'))
    const current = await settings.read()
    if (current.revision !== expected)
      throw new ApiApplicationError({
        status: 412,
        code: 'SETTINGS_REVISION_CONFLICT',
        message: 'Settings changed since they were read',
      })
    const updated = await settings.write({
      value: { ...current.value, appearance: input.appearance },
      expectedRevision: current.revision,
    })
    return jsonResponse(context, updated)
  })
}
