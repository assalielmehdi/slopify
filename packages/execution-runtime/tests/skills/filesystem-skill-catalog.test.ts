import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp } from 'node:fs/promises'

import { afterEach, describe, expect, it } from 'vitest'

import {
  SkillCatalogError,
  createFilesystemSkillCatalog,
  createFilesystemSkillSnapshotStore,
} from '../../src/index.js'

const roots: string[] = []
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'slopify-skills-'))
  roots.push(root)
  const skillsRoot = join(root, 'skills')
  const snapshotsRoot = join(root, 'snapshots')
  return {
    skillsRoot,
    snapshotsRoot,
    catalog: createFilesystemSkillCatalog({ root: skillsRoot }),
    snapshots: createFilesystemSkillSnapshotStore({ root: snapshotsRoot }),
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('filesystem skill catalog', () => {
  it('uses the filesystem as source of truth and sees external edits on refresh', async () => {
    const { catalog, skillsRoot } = await fixture()
    await catalog.create({
      skillId: 'gitlab-delivery',
      name: 'gitlab-delivery',
      description: 'Deliver through GitLab.',
      instructions: 'Use glab safely.',
    })

    const first = await catalog.refresh()
    expect(first).toHaveLength(1)
    const firstDigest = first[0]?.digest

    await writeFile(
      join(skillsRoot, 'gitlab-delivery', 'SKILL.md'),
      '---\nname: gitlab-delivery\ndescription: Updated externally.\n---\n\nUse glab.\n',
    )
    const refreshed = await catalog.refresh()
    expect(refreshed[0]).toMatchObject({ description: 'Updated externally.' })
    expect(refreshed[0]?.digest).not.toBe(firstDigest)
  })

  it('rejects traversal, symlink escape, and stale optimistic writes', async () => {
    const { catalog, skillsRoot } = await fixture()
    const created = await catalog.create({
      skillId: 'safe-skill',
      name: 'safe-skill',
      description: 'Safe.',
      instructions: 'Stay inside.',
    })

    await expect(catalog.get('../outside')).rejects.toMatchObject({ code: 'SKILL_ID_INVALID' })
    await writeFile(join(skillsRoot, 'safe-skill', 'SKILL.md'), 'external change')
    await expect(
      catalog.update('safe-skill', {
        expectedDigest: created.digest,
        files: { 'SKILL.md': 'replacement' },
      }),
    ).rejects.toMatchObject({ code: 'SKILL_CONFLICT' })

    await mkdir(join(skillsRoot, 'linked'), { recursive: true })
    const target = join(skillsRoot, '..', 'outside.txt')
    await writeFile(target, 'secret')
    await import('node:fs/promises').then(({ symlink }) =>
      symlink(target, join(skillsRoot, 'linked', 'secret.txt')),
    )
    await expect(catalog.get('linked')).rejects.toMatchObject({ code: 'SKILL_SYMLINK_FORBIDDEN' })
  })

  it('snapshots every file by content and keeps old snapshots after live deletion', async () => {
    const { catalog, snapshots, snapshotsRoot } = await fixture()
    const created = await catalog.create({
      skillId: 'delivery',
      name: 'delivery',
      description: 'Delivery skill.',
      instructions: 'Read the reference.',
      files: { 'references/checks.txt': 'pnpm test\n', 'scripts/run.sh': '#!/bin/sh\n' },
    })

    const snapshot = await snapshots.capture(await catalog.get('delivery'))
    expect(snapshot.digest).toBe(created.digest)
    expect(
      await readFile(join(snapshotsRoot, snapshot.digest, 'references/checks.txt'), 'utf8'),
    ).toBe('pnpm test\n')
    expect((await stat(join(snapshotsRoot, snapshot.digest, 'SKILL.md'))).mode & 0o222).toBe(0)

    await catalog.delete('delivery', { expectedDigest: created.digest })
    expect(await snapshots.get(snapshot.digest)).toMatchObject({ digest: snapshot.digest })
  })

  it('uses stable application error codes', () => {
    expect(new SkillCatalogError('SKILL_NOT_FOUND').code).toBe('SKILL_NOT_FOUND')
  })
})
