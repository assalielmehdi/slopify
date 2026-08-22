export interface ProjectRecord {
  readonly projectId: string
  readonly name: string
  readonly repositoryPath: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface ProjectRepository {
  add(project: ProjectRecord): void
  get(projectId: string): ProjectRecord | undefined
  findByPath(repositoryPath: string): ProjectRecord | undefined
  list(): readonly ProjectRecord[]
  stageDeletion(receipt: DeletionReceipt): boolean
  restoreDeletion(deletionId: string, now: string): 'UNDONE' | 'EXPIRED' | 'NOT_FOUND'
  purgeExpired(now: string): void
}
import type { DeletionReceipt } from '@slopify/contracts'
