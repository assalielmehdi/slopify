import type { DeletionReceipt, GitProvider } from '@slopify/contracts'

export interface RepositoryRecord {
  readonly repositoryId: string
  readonly name: string
  readonly provider: GitProvider
  readonly remoteId: string
  readonly fullName: string
  readonly cloneUrl: string
  readonly webUrl: string
  readonly defaultBranch: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface RepositoryStore {
  add(repository: RepositoryRecord): void
  get(repositoryId: string): RepositoryRecord | undefined
  findByRemote(provider: GitProvider, remoteId: string): RepositoryRecord | undefined
  list(): readonly RepositoryRecord[]
  stageDeletion(receipt: DeletionReceipt): boolean
  restoreDeletion(deletionId: string, now: string): 'UNDONE' | 'EXPIRED' | 'NOT_FOUND'
  purgeExpired(now: string): void
}
