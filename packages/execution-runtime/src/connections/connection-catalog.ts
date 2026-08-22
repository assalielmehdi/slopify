import type { ConnectionCatalogEntry } from '@slopify/contracts'

export type { ConnectionCatalogEntry }

export interface ConnectionCatalog {
  list(): readonly ConnectionCatalogEntry[]
}
