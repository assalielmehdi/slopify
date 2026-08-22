import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ensureGuestGlabBinary } from '../src/index.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('guest glab provisioner', () => {
  it('copies a trusted Linux binary into the versioned guest tool cache', async () => {
    const root = await mkdtemp(join(tmpdir(), 'slopify-glab-'))
    roots.push(root)
    const sourcePath = join(root, 'source-glab')
    await writeFile(sourcePath, 'official-glab-binary')
    await chmod(sourcePath, 0o755)

    const path = await ensureGuestGlabBinary({
      root: join(root, 'tools'),
      sourcePath,
      architecture: 'arm64',
    })

    await expect(readFile(path, 'utf8')).resolves.toBe('official-glab-binary')
    expect((await stat(path)).mode & 0o111).toBe(0o111)
    await expect(
      ensureGuestGlabBinary({
        root: join(root, 'tools'),
        sourcePath: join(root, 'missing'),
        architecture: 'arm64',
      }),
    ).resolves.toBe(path)
  })

  it('rejects an unsupported guest architecture before downloading', async () => {
    const root = await mkdtemp(join(tmpdir(), 'slopify-glab-'))
    roots.push(root)

    await expect(ensureGuestGlabBinary({ root, architecture: 'riscv64' })).rejects.toThrow(
      'Unsupported glab guest architecture',
    )
  })
})
