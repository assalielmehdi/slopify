import { describe, expect, it, vi } from 'vitest'

import { SkillCatalogError, type SkillCatalog, type SkillRecord } from '@slopify/execution-runtime'

import { createApiApp } from '../src/app.js'

const SKILL: SkillRecord = {
  skillId: 'gitlab-delivery',
  name: 'gitlab-delivery',
  description: 'Use GitLab safely',
  digest: 'a'.repeat(64),
  modifiedAt: '2026-08-20T00:00:00.000Z',
  valid: true,
  issues: [],
  files: [{ path: 'SKILL.md', content: 'instructions', size: 12 }],
}

const fixture = (readOnly = false) => {
  const skills: SkillCatalog = {
    refresh: vi.fn(async () => [SKILL]),
    get: vi.fn(async () => SKILL),
    create: vi.fn(async () => SKILL),
    update: vi.fn(async () => SKILL),
    delete: vi.fn(async () => undefined),
  }
  const connectionCatalog = readOnly
    ? { list: () => [{ skillId: SKILL.skillId, name: 'GitLab' }] as never }
    : undefined
  return { skills, app: createApiApp({ skills, connectionCatalog }) }
}

describe('skills API', () => {
  it('refreshes and returns the complete live catalog', async () => {
    const { app, skills } = fixture()
    const response = await app.request('/api/skills')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      skills: [{ ...SKILL, kind: 'user', readOnly: false }],
    })
    expect(skills.refresh).toHaveBeenCalledOnce()
  })

  it('exposes connector skills as read-only and rejects UI mutations', async () => {
    const { app, skills } = fixture(true)
    expect(await (await app.request('/api/skills')).json()).toEqual({
      skills: [
        {
          ...SKILL,
          displayName: 'gitlab-delivery',
          kind: 'connector',
          readOnly: true,
        },
      ],
    })
    expect(await (await app.request('/api/skills/gitlab-delivery')).json()).toEqual({
      ...SKILL,
      displayName: 'gitlab-delivery',
      kind: 'connector',
      readOnly: true,
    })

    const update = await app.request('/api/skills/gitlab-delivery', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedDigest: 'a'.repeat(64), files: { 'SKILL.md': 'new' } }),
    })
    const remove = await app.request('/api/skills/gitlab-delivery', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedDigest: 'a'.repeat(64) }),
    })
    expect(update.status).toBe(403)
    expect(remove.status).toBe(403)
    expect(skills.update).not.toHaveBeenCalled()
    expect(skills.delete).not.toHaveBeenCalled()
  })

  it('distinguishes non-connector built-in skills from connector skills', async () => {
    const skills: SkillCatalog = {
      refresh: vi.fn(async () => [SKILL]),
      get: vi.fn(async () => SKILL),
      create: vi.fn(async () => SKILL),
      update: vi.fn(async () => SKILL),
      delete: vi.fn(async () => undefined),
    }
    const app = createApiApp({
      skills,
      builtInSkillNames: new Map([[SKILL.skillId, 'Utility']]),
    })

    expect(await (await app.request('/api/skills')).json()).toEqual({
      skills: [{ ...SKILL, displayName: 'Utility', kind: 'built-in', readOnly: true }],
    })
  })

  it('gets, creates, atomically updates, and deletes a skill', async () => {
    const { app, skills } = fixture()
    expect((await app.request('/api/skills/gitlab-delivery')).status).toBe(200)
    expect(
      (
        await app.request('/api/skills', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            markdown:
              '---\nname: gitlab-delivery\ndescription: Use GitLab safely\n---\n\nDo the work\n',
          }),
        })
      ).status,
    ).toBe(201)
    expect(
      (
        await app.request('/api/skills/gitlab-delivery', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ expectedDigest: 'a'.repeat(64), files: { 'SKILL.md': 'new' } }),
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await app.request('/api/skills/gitlab-delivery', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ expectedDigest: 'a'.repeat(64) }),
        })
      ).status,
    ).toBe(204)
    expect(skills.create).toHaveBeenCalledWith({
      markdown: '---\nname: gitlab-delivery\ndescription: Use GitLab safely\n---\n\nDo the work\n',
    })
    expect(skills.update).toHaveBeenCalledWith('gitlab-delivery', {
      expectedDigest: 'a'.repeat(64),
      files: { 'SKILL.md': 'new' },
    })
    expect(skills.delete).toHaveBeenCalledWith('gitlab-delivery', {
      expectedDigest: 'a'.repeat(64),
    })
  })

  it('maps traversal, conflicts, limits, and missing skills to stable responses', async () => {
    const { app, skills } = fixture()
    vi.mocked(skills.get).mockRejectedValue(new SkillCatalogError('SKILL_ID_INVALID'))
    const invalid = await app.request('/api/skills/%2E%2E%2Fcredentials.json')
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ error: { code: 'SKILL_ID_INVALID' } })
  })
})
