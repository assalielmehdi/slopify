import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  calculateResourceRevision,
  createAtomicJsonResourceIO,
  type FilesystemResourceError,
} from '../../src/index.js'

const directories: string[] = []
const schema = z.strictObject({ schemaVersion: z.literal(1), name: z.string().min(1) })

const createDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'slopify-atomic-json-'))
  directories.push(directory)
  return directory
}

const rejectsWith = async (promise: Promise<unknown>, code: FilesystemResourceError['code']) => {
  await expect(promise).rejects.toMatchObject({ name: 'FilesystemResourceError', code })
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('atomic JSON resources', () => {
  it('reads the exact source bytes with their revision', async () => {
    const directory = createDirectory()
    const path = join(directory, 'resource.json')
    const source = '{ "schemaVersion": 1, "name": "Slopify" }\n'
    writeFileSync(path, source)

    await expect(createAtomicJsonResourceIO().readSource({ path })).resolves.toEqual({
      source,
      revision: calculateResourceRevision(source),
    })
  })

  it('writes validated JSON atomically with owner-only permissions', async () => {
    const directory = createDirectory()
    const path = join(directory, 'nested', 'resource.json')
    const resources = createAtomicJsonResourceIO()

    await expect(
      resources.write({ path, schema, value: { schemaVersion: 1, name: 'Slopify' } }),
    ).resolves.toEqual({ schemaVersion: 1, name: 'Slopify' })

    expect(readFileSync(path, 'utf8')).toBe(
      `${JSON.stringify({ schemaVersion: 1, name: 'Slopify' }, null, 2)}\n`,
    )
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(statSync(join(directory, 'nested')).mode & 0o777).toBe(0o700)
    expect(readdirSync(join(directory, 'nested'))).toEqual(['resource.json'])
  })

  it('preserves the previous resource when the atomic commit fails', async () => {
    const directory = createDirectory()
    const path = join(directory, 'resource.json')
    const resources = createAtomicJsonResourceIO()
    await resources.write({ path, schema, value: { schemaVersion: 1, name: 'Before' } })
    const failingResources = createAtomicJsonResourceIO({
      async commit() {
        throw new Error('simulated rename interruption')
      },
    })

    await rejectsWith(
      failingResources.write({ path, schema, value: { schemaVersion: 1, name: 'After' } }),
      'RESOURCE_WRITE_FAILED',
    )

    await expect(resources.read({ path, schema })).resolves.toEqual({
      schemaVersion: 1,
      name: 'Before',
    })
    expect(readdirSync(directory)).toEqual(['resource.json'])
  })

  it('returns typed errors for missing, oversized, malformed, and invalid resources', async () => {
    const directory = createDirectory()
    const resources = createAtomicJsonResourceIO()
    const path = join(directory, 'resource.json')

    await rejectsWith(resources.read({ path, schema }), 'RESOURCE_NOT_FOUND')
    writeFileSync(path, 'x'.repeat(33))
    await rejectsWith(resources.read({ path, schema, maxBytes: 32 }), 'RESOURCE_TOO_LARGE')
    writeFileSync(path, '{')
    await rejectsWith(resources.read({ path, schema }), 'RESOURCE_MALFORMED')
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, name: '' }))
    await rejectsWith(resources.read({ path, schema }), 'RESOURCE_VALIDATION_FAILED')
  })

  it('rejects oversized writes before replacing an existing resource', async () => {
    const directory = createDirectory()
    const path = join(directory, 'resource.json')
    const resources = createAtomicJsonResourceIO()
    await resources.write({ path, schema, value: { schemaVersion: 1, name: 'Before' } })

    await rejectsWith(
      resources.write({
        path,
        schema,
        value: { schemaVersion: 1, name: 'A value that exceeds the configured bound' },
        maxBytes: 32,
      }),
      'RESOURCE_TOO_LARGE',
    )
    await expect(resources.read({ path, schema })).resolves.toMatchObject({ name: 'Before' })
  })

  it('rejects schema outputs that cannot represent a JSON document', async () => {
    const directory = createDirectory()
    const path = join(directory, 'resource.json')

    await rejectsWith(
      createAtomicJsonResourceIO().write({ path, schema: z.undefined(), value: undefined }),
      'RESOURCE_VALIDATION_FAILED',
    )
  })

  it('never follows a symbolic link while reading or writing', async () => {
    const directory = createDirectory()
    const target = join(directory, 'target.json')
    const link = join(directory, 'resource.json')
    writeFileSync(target, JSON.stringify({ schemaVersion: 1, name: 'Target' }))
    symlinkSync(target, link)
    const resources = createAtomicJsonResourceIO()

    await rejectsWith(resources.read({ path: link, schema }), 'RESOURCE_SYMLINK_NOT_ALLOWED')
    await rejectsWith(
      resources.write({ path: link, schema, value: { schemaVersion: 1, name: 'Replacement' } }),
      'RESOURCE_SYMLINK_NOT_ALLOWED',
    )
    expect(readFileSync(target, 'utf8')).toBe(JSON.stringify({ schemaVersion: 1, name: 'Target' }))
  })
})
