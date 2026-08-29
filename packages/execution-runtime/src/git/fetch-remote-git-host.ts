import {
  GitProviderSchema,
  GitRepositorySchema,
  GitShaSchema,
  type GitProvider,
  type GitRepository,
} from '@slopify/shared'
import { z } from 'zod'

import type { RemoteGitHost } from './remote-git-host.js'

const GitHubAccountSchema = z.object({ login: z.string().trim().min(1).max(256) })
const GitLabAccountSchema = z.object({ username: z.string().trim().min(1).max(256) })
const GitHubRepositorySchema = z.object({
  id: z.number().int().nonnegative().safe(),
  name: z.string().trim().min(1).max(256),
  full_name: z.string().trim().min(1).max(512),
  clone_url: z.url({ protocol: /^https$/u }).max(4_096),
  html_url: z.url({ protocol: /^https$/u }).max(4_096),
  private: z.boolean(),
  default_branch: z.string().trim().min(1).max(512).nullable(),
})
const GitLabRepositorySchema = z.object({
  id: z.number().int().nonnegative().safe(),
  name: z.string().trim().min(1).max(256),
  path_with_namespace: z.string().trim().min(1).max(512),
  http_url_to_repo: z.url({ protocol: /^https$/u }).max(4_096),
  web_url: z.url({ protocol: /^https$/u }).max(4_096),
  visibility: z.enum(['public', 'internal', 'private']),
  default_branch: z.string().trim().min(1).max(512).nullable(),
})
const CommitSchema = z.object({ sha: GitShaSchema })
const GitLabCommitSchema = z.object({ id: GitShaSchema })
const RepositoryReferenceSchema = z.object({
  provider: GitProviderSchema,
  remoteId: z.string().regex(/^\d+$/u).max(128),
  fullName: z.string().trim().min(1).max(512),
  defaultBranch: z.string().trim().min(1).max(512),
})

export class RemoteGitHostError extends Error {
  override readonly name = 'RemoteGitHostError'
}

const providerName = (provider: GitProvider): string =>
  provider === 'GITHUB' ? 'GitHub' : 'GitLab'

const mapGitHubRepository = (
  repository: z.infer<typeof GitHubRepositorySchema>,
): GitRepository | undefined =>
  repository.default_branch === null
    ? undefined
    : GitRepositorySchema.parse({
        provider: 'GITHUB',
        remoteId: String(repository.id),
        name: repository.name,
        fullName: repository.full_name,
        cloneUrl: repository.clone_url,
        webUrl: repository.html_url,
        visibility: repository.private ? 'PRIVATE' : 'PUBLIC',
        defaultBranch: repository.default_branch,
      })

const mapGitLabRepository = (
  repository: z.infer<typeof GitLabRepositorySchema>,
): GitRepository | undefined =>
  repository.default_branch === null
    ? undefined
    : GitRepositorySchema.parse({
        provider: 'GITLAB',
        remoteId: String(repository.id),
        name: repository.name,
        fullName: repository.path_with_namespace,
        cloneUrl: repository.http_url_to_repo,
        webUrl: repository.web_url,
        visibility: repository.visibility.toUpperCase(),
        defaultBranch: repository.default_branch,
      })

