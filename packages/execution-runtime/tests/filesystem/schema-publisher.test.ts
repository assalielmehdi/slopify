import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'

import {
  createManagedJsonSchemas,
  publishManagedJsonSchemas,
  resolveSlopifyPaths,
} from '../../src/index.js'

const settings = {
  schemaVersion: 1,
  appearance: { theme: 'system' },
  git: { connections: [] },
} as const

const repositories = {
  schemaVersion: 1,
  repositories: [
    {
      repositoryId: 'repository-api',
      name: 'API',
      provider: 'GITHUB',
      remoteId: '1',
      fullName: 'slopify/api',
      cloneUrl: 'https://github.com/slopify/api.git',
      webUrl: 'https://github.com/slopify/api',
      defaultBranch: 'main',
      createdAt: '2026-08-18T20:00:00Z',
      updatedAt: '2026-08-18T20:00:00Z',
    },
  ],
} as const

describe('managed JSON Schemas', () => {
  it('generates deterministic Draft 2020-12 schemas matching structural fixtures', () => {
    const first = createManagedJsonSchemas()
    const second = createManagedJsonSchemas()

    expect(first).toEqual(second)
    expect(first.map(({ fileName }) => fileName)).toEqual([
      'settings.v1.schema.json',
      'repositories.v1.schema.json',
      'workflow.v2.schema.json',
    ])

    const ajv = new Ajv2020({ strict: true })
    addFormats(ajv)
    const byName = new Map(first.map((managed) => [managed.fileName, managed.schema]))
    const validateSettings = ajv.compile(byName.get('settings.v1.schema.json'))
    const validateRepositories = ajv.compile(byName.get('repositories.v1.schema.json'))

    expect(validateSettings(settings)).toBe(true)
    expect(validateSettings({ ...settings, apiToken: 'secret' })).toBe(false)
    expect(validateRepositories(repositories)).toBe(true)
    expect(validateRepositories({ ...repositories, repositories: 'invalid' })).toBe(false)
  })

  it('publishes owner-only copies and restores modified managed files', async () => {
    const home = await mkdtemp(join(tmpdir(), 'slopify-schema-publisher-'))
    const paths = resolveSlopifyPaths({ environment: { SLOPIFY_HOME: home } })

    await publishManagedJsonSchemas({ paths })

    const managed = createManagedJsonSchemas()
    for (const entry of managed) {
      const path = join(paths.schemasDirectory, entry.fileName)
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(entry.schema)
      expect((await stat(path)).mode & 0o777).toBe(0o600)
    }

    const modifiedPath = join(paths.schemasDirectory, 'workflow.v2.schema.json')
    await writeFile(modifiedPath, '{}\n', 'utf8')
    await chmod(modifiedPath, 0o644)

    await publishManagedJsonSchemas({ paths })

    const workflowSchema = managed.find(({ fileName }) => fileName === 'workflow.v2.schema.json')
    expect(JSON.parse(await readFile(modifiedPath, 'utf8'))).toEqual(workflowSchema?.schema)
    expect((await stat(modifiedPath)).mode & 0o777).toBe(0o600)
  })
})
