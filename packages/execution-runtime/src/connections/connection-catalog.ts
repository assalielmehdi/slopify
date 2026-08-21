import type { ConnectionCatalogEntry } from '@loop/contracts'

export type { ConnectionCatalogEntry }

export interface ConnectionCatalog {
  list(): readonly ConnectionCatalogEntry[]
}
