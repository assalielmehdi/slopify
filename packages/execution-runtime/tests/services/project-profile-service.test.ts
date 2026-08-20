import { afterEach, describe, expect, it } from 'vitest'

import {
  ProjectProfileServiceError,
  createProjectProfileService,
} from '../../src/services/project-profile-service.js'
import { TEST_PROFILE, createPersistenceFixture } from '../persistence/test-fixture.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

const composeProfile = () => ({
  ...TEST_PROFILE,
  repositories: TEST_PROFILE.repositories.map((repository) => ({
    ...repository,
    worktreeParent: '/workspace/.worktrees',
  })),
})

const createService = () => {
  const fixture = createPersistenceFixture()
  fixtures.push(fixture)
  return {
    fixture,
    service: createProjectProfileService({
      profiles: fixture.profiles,
      runtimeMode: 'container',
      workspaceRoot: '/workspace',
      now: () => '2026-08-18T22:00:00Z',
    }),
  }
}

describe('project profile service', () => {
  it('reports the active Compose path boundary', () => {
    const { service } = createService()

    expect(service.runtimeBoundary()).toEqual({ mode: 'container', root: '/workspace' })
  })

  it('persists a validated ordered catalog and lists it in stable order', () => {
    const { service } = createService()

    const saved = service.save(composeProfile())

    expect(saved.repositories.map(({ repositoryId }) => repositoryId)).toEqual([
      'api',
      'web',
      'docs',
    ])
    expect(service.list()).toEqual([saved])
    expect(service.get('profile-01')).toEqual(saved)
  })

  it.each([
    {
      name: 'empty catalog',
      profile: { ...composeProfile(), repositories: [] },
    },
    {
      name: 'duplicate repository ID',
      profile: {
        ...composeProfile(),
        repositories: [
          composeProfile().repositories[0],
          { ...composeProfile().repositories[1], repositoryId: 'api' },
        ],
      },
    },
    {
      name: 'duplicate resolved repository path',
      profile: {
        ...composeProfile(),
        repositories: [
          composeProfile().repositories[0],
          { ...composeProfile().repositories[1], repositoryPath: '/workspace/api/../api' },
        ],
      },
    },
    {
      name: 'path outside the container workspace',
      profile: {
        ...composeProfile(),
        repositories: [
          { ...composeProfile().repositories[0], repositoryPath: '/Users/operator/api' },
        ],
      },
    },
    {
      name: 'interpolated command string',
      profile: {
        ...composeProfile(),
        repositories: [
          {
            ...composeProfile().repositories[0],
            executableChecks: [{ command: 'node --version' }],
          },
        ],
      },
    },
  ])('rejects a $name without changing the persisted profile', ({ profile }) => {
    const { service } = createService()
    const before = service.list()

    expect(() => service.save(profile)).toThrow(ProjectProfileServiceError)
    expect(service.list()).toEqual(before)
  })

  it('creates an immutable snapshot before later profile edits', () => {
    const { service } = createService()
    service.save(composeProfile())
    const snapshot = service.createSnapshot('profile-01', 'snapshot-service-01')

    service.save({ ...composeProfile(), displayName: 'Edited after snapshot' })

    expect(snapshot.displayName).toBe('Local profile')
    expect(service.createSnapshot('profile-01', 'snapshot-service-02').displayName).toBe(
      'Edited after snapshot',
    )
    expect(snapshot.repositories.map(({ repositoryId }) => repositoryId)).toEqual([
      'api',
      'web',
      'docs',
    ])
  })
})
