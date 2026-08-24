import type { DeletionReceipt, GitProvider } from '@slopify/contracts'

export interface ProjectRecord {
  readonly projectId: string
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

export interface ProjectRepository {
  add(project: ProjectRecord): void
  get(projectId: string): ProjectRecord | undefined
  findByRemote(provider: GitProvider, remoteId: string): ProjectRecord | undefined
  list(): readonly ProjectRecord[]
  stageDeletion(receipt: DeletionReceipt): boolean
  restoreDeletion(deletionId: string, now: string): 'UNDONE' | 'EXPIRED' | 'NOT_FOUND'
  purgeExpired(now: string): void
}
