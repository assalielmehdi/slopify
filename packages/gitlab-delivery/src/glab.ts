import { GitShaSchema } from '@loop/contracts'
import type { ProcessRunInput, ProcessRunResult, ProcessRunner } from '@loop/execution-runtime'
import { z } from 'zod'

const project = z
  .string()
  .trim()
  .min(3)
  .max(512)
  .regex(/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?(?:\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)+$/iu)
const branch = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(/^[^\s?&#]+$/u)
const boundedText = z.string().trim().min(1).max(1_000_000)

const listInput = z.strictObject({
  project,
  sourceBranch: branch,
  targetBranch: branch,
})

const createInput = listInput.extend({
  title: z.string().trim().min(1).max(255),
  description: boundedText,
  labels: z.array(z.string().trim().min(1).max(256)).max(32).readonly(),
})

const mergeRequestResponse = z.looseObject({
  iid: z.number().int().positive().safe(),
  web_url: z.url().max(4_096),
  state: z.literal('opened'),
  source_branch: branch,
  target_branch: branch,
  sha: GitShaSchema,
})

const mergeRequestListResponse = z.array(mergeRequestResponse).max(2)

export interface GlabMergeRequest {
  readonly iid: number
  readonly url: string
  readonly state: 'opened'
  readonly sourceBranch: string
  readonly targetBranch: string
  readonly headSha: string
}

export type GlabOperation = 'create-merge-request' | 'list-open-merge-requests'
export type GlabFailureCode = 'GLAB_COMMAND_FAILED' | 'GLAB_INPUT_INVALID' | 'GLAB_RESPONSE_INVALID'

export interface GlabCommandEvidence {
  readonly operation: GlabOperation
  readonly command: Readonly<Pick<ProcessRunInput, 'executable' | 'arguments' | 'cwd'>>
  readonly result: ProcessRunResult
}

export interface GlabFailure extends GlabCommandEvidence {
  readonly code: GlabFailureCode
}

export type GlabOperationResult<Value> =
  | Readonly<{ status: 'succeeded'; value: Value; evidence: GlabCommandEvidence }>
  | Readonly<{ status: 'failed'; failure: GlabFailure }>

export interface ListOpenMergeRequestsInput {
  readonly project: string
  readonly sourceBranch: string
  readonly targetBranch: string
}

export interface CreateMergeRequestInput extends ListOpenMergeRequestsInput {
  readonly title: string
  readonly description: string
  readonly labels: readonly string[]
}

export interface GlabClient {
  listOpenMergeRequests(
    input: ListOpenMergeRequestsInput,
    signal?: AbortSignal,
  ): Promise<GlabOperationResult<readonly GlabMergeRequest[]>>
  createMergeRequest(
    input: CreateMergeRequestInput,
    signal?: AbortSignal,
  ): Promise<GlabOperationResult<true>>
}

export interface CreateGlabClientOptions {
  readonly processRunner: ProcessRunner
  readonly commandTimeoutMs: number
  readonly cwd?: string
}

const successful = (result: ProcessRunResult): boolean =>
  result.status === 'exited' && result.exitCode === 0

const command = (
  cwd: string,
  arguments_: readonly string[],
  timeoutMs: number,
  signal?: AbortSignal,
): ProcessRunInput => ({
  executable: 'glab',
  arguments: arguments_,
  cwd,
  timeoutMs,
  ...(signal === undefined ? {} : { signal }),
})

const evidence = (
  operation: GlabOperation,
  input: ProcessRunInput,
  result: ProcessRunResult,
): GlabCommandEvidence => ({
  operation,
  command: { executable: input.executable, arguments: input.arguments, cwd: input.cwd },
  result,
})

const failed = (
  code: GlabFailureCode,
  operation: GlabOperation,
  input: ProcessRunInput,
  result: ProcessRunResult,
): GlabOperationResult<never> => ({
  status: 'failed',
  failure: { code, ...evidence(operation, input, result) },
})

const invalidResult = (): ProcessRunResult => ({
  status: 'failed-to-start',
  code: 'INVALID_INPUT',
  message: 'Process could not be started',
  durationMs: 0,
  stdout: '',
  stderr: '',
  stdoutTruncated: false,
  stderrTruncated: false,
})

const executionFailure = (): ProcessRunResult => ({
  status: 'failed-to-start',
  code: 'GLAB_EXECUTION_FAILED',
  message: 'Process could not be started',
  durationMs: 0,
  stdout: '',
  stderr: '',
  stdoutTruncated: false,
  stderrTruncated: false,
})

export const createGlabClient = (options: CreateGlabClientOptions): GlabClient => {
  if (!Number.isSafeInteger(options.commandTimeoutMs) || options.commandTimeoutMs <= 0) {
    throw new TypeError('commandTimeoutMs must be a positive safe integer')
  }
  const cwd = options.cwd ?? process.cwd()

  const run = async (
    operation: GlabOperation,
    arguments_: readonly string[],
    signal?: AbortSignal,
  ): Promise<GlabOperationResult<ProcessRunResult>> => {
    const input = command(cwd, arguments_, options.commandTimeoutMs, signal)
    let result: ProcessRunResult
    try {
      result = await options.processRunner.run(input)
    } catch {
      return failed('GLAB_COMMAND_FAILED', operation, input, executionFailure())
    }
    return successful(result)
      ? { status: 'succeeded', value: result, evidence: evidence(operation, input, result) }
      : failed('GLAB_COMMAND_FAILED', operation, input, result)
  }

  return {
    async listOpenMergeRequests(inputValue, signal) {
      const parsed = listInput.safeParse(inputValue)
      if (!parsed.success) {
        const input = command(cwd, [], options.commandTimeoutMs, signal)
        return failed('GLAB_INPUT_INVALID', 'list-open-merge-requests', input, invalidResult())
      }
      const input = parsed.data
      const endpoint =
        `projects/${encodeURIComponent(input.project)}/merge_requests` +
        `?state=opened&source_branch=${encodeURIComponent(input.sourceBranch)}` +
        `&target_branch=${encodeURIComponent(input.targetBranch)}&per_page=2`
      const result = await run(
        'list-open-merge-requests',
        ['api', '--method', 'GET', endpoint, '--output', 'json'],
        signal,
      )
      if (result.status === 'failed') return result
      let response: unknown
      try {
        response = JSON.parse(result.value.stdout)
      } catch {
        return failed(
          'GLAB_RESPONSE_INVALID',
          'list-open-merge-requests',
          { ...result.evidence.command, timeoutMs: options.commandTimeoutMs },
          result.value,
        )
      }
      const validated = mergeRequestListResponse.safeParse(response)
      if (!validated.success) {
        return failed(
          'GLAB_RESPONSE_INVALID',
          'list-open-merge-requests',
          { ...result.evidence.command, timeoutMs: options.commandTimeoutMs },
          result.value,
        )
      }
      return {
        status: 'succeeded',
        value: validated.data.map((mergeRequest) => ({
          iid: mergeRequest.iid,
          url: mergeRequest.web_url,
          state: mergeRequest.state,
          sourceBranch: mergeRequest.source_branch,
          targetBranch: mergeRequest.target_branch,
          headSha: mergeRequest.sha,
        })),
        evidence: result.evidence,
      }
    },

    async createMergeRequest(inputValue, signal) {
      const parsed = createInput.safeParse(inputValue)
      if (!parsed.success) {
        const input = command(cwd, [], options.commandTimeoutMs, signal)
        return failed('GLAB_INPUT_INVALID', 'create-merge-request', input, invalidResult())
      }
      const input = parsed.data
      const labels = input.labels.flatMap((label) => ['--label', label])
      const result = await run(
        'create-merge-request',
        [
          'mr',
          'create',
          '--repo',
          input.project,
          '--source-branch',
          input.sourceBranch,
          '--target-branch',
          input.targetBranch,
          '--title',
          input.title,
          '--description',
          input.description,
          ...labels,
          '--yes',
          '--no-editor',
        ],
        signal,
      )
      return result.status === 'failed'
        ? result
        : { status: 'succeeded', value: true, evidence: result.evidence }
    },
  }
}
