import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp } from 'node:fs/promises'

import { afterEach, describe, expect, it } from 'vitest'

import {
  SkillCatalogError,
  createFilesystemSkillCatalog,
  createFilesystemSkillSnapshotStore,
  initializeBuiltInConnectorSkills,
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
  it('seeds connector skills once and preserves later filesystem changes', async () => {
    const { catalog, skillsRoot } = await fixture()
    const connectorCatalog = [
      {
        type: 'gitlab',
        category: 'connector',
        skillId: 'gitlab-connector',
      },
      {
        type: 'clickup',
        category: 'connector',
        skillId: 'clickup-connector',
      },
    ] as never

    initializeBuiltInConnectorSkills({ root: skillsRoot, catalog: connectorCatalog })
    expect((await catalog.refresh()).map(({ skillId }) => skillId)).toEqual([
      'clickup-connector',
      'gitlab-connector',
    ])
    const gitlab = await catalog.get('gitlab-connector')
    expect(gitlab.files.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        'SKILL.md',
        'assets/graphql/create-note.graphql',
        'references/mr-review.md',
        'scripts/create-epic-note.sh',
      ]),
    )
    expect(gitlab.files.find(({ path }) => path === 'SKILL.md')?.content).toContain(
      'GitLab workflow management using `glab` CLI',
    )

    await writeFile(
      join(skillsRoot, 'clickup-connector', 'SKILL.md'),
      '---\nname: clickup-connector\ndescription: Replaced locally.\n---\n\nCustom.\n',
    )
    await rm(join(skillsRoot, 'gitlab-connector'), { recursive: true })
    initializeBuiltInConnectorSkills({ root: skillsRoot, catalog: connectorCatalog })

    expect(await catalog.get('clickup-connector')).toMatchObject({
      description: 'Replaced locally.',
    })
    await expect(catalog.get('gitlab-connector')).rejects.toMatchObject({
      code: 'SKILL_NOT_FOUND',
    })
  })

  it('uses the filesystem as source of truth and sees external edits on refresh', async () => {
    const { catalog, skillsRoot } = await fixture()
    await catalog.create({
      markdown:
        '---\nname: gitlab-delivery\ndescription: Deliver through GitLab.\n---\n\nUse glab safely.\n',
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
      markdown: '---\nname: safe-skill\ndescription: Safe.\n---\n\nStay inside.\n',
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
    const { catalog, skillsRoot, snapshots, snapshotsRoot } = await fixture()
    const created = await catalog.create({
      markdown: '---\nname: delivery\ndescription: Delivery skill.\n---\n\nRead the reference.\n',
    })
    await mkdir(join(skillsRoot, 'delivery', 'references'), { recursive: true })
    await mkdir(join(skillsRoot, 'delivery', 'scripts'), { recursive: true })
    await writeFile(join(skillsRoot, 'delivery', 'references/checks.txt'), 'pnpm test\n')
    await writeFile(join(skillsRoot, 'delivery', 'scripts/run.sh'), '#!/bin/sh\n')

    const live = await catalog.get('delivery')
    const snapshot = await snapshots.capture(live)
    expect(snapshot.digest).not.toBe(created.digest)
    expect(
      await readFile(join(snapshotsRoot, snapshot.digest, 'references/checks.txt'), 'utf8'),
    ).toBe('pnpm test\n')
    expect((await stat(join(snapshotsRoot, snapshot.digest, 'SKILL.md'))).mode & 0o222).toBe(0)

    await catalog.delete('delivery', { expectedDigest: live.digest })
    expect(await snapshots.get(snapshot.digest)).toMatchObject({ digest: snapshot.digest })
  })

  it('uses stable application error codes', () => {
    expect(new SkillCatalogError('SKILL_NOT_FOUND').code).toBe('SKILL_NOT_FOUND')
  })

  it('derives identity from frontmatter and preserves the submitted Markdown', async () => {
    const { catalog, skillsRoot } = await fixture()
    const markdown =
      '---\nname: research-helper\ndescription: Searches primary sources.\n---\n\n# Instructions\n\nUse the available search tools.\n'

    const created = await catalog.create({ markdown })

    expect(created).toMatchObject({
      skillId: 'research-helper',
      name: 'research-helper',
      description: 'Searches primary sources.',
      valid: true,
    })
    expect(await readFile(join(skillsRoot, 'research-helper', 'SKILL.md'), 'utf8')).toBe(markdown)
  })

  it('rejects invalid frontmatter without creating a skill directory', async () => {
    const { catalog, skillsRoot } = await fixture()

    await expect(catalog.create({ markdown: '# Missing frontmatter' })).rejects.toMatchObject({
      code: 'SKILL_INVALID',
    })
    expect(await readdir(skillsRoot)).toEqual([])
  })
})
