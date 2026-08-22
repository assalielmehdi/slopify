import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createNativeGitProjectInspector, createProcessRunner } from '../../src/index.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

const createDirectory = (name: string) => {
  const directory = join(tmpdir(), `${name}-${crypto.randomUUID()}`)
  mkdirSync(directory, { recursive: true })
  directories.push(directory)
  return directory
}

describe('native Git project inspector', () => {
  it('recognizes only the root of an existing Git repository', async () => {
    const repositoryPath = createDirectory('slopify-project')
    const nestedPath = join(repositoryPath, 'nested')
    execFileSync('git', ['init', '--quiet', repositoryPath])
    mkdirSync(nestedPath)
    const inspector = createNativeGitProjectInspector({
      processRunner: createProcessRunner({ maxOutputBytes: 8_192 }),
    })

    await expect(inspector.inspect(repositoryPath)).resolves.toMatchObject({
      status: 'AVAILABLE',
      canonicalPath: realpathSync(repositoryPath),
      name: repositoryPath.split('/').at(-1),
    })
    await expect(inspector.inspect(nestedPath)).resolves.toEqual({
      status: 'NOT_GIT_REPOSITORY',
    })
  })

  it('distinguishes missing paths from existing non-Git directories', async () => {
    const directory = createDirectory('not-git')
    const inspector = createNativeGitProjectInspector({
      processRunner: createProcessRunner({ maxOutputBytes: 8_192 }),
    })

    await expect(inspector.inspect(join(directory, 'missing'))).resolves.toEqual({
      status: 'MISSING',
    })
    await expect(inspector.inspect(directory)).resolves.toEqual({
      status: 'NOT_GIT_REPOSITORY',
    })
  })
})
