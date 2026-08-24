import type { GitProvider } from '@slopify/contracts'

export interface GitConnectionRecord {
  readonly provider: GitProvider
  readonly accountUsername: string
  readonly connectedAt: string
  readonly updatedAt: string
}

export interface GitConnectionRepository {
  get(provider: GitProvider): GitConnectionRecord | undefined
  list(): readonly GitConnectionRecord[]
  save(connection: GitConnectionRecord): void
  delete(provider: GitProvider): boolean
}
