export type SkillCatalogErrorCode =
  | 'SKILL_CONFLICT'
  | 'SKILL_ID_INVALID'
  | 'SKILL_INVALID'
  | 'SKILL_LIMIT_EXCEEDED'
  | 'SKILL_NOT_FOUND'
  | 'SKILL_READ_ONLY'
  | 'SKILL_SYMLINK_FORBIDDEN'

export class SkillCatalogError extends Error {
  override readonly name = 'SkillCatalogError'

  constructor(
    readonly code: SkillCatalogErrorCode,
    options?: Readonly<{ cause?: unknown }>,
  ) {
    super(code, options?.cause === undefined ? undefined : { cause: options.cause })
  }
}

export interface SkillFile {
  readonly path: string
  readonly content: string
  readonly size: number
}

export interface SkillRecord {
  readonly skillId: string
  readonly name: string
  readonly displayName?: string
  readonly description: string
  readonly digest: string
  readonly modifiedAt: string
  readonly valid: boolean
  readonly issues: readonly string[]
  readonly files: readonly SkillFile[]
  readonly readOnly?: boolean
}

export interface CreateSkillInput {
  readonly markdown: string
}

export interface UpdateSkillInput {
  readonly expectedDigest: string
  readonly files: Readonly<Record<string, string>>
}

export interface SkillCatalog {
  refresh(): Promise<readonly SkillRecord[]>
  get(skillId: string): Promise<SkillRecord>
  create(input: CreateSkillInput): Promise<SkillRecord>
  update(skillId: string, input: UpdateSkillInput): Promise<SkillRecord>
  delete(skillId: string, input: Readonly<{ expectedDigest: string }>): Promise<void>
}

export interface SkillSnapshot {
  readonly snapshotId: string
  readonly skillId: string
  readonly name: string
  readonly description: string
  readonly digest: string
  readonly path: string
}

export interface SkillSnapshotStore {
  capture(skill: SkillRecord): Promise<SkillSnapshot>
  get(digest: string): Promise<SkillSnapshot | undefined>
}
