import { createHash, randomUUID } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import {
  SkillCatalogError,
  type CreateSkillInput,
  type SkillCatalog,
  type SkillFile,
  type SkillRecord,
  type SkillSnapshotStore,
  type UpdateSkillInput,
} from './skill-catalog.js'

const SKILL_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u
const DIGEST = /^[a-f0-9]{64}$/u
const MAX_FILES = 128
const MAX_BYTES = 5_000_000

const validateSkillId = (skillId: string): string => {
  if (!SKILL_ID.test(skillId) || skillId.length > 128)
    throw new SkillCatalogError('SKILL_ID_INVALID')
  return skillId
}

const validateRelativeFile = (path: string): string => {
  if (
    path === '' ||
    isAbsolute(path) ||
    path.includes('\\') ||
    path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new SkillCatalogError('SKILL_ID_INVALID')
  }
  return path
}

const ensureInside = (root: string, path: string): void => {
  const child = relative(root, path)
  if (child === '' || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child))
    throw new SkillCatalogError('SKILL_ID_INVALID')
}

const digestFiles = (files: readonly SkillFile[]): string => {
  const hash = createHash('sha256')
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(String(Buffer.byteLength(file.path)))
    hash.update(':')
    hash.update(file.path)
    hash.update(':')
    hash.update(String(file.size))
    hash.update(':')
    hash.update(file.content)
    hash.update('\n')
  }
  return hash.digest('hex')
}

const parseFrontmatter = (
  content: string,
): Readonly<{
  name?: string
  description?: string
  issues: readonly string[]
}> => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content)
  if (match === null) return { issues: ['SKILL.md must start with YAML frontmatter'] }
  const values = new Map<string, string>()
  for (const line of (match[1] ?? '').split(/\r?\n/u)) {
    const separator = line.indexOf(':')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    const raw = line.slice(separator + 1).trim()
    const value = raw.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/u, '$1$2')
    values.set(key, value)
  }
  const name = values.get('name')
  const description = values.get('description')
  const issues = [
    ...(name === undefined || !SKILL_ID.test(name) ? ['Frontmatter name is invalid'] : []),
    ...(description === undefined || description.trim() === ''
      ? ['Frontmatter description is required']
      : []),
  ]
  return {
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    issues,
  }
}

const readDirectory = async (root: string, directory = root): Promise<readonly SkillFile[]> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: SkillFile[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = join(directory, entry.name)
    ensureInside(root, absolute)
    const metadata = await lstat(absolute)
    if (metadata.isSymbolicLink()) throw new SkillCatalogError('SKILL_SYMLINK_FORBIDDEN')
    if (metadata.isDirectory()) files.push(...(await readDirectory(root, absolute)))
    else if (metadata.isFile()) {
      const content = await readFile(absolute, 'utf8')
      files.push({
        path: relative(root, absolute).split(sep).join('/'),
        content,
        size: metadata.size,
      })
    }
    if (files.length > MAX_FILES || files.reduce((total, file) => total + file.size, 0) > MAX_BYTES)
      throw new SkillCatalogError('SKILL_LIMIT_EXCEEDED')
  }
  return files
}

const readSkill = async (root: string, skillIdInput: string): Promise<SkillRecord> => {
  const skillId = validateSkillId(skillIdInput)
  const directory = resolve(root, skillId)
  ensureInside(root, directory)
  let metadata
  try {
    metadata = await lstat(directory)
  } catch (cause) {
    throw new SkillCatalogError('SKILL_NOT_FOUND', { cause })
  }
  if (metadata.isSymbolicLink()) throw new SkillCatalogError('SKILL_SYMLINK_FORBIDDEN')
  if (!metadata.isDirectory()) throw new SkillCatalogError('SKILL_INVALID')
  const files = await readDirectory(directory)
  const skillFile = files.find(({ path }) => path === 'SKILL.md')
  const frontmatter =
    skillFile === undefined
      ? { issues: ['SKILL.md is required'] as readonly string[] }
      : parseFrontmatter(skillFile.content)
  const issues = [...frontmatter.issues]
  return Object.freeze({
    skillId,
    name: frontmatter.name ?? skillId,
    description: frontmatter.description ?? '',
    digest: digestFiles(files),
    modifiedAt: metadata.mtime.toISOString(),
    valid: issues.length === 0,
    issues: Object.freeze(issues),
    files: Object.freeze(files.map((file) => Object.freeze(file))),
  })
}

const validateFiles = (files: Readonly<Record<string, string>>): readonly [string, string][] => {
  const entries = Object.entries(files)
  if (entries.length === 0 || entries.length > MAX_FILES)
    throw new SkillCatalogError('SKILL_LIMIT_EXCEEDED')
  let bytes = 0
  for (const [path, content] of entries) {
    validateRelativeFile(path)
    bytes += Buffer.byteLength(content)
    if (bytes > MAX_BYTES) throw new SkillCatalogError('SKILL_LIMIT_EXCEEDED')
  }
  return entries
}

