import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ConnectionCatalogEntry } from '@slopify/contracts'

export interface BuiltInConnectorSkill {
  readonly skillId: string
  readonly legacySkillIds: readonly string[]
  readonly files: Readonly<Record<string, string>>
}

const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const builtInsRoot = join(moduleDirectory, 'built-ins')

const readTree = (root: string, directory = root): Readonly<Record<string, string>> =>
  Object.fromEntries(
    readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))
      .flatMap((entry) => {
        const absolute = join(directory, entry.name)
        if (entry.isDirectory()) return Object.entries(readTree(root, absolute))
        if (!entry.isFile()) throw new Error(`Built-in skill contains an unsupported file`)
        return [[relative(root, absolute).split(sep).join('/'), readFileSync(absolute, 'utf8')]]
      }),
  )

export const BUILT_IN_CONNECTOR_SKILLS: Readonly<Record<string, BuiltInConnectorSkill>> =
  Object.freeze({
    gitlab: {
      skillId: 'gitlab-connector',
      legacySkillIds: ['slopify-gitlab-connector'],
      files: readTree(join(builtInsRoot, 'gitlab-connector')),
    },
    clickup: {
      skillId: 'clickup-connector',
      legacySkillIds: ['slopify-clickup-connector'],
      files: readTree(join(builtInsRoot, 'clickup-connector')),
    },
  })

const SEED_STATE_FILE = '.slopify-built-in-skills.json'

const writeTree = (root: string, files: Readonly<Record<string, string>>): void => {
  for (const [path, content] of Object.entries(files)) {
    const target = resolve(root, path)
    if (!target.startsWith(`${resolve(root)}${sep}`)) throw new Error('Built-in skill path escapes')
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content, { flag: 'wx' })
  }
}

export const initializeBuiltInConnectorSkills = (input: {
  readonly root: string
  readonly catalog: readonly ConnectionCatalogEntry[]
}): void => {
  mkdirSync(input.root, { recursive: true })
  const markerPath = join(input.root, SEED_STATE_FILE)
  const seeded = new Set<string>(
    existsSync(markerPath)
      ? (JSON.parse(readFileSync(markerPath, 'utf8')) as Readonly<{ skillIds: string[] }>).skillIds
      : [],
  )

  for (const entry of input.catalog.filter(({ category }) => category === 'connector')) {
    const definition = BUILT_IN_CONNECTOR_SKILLS[entry.type]
    if (definition === undefined || entry.skillId !== definition.skillId)
      throw new Error(`Connector ${entry.type} does not have a matching built-in skill`)
    if (seeded.has(definition.skillId)) continue

    for (const legacySkillId of definition.legacySkillIds) {
      if (!seeded.has(legacySkillId)) continue
      const legacyRoot = join(input.root, legacySkillId)
      if (existsSync(legacyRoot) && lstatSync(legacyRoot).isDirectory())
        rmSync(legacyRoot, { recursive: true, force: true })
      seeded.delete(legacySkillId)
    }

    const skillRoot = join(input.root, definition.skillId)
    if (!existsSync(skillRoot)) {
      mkdirSync(skillRoot)
      writeTree(skillRoot, definition.files)
    }
    seeded.add(definition.skillId)
  }

  const temporaryPath = `${markerPath}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify({ skillIds: [...seeded].sort() })}\n`)
  renameSync(temporaryPath, markerPath)
}
