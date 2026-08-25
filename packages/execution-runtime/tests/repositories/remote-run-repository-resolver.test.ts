import { describe, expect, it, vi } from 'vitest'

import { createRemoteRunRepositoryResolver } from '../../src/index.js'

const repository = {
  repositoryId: 'repository-api',
  name: 'api',
  provider: 'GITLAB' as const,
  remoteId: '42',
  fullName: 'platform/api',
  cloneUrl: 'https://gitlab.com/platform/api.git',
  webUrl: 'https://gitlab.com/platform/api',
  defaultBranch: 'main',
  availability: 'AVAILABLE' as const,
  createdAt: '2026-08-24T00:00:00Z',
  updatedAt: '2026-08-24T00:00:00Z',
}

describe('remote run repository resolver', () => {
  it('captures immutable remote repository metadata and the exact default-branch SHA', async () => {
    const getDefaultBranchSha = vi.fn(async () => 'a'.repeat(40) as never)
    const resolve = createRemoteRunRepositoryResolver({
      repositories: { requireAvailable: async () => repository },
      connections: { requireToken: async () => 'gitlab-token' },
      remote: {
        authenticate: async () => ({ provider: 'GITLAB', accountUsername: 'operator' }),
        listRepositories: async () => [],
        getRepository: async () => undefined,
        getDefaultBranchSha,
      },
    })

    await expect(resolve('repository-api')).resolves.toEqual({
      repositoryId: 'repository-api',
      name: 'api',
      provider: 'GITLAB',
      remoteId: '42',
      fullName: 'platform/api',
      cloneUrl: 'https://gitlab.com/platform/api.git',
      defaultBranch: 'main',
      baseSha: 'a'.repeat(40),
    })
    expect(getDefaultBranchSha).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'GITLAB', remoteId: '42' }),
      'gitlab-token',
    )
  })
})
