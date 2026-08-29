import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  ResourceRevisionSchema,
  calculateResourceRevision,
  createAtomicJsonResourceIO,
} from '../../src/index.js'

const directories: string[] = []
const schema = z.strictObject({ schemaVersion: z.literal(1), name: z.string().min(1) })

const createPath = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'slopify-resource-revision-'))
  directories.push(directory)
  return join(directory, 'resource.json')
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('resource revisions', () => {
  it('uses stable lowercase SHA-256 revisions', () => {
    expect(calculateResourceRevision('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    )
    expect(ResourceRevisionSchema.safeParse(calculateResourceRevision('different')).success).toBe(
      true,
    )
  })

  it('returns the revision of the exact bytes that were read and written', async () => {
    const path = createPath()
    const resources = createAtomicJsonResourceIO()

    const written = await resources.writeVersioned({
      path,
      schema,
      value: { schemaVersion: 1, name: 'Initial' },
      expectedRevision: null,
    })
    expect(written.revision).toBe(calculateResourceRevision(readFileSync(path)))
    await expect(resources.readVersioned({ path, schema })).resolves.toEqual(written)
  })

  it('does not overwrite an external edit when the expected revision is stale', async () => {
    const path = createPath()
    const resources = createAtomicJsonResourceIO()
    const initial = await resources.writeVersioned({
      path,
      schema,
      value: { schemaVersion: 1, name: 'Initial' },
      expectedRevision: null,
    })
    const externalContents = `${JSON.stringify({ schemaVersion: 1, name: 'External' }, null, 2)}\n`
    writeFileSync(path, externalContents)

    await expect(
      resources.writeVersioned({
        path,
        schema,
        value: { schemaVersion: 1, name: 'Stale UI save' },
        expectedRevision: initial.revision,
      }),
    ).rejects.toMatchObject({
      name: 'FilesystemResourceError',
      code: 'RESOURCE_REVISION_CONFLICT',
    })
    expect(readFileSync(path, 'utf8')).toBe(externalContents)

    const external = await resources.readVersioned({ path, schema })
    await expect(
      resources.writeVersioned({
        path,
        schema,
        value: { schemaVersion: 1, name: 'Accepted UI save' },
        expectedRevision: external.revision,
      }),
    ).resolves.toMatchObject({ value: { name: 'Accepted UI save' } })
  })

  it('supports create-only writes without replacing an existing file', async () => {
    const path = createPath()
    const resources = createAtomicJsonResourceIO()
    await resources.write({ path, schema, value: { schemaVersion: 1, name: 'Existing' } })

    await expect(
      resources.writeVersioned({
        path,
        schema,
        value: { schemaVersion: 1, name: 'Replacement' },
        expectedRevision: null,
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_REVISION_CONFLICT' })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ name: 'Existing' })
  })
})
