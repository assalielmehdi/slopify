import type { GitConnectionService } from '../git/git-connection-service.js'
import type { RemoteGitHost } from '../git/remote-git-host.js'
import type { RunRepositoryResolution } from '../services/run-service.js'
import type { RepositoryService } from './repository-service.js'

export const createRemoteRunRepositoryResolver = (
  options: Readonly<{
    repositories: Pick<RepositoryService, 'requireAvailable'>
    connections: Pick<GitConnectionService, 'requireToken'>
    remote: Pick<RemoteGitHost, 'getDefaultBranchSha'>
  }>,
): ((repositoryId: string) => Promise<RunRepositoryResolution>) =>
  async function resolveRunRepository(repositoryId) {
    const repository = await options.repositories.requireAvailable(repositoryId)
    const token = await options.connections.requireToken(repository.provider)
    const baseSha = await options.remote.getDefaultBranchSha(
      {
        provider: repository.provider,
        remoteId: repository.remoteId,
        fullName: repository.fullName,
        defaultBranch: repository.defaultBranch,
      },
      token,
    )
    return {
      repositoryId: repository.repositoryId,
      name: repository.name,
      provider: repository.provider,
      remoteId: repository.remoteId,
      fullName: repository.fullName,
      cloneUrl: repository.cloneUrl,
      defaultBranch: repository.defaultBranch,
      baseSha,
    }
  }
