export interface ProjectRecord {
  readonly projectId: string
  readonly name: string
  readonly repositoryPath: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface ProjectRepository {
  add(project: ProjectRecord): void
  delete(projectId: string): boolean
  get(projectId: string): ProjectRecord | undefined
  findByPath(repositoryPath: string): ProjectRecord | undefined
  list(): readonly ProjectRecord[]
}
