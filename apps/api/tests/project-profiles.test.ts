import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ProjectProfileCatalogResponse, ProjectProfileReadiness } from '@loop/contracts'
import {
  ProjectProfileServiceError,
  createProjectProfileService,
  type ReadinessService,
} from '@loop/execution-runtime'
import {
  createPersistenceFixture,
  TEST_PROFILE,
} from '../../../packages/execution-runtime/tests/persistence/test-fixture.js'
import { createApiApp } from '../src/app.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

const createFixture = () => {
  const fixture = createPersistenceFixture()
  fixtures.push(fixture)
  const profiles = createProjectProfileService({
    profiles: fixture.profiles,
    runtimeMode: 'native',
    now: () => '2026-08-18T22:00:00Z',
  })
  const profileReadiness: ProjectProfileReadiness = {
    profileId: 'profile-01',
    ready: true,
    repositories: TEST_PROFILE.repositories.map(({ repositoryId }) => ({
      repositoryId,
      ready: true,
      findings: [],
    })),
  }
  const readiness: ReadinessService = {
    connectorStatus: () => ({ clickup: true, gitlab: false, modelProvider: true }),
    check: vi.fn(async (profileId) => {
      if (profileId !== 'profile-01') {
        throw new ProjectProfileServiceError('PROFILE_NOT_FOUND', 'Project profile was not found')
      }
      return profileReadiness
    }),
  }
  return {
    app: createApiApp({ database: fixture.database, profiles, readiness }),
    readiness,
  }
}

describe('project profile API', () => {
  it('lists configured profiles with canonical repository order', async () => {
    const { app } = createFixture()

    const response = await app.request('/api/project-profiles')
    const body = (await response.json()) as ProjectProfileCatalogResponse

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ runtime: { mode: 'native', root: '/' } })
    expect(body.profiles).toHaveLength(1)
    expect(body.profiles[0]?.repositories.map(({ repositoryId }) => repositoryId)).toEqual([
      'api',
      'web',
      'docs',
    ])
  })

  it('creates and updates a validated local profile', async () => {
    const { app } = createFixture()
    const profile = { ...TEST_PROFILE, profileId: 'profile-02', displayName: 'Second profile' }

    const created = await app.request('/api/project-profiles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(profile),
    })
    const updated = await app.request('/api/project-profiles/profile-02', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...profile, displayName: 'Updated profile' }),
    })

    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({ profileId: 'profile-02' })
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({
      profileId: 'profile-02',
      displayName: 'Updated profile',
    })
  })

  it('keeps an existing snapshot unchanged when settings are saved', async () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    const profiles = createProjectProfileService({
      profiles: fixture.profiles,
      runtimeMode: 'native',
      now: () => '2026-08-18T22:00:00Z',
    })
    const snapshotBefore = fixture.profiles.getSnapshot('snapshot-01')
    const readiness: ReadinessService = {
      connectorStatus: () => ({ clickup: true, gitlab: true, modelProvider: true }),
      check: async () => ({ profileId: 'profile-01', ready: true, repositories: [] }),
    }
    const app = createApiApp({ database: fixture.database, profiles, readiness })

    const response = await app.request('/api/project-profiles/profile-01', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...TEST_PROFILE, displayName: 'Edited settings' }),
    })

    expect(response.status).toBe(200)
    expect(fixture.profiles.getSnapshot('snapshot-01')).toEqual(snapshotBefore)
  })

  it('rejects a mismatched path identity and invalid command object', async () => {
    const { app } = createFixture()
    const response = await app.request('/api/project-profiles/different-profile', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...TEST_PROFILE,
        repositories: [
          { ...TEST_PROFILE.repositories[0], executableChecks: [{ command: 'node --version' }] },
        ],
      }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'PROFILE_INVALID' } })
  })

  it('rejects malformed profile JSON with the profile validation error', async () => {
    const { app } = createFixture()

    const response = await app.request('/api/project-profiles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{invalid-json',
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: { code: 'PROFILE_INVALID', message: 'Project profile is invalid' },
    })
  })

  it('exposes readiness and connector booleans without secret values', async () => {
    const { app, readiness } = createFixture()

    const profileResponse = await app.request('/api/project-profiles/profile-01/readiness')
    const connectorResponse = await app.request('/api/connectors/status')
    const profileBody: unknown = await profileResponse.json()
    const connectorBody: unknown = await connectorResponse.json()
    const combined = JSON.stringify({ profileBody, connectorBody })

    expect(profileResponse.status).toBe(200)
    expect(connectorResponse.status).toBe(200)
    expect(combined).not.toMatch(/token|secret|credential/i)
    expect(connectorBody).toEqual({
      clickup: true,
      gitlab: false,
      modelProvider: true,
    })
    expect(readiness.check).toHaveBeenCalledWith('profile-01')
  })

  it('uses the shared not-found envelope for an unknown profile', async () => {
    const { app } = createFixture()

    const response = await app.request('/api/project-profiles/unknown/readiness')

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'PROFILE_NOT_FOUND', message: 'Project profile was not found' },
    })
  })
})
