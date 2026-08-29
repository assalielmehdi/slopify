import type { GitProvider, GitRepository, GitSha } from '@slopify/shared'

export interface RemoteGitAccount {
  readonly provider: GitProvider
  readonly accountUsername: string
}

export interface RemoteGitRepositoryReference {
  readonly provider: GitProvider
  readonly remoteId: string
  readonly fullName: string
  readonly defaultBranch: string
}

export interface RemoteGitHost {
  authenticate(provider: GitProvider, token: string): Promise<RemoteGitAccount>
  listRepositories(provider: GitProvider, token: string): Promise<readonly GitRepository[]>
  getRepository(
    provider: GitProvider,
    token: string,
    remoteId: string,
  ): Promise<GitRepository | undefined>
  getDefaultBranchSha(repository: RemoteGitRepositoryReference, token: string): Promise<GitSha>
}
