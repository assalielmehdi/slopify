import { ConnectionCatalogEntrySchema, type ConnectionCatalogEntry } from '@slopify/contracts'

import type { ConnectionCatalog } from '../connections/connection-catalog.js'
import type { WorkbenchDatabase } from './database.js'
import { getDatabaseHandle } from './database.js'

interface ConnectionCatalogRow {
  readonly type: string
  readonly category: string
  readonly name: string
  readonly icon: string
  readonly eyebrow: string
  readonly summary: string
  readonly description: string
  readonly setup_json: string
  readonly access: string
  readonly input_label: string | null
  readonly input_description: string | null
  readonly replacement_input_label: string | null
  readonly resource_href: string | null
  readonly resource_label: string | null
}

const optional = (value: string | null): string | undefined => value ?? undefined

const parseRow = (row: ConnectionCatalogRow): ConnectionCatalogEntry =>
  ConnectionCatalogEntrySchema.parse({
    type: row.type,
    category: row.category,
    name: row.name,
    icon: row.icon,
    eyebrow: row.eyebrow,
    summary: row.summary,
    description: row.description,
    setup: JSON.parse(row.setup_json),
    access: row.access,
    credentialLabel: optional(row.input_label),
    credentialDescription: optional(row.input_description),
    replacementLabel: optional(row.replacement_input_label),
    resourceHref: optional(row.resource_href),
    resourceLabel: optional(row.resource_label),
  })

export const createConnectionCatalogRepository = (
  database: WorkbenchDatabase,
): ConnectionCatalog => {
  const connection = getDatabaseHandle(database)
  return {
    list() {
      return (
        connection
          .prepare(
            `SELECT type, category, name, icon, eyebrow, summary, description,
              setup_json, access, input_label, input_description,
              replacement_input_label, resource_href, resource_label
            FROM connection_catalog
            ORDER BY sort_order`,
          )
          .all() as ConnectionCatalogRow[]
      ).map(parseRow)
    },
  }
}