export const createFetchRemoteGitHost = (
  options: Readonly<{
    fetch?: typeof globalThis.fetch
    timeoutMs?: number
  }> = {},
): RemoteGitHost => {
  const fetchImplementation = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 10_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new TypeError('Remote Git request timeout is invalid')
  }

  const request = async (
    providerInput: GitProvider,
    token: string,
    url: URL,
  ): Promise<Response> => {
    const provider = GitProviderSchema.parse(providerInput)
    const response = await fetchImplementation(url, {
      headers:
        provider === 'GITHUB'
          ? {
              accept: 'application/vnd.github+json',
              authorization: `Bearer ${token}`,
              'x-github-api-version': '2026-03-10',
            }
          : { accept: 'application/json', 'private-token': token },
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) {
      throw new RemoteGitHostError(
        `${providerName(provider)} request failed with status ${response.status}`,
      )
    }
    return response
  }

  const listGitHub = async (token: string): Promise<readonly GitRepository[]> => {
    const repositories: GitRepository[] = []
    for (let page = 1; page <= 1_000; page += 1) {
      const url = new URL('/user/repos', 'https://api.github.com')
      url.search = new URLSearchParams({
        affiliation: 'owner,collaborator,organization_member',
        direction: 'asc',
        page: String(page),
        per_page: '100',
        sort: 'full_name',
      }).toString()
      const response = await request('GITHUB', token, url)
      const items = z.array(GitHubRepositorySchema).parse(await response.json())
      for (const item of items) {
        const repository = mapGitHubRepository(item)
        if (repository !== undefined) repositories.push(repository)
      }
      if (!/rel="next"/u.test(response.headers.get('link') ?? '')) return repositories
    }
    throw new RemoteGitHostError('GitHub repository pagination exceeded the supported limit')
  }

  const listGitLab = async (token: string): Promise<readonly GitRepository[]> => {
    const repositories: GitRepository[] = []
    for (let page = 1; page <= 1_000; page += 1) {
      const url = new URL('/api/v4/projects', 'https://gitlab.com')
      url.search = new URLSearchParams({
        membership: 'true',
        order_by: 'path',
        page: String(page),
        per_page: '100',
        simple: 'true',
        sort: 'asc',
      }).toString()
      const response = await request('GITLAB', token, url)
      const items = z.array(GitLabRepositorySchema).parse(await response.json())
      for (const item of items) {
        const repository = mapGitLabRepository(item)
        if (repository !== undefined) repositories.push(repository)
      }
      if ((response.headers.get('x-next-page') ?? '') === '') return repositories
    }
    throw new RemoteGitHostError('GitLab repository pagination exceeded the supported limit')
  }

  return {
    async authenticate(providerInput, token) {
      const provider = GitProviderSchema.parse(providerInput)
      const url = new URL(
        provider === 'GITHUB' ? '/user' : '/api/v4/user',
        provider === 'GITHUB' ? 'https://api.github.com' : 'https://gitlab.com',
      )
      const response = await request(provider, token, url)
      const accountUsername =
        provider === 'GITHUB'
          ? GitHubAccountSchema.parse(await response.json()).login
          : GitLabAccountSchema.parse(await response.json()).username
      return { provider, accountUsername }
    },

    listRepositories(providerInput, token) {
      const provider = GitProviderSchema.parse(providerInput)
      return provider === 'GITHUB' ? listGitHub(token) : listGitLab(token)
    },

    async getRepository(providerInput, token, remoteId) {
      const provider = GitProviderSchema.parse(providerInput)
      const url = new URL(
        provider === 'GITHUB'
          ? `/repositories/${encodeURIComponent(remoteId)}`
          : `/api/v4/projects/${encodeURIComponent(remoteId)}`,
        provider === 'GITHUB' ? 'https://api.github.com' : 'https://gitlab.com',
      )
      try {
        const response = await request(provider, token, url)
        return provider === 'GITHUB'
          ? mapGitHubRepository(GitHubRepositorySchema.parse(await response.json()))
          : mapGitLabRepository(GitLabRepositorySchema.parse(await response.json()))
      } catch (cause) {
        if (cause instanceof RemoteGitHostError && cause.message.endsWith('status 404'))
          return undefined
        throw cause
      }
    },

    async getDefaultBranchSha(repositoryInput, token) {
      const repository = RepositoryReferenceSchema.parse(repositoryInput)
      const url =
        repository.provider === 'GITHUB'
          ? new URL(
              `/repos/${repository.fullName.split('/').map(encodeURIComponent).join('/')}/commits/${encodeURIComponent(repository.defaultBranch)}`,
              'https://api.github.com',
            )
          : new URL(
              `/api/v4/projects/${encodeURIComponent(repository.remoteId)}/repository/commits/${encodeURIComponent(repository.defaultBranch)}`,
              'https://gitlab.com',
            )
      const response = await request(repository.provider, token, url)
      return repository.provider === 'GITHUB'
        ? CommitSchema.parse(await response.json()).sha
        : GitLabCommitSchema.parse(await response.json()).id
    },
  }
}
