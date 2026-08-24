import type { GitConnectionService } from '../git/git-connection-service.js'
import type { RemoteGitHost } from '../git/remote-git-host.js'
import type { RunProjectResolution } from '../services/run-service.js'
import type { ProjectService } from './project-service.js'

export const createRemoteRunProjectResolver = (
  options: Readonly<{
    projects: Pick<ProjectService, 'requireAvailable'>
    connections: Pick<GitConnectionService, 'requireToken'>
    remote: Pick<RemoteGitHost, 'getDefaultBranchSha'>
  }>,
): ((projectId: string) => Promise<RunProjectResolution>) =>
  async function resolveRunProject(projectId) {
    const project = await options.projects.requireAvailable(projectId)
    const token = await options.connections.requireToken(project.provider)
    const baseSha = await options.remote.getDefaultBranchSha(
      {
        provider: project.provider,
        remoteId: project.remoteId,
        fullName: project.fullName,
        defaultBranch: project.defaultBranch,
      },
      token,
    )
    return {
      projectId: project.projectId,
      name: project.name,
      provider: project.provider,
      remoteId: project.remoteId,
      fullName: project.fullName,
      cloneUrl: project.cloneUrl,
      defaultBranch: project.defaultBranch,
      baseSha,
    }
  }
