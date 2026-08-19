import type { ProcessRunInput, ProcessRunResult, ProcessRunner } from '@loop/execution-runtime'

const REMOTE_PATTERN = /^[a-z0-9](?:[a-z0-9._/-]*[a-z0-9])?$/i

export type GitOperation =
  | 'add-worktree'
  | 'branch-exists'
  | 'fetch-target'
  | 'remote-url'
  | 'repository-root'
  | 'resolve-target'
  | 'validate-ref'

export interface GitCommandFailure {
  readonly operation: GitOperation
  readonly command: Readonly<Pick<ProcessRunInput, 'executable' | 'arguments' | 'cwd'>>
  readonly result: ProcessRunResult
}

export type GitOperationResult<Value> =
  | Readonly<{ status: 'succeeded'; value: Value }>
  | Readonly<{ status: 'failed'; failure: GitCommandFailure }>

export interface GitClient {
  repositoryRoot(repositoryPath: string): Promise<GitOperationResult<string>>
  remoteUrl(repositoryPath: string, remote: string): Promise<GitOperationResult<string>>
  validateRef(repositoryPath: string, branch: string): Promise<GitOperationResult<true>>
  fetchTarget(
    repositoryPath: string,
    remote: string,
    targetBranch: string,
  ): Promise<GitOperationResult<true>>
  resolveTarget(
    repositoryPath: string,
    remote: string,
    targetBranch: string,
  ): Promise<GitOperationResult<string>>
  branchExists(repositoryPath: string, sourceBranch: string): Promise<GitOperationResult<boolean>>
  addWorktree(
    repositoryPath: string,
    worktreePath: string,
    sourceBranch: string,
    baseSha: string,
  ): Promise<GitOperationResult<true>>
}

export interface CreateGitClientOptions {
  readonly processRunner: ProcessRunner
  readonly commandTimeoutMs: number
}

const command = (
  repositoryPath: string,
  arguments_: readonly string[],
  timeoutMs: number,
): ProcessRunInput => ({
  executable: 'git',
  arguments: arguments_,
  cwd: repositoryPath,
  timeoutMs,
})

const successful = (result: ProcessRunResult): boolean =>
  result.status === 'exited' && result.exitCode === 0

const failure = (
  operation: GitOperation,
  input: ProcessRunInput,
  result: ProcessRunResult,
): GitOperationResult<never> => ({
  status: 'failed',
  failure: {
    operation,
    command: { executable: input.executable, arguments: input.arguments, cwd: input.cwd },
    result,
  },
})

export const buildFetchTargetArguments = (
  repositoryPath: string,
  remote: string,
  targetBranch: string,
): readonly string[] => [
  '-C',
  repositoryPath,
  'fetch',
  '--no-tags',
  remote,
  `+refs/heads/${targetBranch}:refs/remotes/${remote}/${targetBranch}`,
]

const runRequired = async (
  options: CreateGitClientOptions,
  operation: GitOperation,
  repositoryPath: string,
  arguments_: readonly string[],
): Promise<GitOperationResult<ProcessRunResult>> => {
  const input = command(repositoryPath, arguments_, options.commandTimeoutMs)
  const result = await options.processRunner.run(input)
  return successful(result)
    ? { status: 'succeeded', value: result }
    : failure(operation, input, result)
}

export const createGitClient = (options: CreateGitClientOptions): GitClient => {
  if (!Number.isSafeInteger(options.commandTimeoutMs) || options.commandTimeoutMs <= 0) {
    throw new TypeError('commandTimeoutMs must be a positive safe integer')
  }

  return {
    async repositoryRoot(repositoryPath) {
      const result = await runRequired(options, 'repository-root', repositoryPath, [
        '-C',
        repositoryPath,
        'rev-parse',
        '--show-toplevel',
      ])
      return result.status === 'failed'
        ? result
        : { status: 'succeeded', value: result.value.stdout.trim() }
    },
    async remoteUrl(repositoryPath, remote) {
      if (!REMOTE_PATTERN.test(remote) || remote.includes('..') || remote.includes('//')) {
        const input = command(
          repositoryPath,
          ['remote', 'get-url', remote],
          options.commandTimeoutMs,
        )
        return failure('remote-url', input, {
          status: 'failed-to-start',
          code: 'INVALID_REMOTE',
          message: 'Process could not be started',
          durationMs: 0,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        })
      }
      const result = await runRequired(options, 'remote-url', repositoryPath, [
        '-C',
        repositoryPath,
        'remote',
        'get-url',
        remote,
      ])
      return result.status === 'failed'
        ? result
        : { status: 'succeeded', value: result.value.stdout.trim() }
    },
    async validateRef(repositoryPath, branch) {
      const result = await runRequired(options, 'validate-ref', repositoryPath, [
        '-C',
        repositoryPath,
        'check-ref-format',
        '--branch',
        branch,
      ])
      return result.status === 'failed' ? result : { status: 'succeeded', value: true }
    },
    async fetchTarget(repositoryPath, remote, targetBranch) {
      const result = await runRequired(
        options,
        'fetch-target',
        repositoryPath,
        buildFetchTargetArguments(repositoryPath, remote, targetBranch),
      )
      return result.status === 'failed' ? result : { status: 'succeeded', value: true }
    },
    async resolveTarget(repositoryPath, remote, targetBranch) {
      const result = await runRequired(options, 'resolve-target', repositoryPath, [
        '-C',
        repositoryPath,
        'rev-parse',
        '--verify',
        '--end-of-options',
        `refs/remotes/${remote}/${targetBranch}^{commit}`,
      ])
      return result.status === 'failed'
        ? result
        : { status: 'succeeded', value: result.value.stdout.trim() }
    },
    async branchExists(repositoryPath, sourceBranch) {
      const input = command(
        repositoryPath,
        ['-C', repositoryPath, 'show-ref', '--quiet', '--verify', `refs/heads/${sourceBranch}`],
        options.commandTimeoutMs,
      )
      const result = await options.processRunner.run(input)
      if (successful(result)) return { status: 'succeeded', value: true }
      if (result.status === 'exited' && result.exitCode === 1) {
        return { status: 'succeeded', value: false }
      }
      return failure('branch-exists', input, result)
    },
    async addWorktree(repositoryPath, worktreePath, sourceBranch, baseSha) {
      const result = await runRequired(options, 'add-worktree', repositoryPath, [
        '-C',
        repositoryPath,
        'worktree',
        'add',
        '-b',
        sourceBranch,
        worktreePath,
        baseSha,
      ])
      return result.status === 'failed' ? result : { status: 'succeeded', value: true }
    },
  }
}
