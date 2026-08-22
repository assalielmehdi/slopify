import { stat, realpath } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

import type { ProcessRunner } from '../processes/process-runner.js'
import type { ProjectInspector } from './project-service.js'

export const createNativeGitProjectInspector = (options: {
  readonly processRunner: ProcessRunner
  readonly timeoutMs?: number
}): ProjectInspector => ({
  async inspect(repositoryPath) {
    let canonicalPath: string
    try {
      const metadata = await stat(repositoryPath)
      if (!metadata.isDirectory()) return { status: 'NOT_GIT_REPOSITORY' }
      canonicalPath = await realpath(repositoryPath)
    } catch {
      return { status: 'MISSING' }
    }

    const result = await options.processRunner.run({
      executable: 'git',
      arguments: ['-C', canonicalPath, 'rev-parse', '--show-toplevel'],
      cwd: canonicalPath,
      timeoutMs: options.timeoutMs ?? 5_000,
    })
    if (
      result.status !== 'exited' ||
      result.exitCode !== 0 ||
      resolve(result.stdout.trim()) !== resolve(canonicalPath)
    ) {
      return { status: 'NOT_GIT_REPOSITORY' }
    }
    return { status: 'AVAILABLE', canonicalPath, name: basename(canonicalPath) }
  },
})
