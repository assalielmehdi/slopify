import { describe, expect, it, vi } from 'vitest'

import { createFetchRemoteGitHost } from '../../src/index.js'

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...init.headers },
    ...init,
  })

describe('fetch remote Git host', () => {
  it('validates GitHub tokens, follows repository pagination, and resolves a default-branch SHA', async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer github-token')
      expect(new Headers(init?.headers).get('accept')).toBe('application/vnd.github+json')
      if (url.pathname === '/user') return json({ login: 'operator' })
      if (url.pathname === '/user/repos' && url.searchParams.get('page') === '1') {
        return json(
          [
            {
              id: 123,
              name: 'slopify',
              full_name: 'operator/slopify',
              clone_url: 'https://github.com/operator/slopify.git',
              html_url: 'https://github.com/operator/slopify',
              private: true,
              default_branch: 'main',
            },
          ],
          { headers: { link: '<https://api.github.com/user/repos?page=2>; rel="next"' } },
        )
      }
      if (url.pathname === '/user/repos' && url.searchParams.get('page') === '2') return json([])
      if (url.pathname === '/repos/operator/slopify/commits/main') {
        return json({ sha: 'a'.repeat(40) })
      }
      throw new Error(`Unexpected request ${url}`)
    })
    const remote = createFetchRemoteGitHost({ fetch })

    await expect(remote.authenticate('GITHUB', 'github-token')).resolves.toEqual({
      provider: 'GITHUB',
      accountUsername: 'operator',
    })
    const repositories = await remote.listRepositories('GITHUB', 'github-token')
    expect(repositories).toEqual([
      {
        provider: 'GITHUB',
        remoteId: '123',
        name: 'slopify',
        fullName: 'operator/slopify',
        cloneUrl: 'https://github.com/operator/slopify.git',
        webUrl: 'https://github.com/operator/slopify',
        visibility: 'PRIVATE',
        defaultBranch: 'main',
      },
    ])
    const repository = repositories[0]
    expect(repository).toBeDefined()
    if (!repository) throw new Error('Expected a GitHub repository')
    await expect(remote.getDefaultBranchSha(repository, 'github-token')).resolves.toBe(
      'a'.repeat(40),
    )
  })

  it('validates GitLab tokens, follows X-Next-Page, and maps repository metadata', async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      expect(new Headers(init?.headers).get('private-token')).toBe('gitlab-token')
      if (url.pathname === '/api/v4/user') return json({ username: 'operator' })
      if (url.pathname === '/api/v4/projects' && url.searchParams.get('page') === '1') {
        expect(url.searchParams.get('membership')).toBe('true')
        return json(
          [
            {
              id: 42,
              name: 'api',
              path_with_namespace: 'platform/api',
              http_url_to_repo: 'https://gitlab.com/platform/api.git',
              web_url: 'https://gitlab.com/platform/api',
              visibility: 'internal',
              default_branch: 'main',
            },
          ],
          { headers: { 'x-next-page': '2' } },
        )
      }
      if (url.pathname === '/api/v4/projects' && url.searchParams.get('page') === '2') {
        return json([], { headers: { 'x-next-page': '' } })
      }
      throw new Error(`Unexpected request ${url}`)
    })
    const remote = createFetchRemoteGitHost({ fetch })

    await expect(remote.authenticate('GITLAB', 'gitlab-token')).resolves.toEqual({
      provider: 'GITLAB',
      accountUsername: 'operator',
    })
    await expect(remote.listRepositories('GITLAB', 'gitlab-token')).resolves.toMatchObject([
      {
        provider: 'GITLAB',
        remoteId: '42',
        fullName: 'platform/api',
        visibility: 'INTERNAL',
      },
    ])
  })

  it('rejects non-success responses without exposing response bodies', async () => {
    const remote = createFetchRemoteGitHost({
      fetch: async () => new Response('token is invalid: secret-value', { status: 401 }),
    })

    await expect(remote.authenticate('GITHUB', 'secret-value')).rejects.toThrow(
      'GitHub request failed with status 401',
    )
  })
})