const writeTree = async (
  directory: string,
  files: Readonly<Record<string, string>>,
): Promise<void> => {
  for (const [path, content] of validateFiles(files)) {
    const target = join(directory, path)
    ensureInside(directory, target)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, { flag: 'wx' })
  }
}

const replaceTree = async (
  root: string,
  skillId: string,
  files: Readonly<Record<string, string>>,
  existing: boolean,
): Promise<void> => {
  const target = join(root, skillId)
  const staging = join(root, `.${skillId}.tmp-${randomUUID()}`)
  const backup = join(root, `.${skillId}.backup-${randomUUID()}`)
  await mkdir(staging, { recursive: false })
  try {
    await writeTree(staging, files)
    if (existing) await rename(target, backup)
    try {
      await rename(staging, target)
    } catch (cause) {
      if (existing) await rename(backup, target)
      throw cause
    }
    if (existing) await rm(backup, { recursive: true, force: true })
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

const skillMarkdown = (input: CreateSkillInput): string =>
  `---\nname: ${input.name}\ndescription: ${input.description}\n---\n\n${input.instructions.trim()}\n`

export const createFilesystemSkillCatalog = (options: Readonly<{ root: string }>): SkillCatalog => {
  const root = resolve(options.root)
  const initialize = () => mkdir(root, { recursive: true })
  return {
    async refresh() {
      await initialize()
      const entries = await readdir(root, { withFileTypes: true })
      const skills: SkillRecord[] = []
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (!entry.name.startsWith('.') && (entry.isDirectory() || entry.isSymbolicLink()))
          skills.push(await readSkill(root, entry.name))
      }
      return Object.freeze(skills)
    },
    async get(skillId) {
      await initialize()
      return readSkill(root, skillId)
    },
    async create(input) {
      await initialize()
      const skillId = validateSkillId(input.skillId)
      if (
        input.name !== skillId ||
        input.description.trim() === '' ||
        input.instructions.trim() === ''
      )
        throw new SkillCatalogError('SKILL_INVALID')
      try {
        await stat(join(root, skillId))
        throw new SkillCatalogError('SKILL_CONFLICT')
      } catch (cause) {
        if (cause instanceof SkillCatalogError) throw cause
      }
      await replaceTree(root, skillId, { 'SKILL.md': skillMarkdown(input), ...input.files }, false)
      return readSkill(root, skillId)
    },
    async update(skillIdInput, input: UpdateSkillInput) {
      await initialize()
      const skillId = validateSkillId(skillIdInput)
      const current = await readSkill(root, skillId)
      if (current.digest !== input.expectedDigest) throw new SkillCatalogError('SKILL_CONFLICT')
      await replaceTree(root, skillId, input.files, true)
      return readSkill(root, skillId)
    },
    async delete(skillIdInput, input) {
      await initialize()
      const skillId = validateSkillId(skillIdInput)
      const current = await readSkill(root, skillId)
      if (current.digest !== input.expectedDigest) throw new SkillCatalogError('SKILL_CONFLICT')
      await rm(join(root, skillId), { recursive: true, force: false })
    },
  }
}

const writeSnapshot = async (root: string, skill: SkillRecord): Promise<string> => {
  const target = join(root, skill.digest)
  try {
    await stat(target)
    return target
  } catch {
    // Continue with content-addressed creation.
  }
  const staging = join(root, `.${skill.digest}.tmp-${randomUUID()}`)
  await mkdir(staging, { recursive: true })
  try {
    await writeTree(
      staging,
      Object.fromEntries(skill.files.map((file) => [file.path, file.content])),
    )
    for (const file of skill.files) await chmod(join(staging, file.path), 0o444)
    await rename(staging, target)
  } catch (cause) {
    try {
      await stat(target)
    } catch {
      throw cause
    }
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
  }
  return target
}

export const createFilesystemSkillSnapshotStore = (
  options: Readonly<{ root: string }>,
): SkillSnapshotStore => {
  const root = resolve(options.root)
  return {
    async capture(skill) {
      if (!skill.valid || !DIGEST.test(skill.digest)) throw new SkillCatalogError('SKILL_INVALID')
      await mkdir(root, { recursive: true })
      const path = await writeSnapshot(root, skill)
      return Object.freeze({
        snapshotId: `sha256:${skill.digest}`,
        skillId: skill.skillId,
        name: skill.name,
        description: skill.description,
        digest: skill.digest,
        path,
      })
    },
    async get(digest) {
      if (!DIGEST.test(digest)) return undefined
      const path = join(root, digest)
      try {
        const skill = await readSkill(root, digest)
        return Object.freeze({
          snapshotId: `sha256:${digest}`,
          skillId: basename(path),
          name: skill.name,
          description: skill.description,
          digest,
          path,
        })
      } catch {
        return undefined
      }
    },
  }
}
