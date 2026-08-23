import { GitShaSchema } from '@slopify/contracts'

import type { ProcessRunner } from '../processes/process-runner.js'
import type { RunProjectResolution } from '../services/run-service.js'
import type { ProjectService } from './project-service.js'

export const createNativeRunProjectResolver = (options: {
  readonly projects: Pick<ProjectService, 'requireAvailable'>
  readonly processRunner: ProcessRunner
  readonly timeoutMs?: number
}): ((projectId: string) => Promise<RunProjectResolution>) =>
  async function resolveRunProject(projectId) {
    const project = await options.projects.requireAvailable(projectId)
    const base = await options.processRunner.run({
      executable: 'git',
      arguments: ['-C', project.repositoryPath, 'rev-parse', '--verify', 'HEAD'],
      cwd: project.repositoryPath,
      timeoutMs: options.timeoutMs ?? 5_000,
    })
    if (base.status !== 'exited' || base.exitCode !== 0) {
      throw new Error('Project HEAD could not be resolved')
    }
    const baseSha = GitShaSchema.safeParse(base.stdout.trim())
    if (!baseSha.success) throw new Error('Project HEAD could not be resolved')

    const branch = await options.processRunner.run({
      executable: 'git',
      arguments: ['-C', project.repositoryPath, 'symbolic-ref', '--quiet', '--short', 'HEAD'],
      cwd: project.repositoryPath,
      timeoutMs: options.timeoutMs ?? 5_000,
    })
    return {
      projectId: project.projectId,
      name: project.name,
      repositoryPath: project.repositoryPath,
      baseSha: baseSha.data,
      sourceBranch:
        branch.status === 'exited' && branch.exitCode === 0 && branch.stdout.trim().length > 0
          ? branch.stdout.trim()
          : null,
    }
  }
