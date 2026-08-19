import { realpath } from 'node:fs/promises'

import { GitShaSchema, GitWorkspaceSchema, type GitWorkspace } from '@loop/contracts'
import type {
  JsonValue,
  ProcessRunInput,
  ProcessRunResult,
  ProcessRunner,
} from '@loop/execution-runtime'

import type { FinalizationGitClient, FinalizationGitResult } from './finalizer.js'

export interface CreateFinalizationGitClientOptions {
  readonly processRunner: ProcessRunner
  readonly commandTimeoutMs: number
}

interface GitFinalizationCommandEvidence {
  readonly operation: 'inspect-worktree' | 'push-source-branch'
  readonly command: Readonly<Pick<ProcessRunInput, 'executable' | 'arguments' | 'cwd'>>
  readonly result: ProcessRunResult
}

const successful = (result: ProcessRunResult): boolean =>
  result.status === 'exited' && result.exitCode === 0

const asJson = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue

const command = (
  workspace: GitWorkspace,
  arguments_: readonly string[],
  timeoutMs: number,
  signal?: AbortSignal,
): ProcessRunInput => ({
  executable: 'git',
  arguments: ['-C', workspace.worktreePath, ...arguments_],
  cwd: workspace.worktreePath,
  timeoutMs,
  ...(signal === undefined ? {} : { signal }),
})

const executionFailure = (): ProcessRunResult => ({
  status: 'failed-to-start',
  code: 'GIT_EXECUTION_FAILED',
  message: 'Process could not be started',
  durationMs: 0,
  stdout: '',
  stderr: '',
  stdoutTruncated: false,
  stderrTruncated: false,
})

const failed = <Value>(
  code: 'GIT_FINALIZATION_PRECONDITION_FAILED' | 'GIT_FINALIZATION_PUSH_FAILED',
  repositoryId: string,
  commands: readonly GitFinalizationCommandEvidence[],
): FinalizationGitResult<Value, never> => ({
  status: 'failed',
  failure: { evidence: asJson({ code, repositoryId, commands }) },
})

export const createFinalizationGitClient = (
  options: CreateFinalizationGitClientOptions,
): FinalizationGitClient => {
  if (!Number.isSafeInteger(options.commandTimeoutMs) || options.commandTimeoutMs <= 0) {
    throw new TypeError('commandTimeoutMs must be a positive safe integer')
  }

  const run = async (
    workspace: GitWorkspace,
    operation: GitFinalizationCommandEvidence['operation'],
    arguments_: readonly string[],
    signal?: AbortSignal,
  ): Promise<GitFinalizationCommandEvidence> => {
    const input = command(workspace, arguments_, options.commandTimeoutMs, signal)
    let result: ProcessRunResult
    try {
      result = await options.processRunner.run(input)
    } catch {
      result = executionFailure()
    }
    return {
      operation,
      command: { executable: input.executable, arguments: input.arguments, cwd: input.cwd },
      result,
    }
  }

  return {
    async inspect(workspaceValue, signal) {
      const parsed = GitWorkspaceSchema.safeParse(workspaceValue)
      if (!parsed.success) {
        return failed('GIT_FINALIZATION_PRECONDITION_FAILED', 'unknown', [])
      }
      const workspace = parsed.data
      const commands = await Promise.all([
        run(workspace, 'inspect-worktree', ['rev-parse', '--show-toplevel'], signal),
        run(workspace, 'inspect-worktree', ['symbolic-ref', '--quiet', '--short', 'HEAD'], signal),
        run(workspace, 'inspect-worktree', ['status', '--porcelain=v1'], signal),
        run(workspace, 'inspect-worktree', ['rev-parse', '--verify', 'HEAD^{commit}'], signal),
        run(
          workspace,
          'inspect-worktree',
          ['merge-base', '--is-ancestor', workspace.baseSha, 'HEAD'],
          signal,
        ),
        run(
          workspace,
          'inspect-worktree',
          ['rev-list', '--count', `${workspace.baseSha}..HEAD`],
          signal,
        ),
      ])
      const [root, branch, status, head, ancestor, ahead] = commands
      if (
        root === undefined ||
        branch === undefined ||
        status === undefined ||
        head === undefined ||
        ancestor === undefined ||
        ahead === undefined
      ) {
        return failed('GIT_FINALIZATION_PRECONDITION_FAILED', workspace.repositoryId, commands)
      }
      let exactRoot = false
      try {
        exactRoot =
          (await realpath(root.result.stdout.trim())) === (await realpath(workspace.worktreePath))
      } catch {
        exactRoot = false
      }
      const parsedHead = GitShaSchema.safeParse(head.result.stdout.trim())
      const aheadCount = Number.parseInt(ahead.result.stdout.trim(), 10)
      if (
        commands.some(({ result }) => !successful(result)) ||
        !exactRoot ||
        branch.result.stdout.trim() !== workspace.sourceBranch ||
        status.result.stdout !== '' ||
        !parsedHead.success ||
        !Number.isSafeInteger(aheadCount) ||
        aheadCount < 1
      ) {
        return failed('GIT_FINALIZATION_PRECONDITION_FAILED', workspace.repositoryId, commands)
      }
      return {
        status: 'succeeded',
        value: { headSha: parsedHead.data },
        evidence: commands.map(asJson),
      }
    },

    async push(workspaceValue, signal) {
      const parsed = GitWorkspaceSchema.safeParse(workspaceValue)
      if (!parsed.success) return failed('GIT_FINALIZATION_PUSH_FAILED', 'unknown', [])
      const workspace = parsed.data
      const pushed = await run(
        workspace,
        'push-source-branch',
        [
          'push',
          '--porcelain',
          '--',
          workspace.remote,
          `refs/heads/${workspace.sourceBranch}:refs/heads/${workspace.sourceBranch}`,
        ],
        signal,
      )
      if (!successful(pushed.result)) {
        return failed('GIT_FINALIZATION_PUSH_FAILED', workspace.repositoryId, [pushed])
      }
      return { status: 'succeeded', value: true, evidence: asJson(pushed) }
    },
  }
}
