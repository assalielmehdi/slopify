import type { GitProvider } from '@slopify/shared'

export interface GitConnectionRecord {
  readonly provider: GitProvider
  readonly accountUsername: string
  readonly connectedAt: string
  readonly updatedAt: string
}

export interface GitConnectionRepository {
  get(provider: GitProvider): Promise<GitConnectionRecord | undefined>
  list(): Promise<readonly GitConnectionRecord[]>
  save(connection: GitConnectionRecord): Promise<void>
  delete(provider: GitProvider): Promise<boolean>
}
