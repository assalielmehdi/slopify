import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createProcessRunner } from '@loop/execution-runtime'
import type { ProcessRunInput, ProcessRunResult, ProcessRunner } from '@loop/execution-runtime'
import { afterEach, describe, expect, it } from 'vitest'

import { createGlabClient } from '../src/index.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

const exited = (stdout = '', stderr = ''): ProcessRunResult => ({
  status: 'exited',
  exitCode: 0,
  signal: undefined,
  durationMs: 5,
  stdout,
  stderr,
  stdoutTruncated: false,
  stderrTruncated: false,
})

const createRunner = (results: readonly ProcessRunResult[]) => {
  const inputs: ProcessRunInput[] = []
  let index = 0
  const runner: ProcessRunner = {
    async run(input) {
      inputs.push(input)
      const result = results[index]
      index += 1
      if (result === undefined) throw new Error('Unexpected glab invocation')
      return result
    },
  }
  return { inputs, runner }
}

describe('bounded glab client', () => {
  it('queries at most two exact open merge requests and validates the response', async () => {
    const headSha = 'a'.repeat(40)
    const { inputs, runner } = createRunner([
      exited(
        JSON.stringify([
          {
            iid: 17,
            web_url: 'https://gitlab.example/group/api/-/merge_requests/17',
            state: 'opened',
            source_branch: 'ai/cu-123-run-01',
            target_branch: 'main',
            sha: headSha,
            ignored_future_field: true,
          },
        ]),
      ),
    ])
    const client = createGlabClient({ processRunner: runner, commandTimeoutMs: 10_000 })

    const result = await client.listOpenMergeRequests({
      project: 'group/api',
      sourceBranch: 'ai/cu-123-run-01',
      targetBranch: 'main',
    })

    expect(result).toMatchObject({
      status: 'succeeded',
      value: [
        {
          iid: 17,
          url: 'https://gitlab.example/group/api/-/merge_requests/17',
          state: 'opened',
          sourceBranch: 'ai/cu-123-run-01',
          targetBranch: 'main',
          headSha,
        },
      ],
    })
    expect(inputs).toEqual([
      {
        executable: 'glab',
        arguments: [
          'api',
          '--method',
          'GET',
          'projects/group%2Fapi/merge_requests?state=opened&source_branch=ai%2Fcu-123-run-01&target_branch=main&per_page=2',
          '--output',
          'json',
        ],
        cwd: process.cwd(),
        timeoutMs: 10_000,
      },
    ])
  })

  it('creates one non-interactive merge request with explicit branches and labels', async () => {
    const { inputs, runner } = createRunner([exited('Creating merge request... done')])
    const client = createGlabClient({ processRunner: runner, commandTimeoutMs: 10_000 })

    const result = await client.createMergeRequest({
      project: 'group/api',
      sourceBranch: 'ai/cu-123-run-01',
      targetBranch: 'main',
      title: '[CU-123] Validate requests',
      description: '## Task\n\nCU-123',
      labels: ['backend', 'workflow'],
    })

    expect(result.status).toBe('succeeded')
    expect(inputs[0]?.arguments).toEqual([
      'mr',
      'create',
      '--repo',
      'group/api',
      '--source-branch',
      'ai/cu-123-run-01',
      '--target-branch',
      'main',
      '--title',
      '[CU-123] Validate requests',
      '--description',
      '## Task\n\nCU-123',
      '--label',
      'backend',
      '--label',
      'workflow',
      '--yes',
      '--no-editor',
    ])
    expect(inputs[0]?.arguments).not.toContain('--push')
    expect(inputs[0]?.arguments.some((argument) => argument.includes('force'))).toBe(false)
  })

  it('returns a stable failure with command evidence for invalid GitLab JSON', async () => {
    const { runner } = createRunner([exited('{"iid":"not-a-number"}')])
    const client = createGlabClient({ processRunner: runner, commandTimeoutMs: 10_000 })

    const result = await client.listOpenMergeRequests({
      project: 'group/api',
      sourceBranch: 'ai/cu-123-run-01',
      targetBranch: 'main',
    })

    expect(result).toMatchObject({
      status: 'failed',
      failure: {
        code: 'GLAB_RESPONSE_INVALID',
        operation: 'list-open-merge-requests',
        result: { status: 'exited', exitCode: 0, stdout: '{"iid":"not-a-number"}' },
      },
    })
  })

  it('executes a fake glab in discovery-create-readback order with exact arguments', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'slopify-fake-glab-'))
    directories.push(directory)
    const executable = join(directory, 'glab')
    const logPath = join(directory, 'arguments.jsonl')
    const statePath = join(directory, 'merge-requests.json')
    const headSha = 'f'.repeat(40)
    writeFileSync(
      executable,
      `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + '\\n')
if (args[0] === 'api') {
  const state = fs.existsSync(${JSON.stringify(statePath)})
    ? fs.readFileSync(${JSON.stringify(statePath)}, 'utf8')
    : '[]'
  process.stdout.write(state)
  process.exit(0)
}
const valueAfter = (name) => args[args.indexOf(name) + 1]
const project = valueAfter('--repo')
const mergeRequest = [{
  iid: 27,
  web_url: 'https://gitlab.example/' + project + '/-/merge_requests/27',
  state: 'opened',
  source_branch: valueAfter('--source-branch'),
  target_branch: valueAfter('--target-branch'),
  sha: ${JSON.stringify(headSha)}
}]
fs.writeFileSync(${JSON.stringify(statePath)}, JSON.stringify(mergeRequest))
process.stdout.write('created')
`,
    )
    chmodSync(executable, 0o755)
    const processRunner = createProcessRunner({ maxOutputBytes: 64 * 1_024 })
    const runner: ProcessRunner = {
      run: (input) => processRunner.run({ ...input, executable }),
    }
    const client = createGlabClient({
      processRunner: runner,
      commandTimeoutMs: 10_000,
      cwd: directory,
    })
    const query = {
      project: 'group/api',
      sourceBranch: 'ai/cu-123-run-01',
      targetBranch: 'main',
    }

    expect(await client.listOpenMergeRequests(query)).toMatchObject({
      status: 'succeeded',
      value: [],
    })
    expect(
      await client.createMergeRequest({
        ...query,
        title: '[CU-123] Validate requests',
        description: '## Task\n\nCU-123',
        labels: ['backend'],
      }),
    ).toMatchObject({ status: 'succeeded' })
    expect(await client.listOpenMergeRequests(query)).toMatchObject({
      status: 'succeeded',
      value: [{ iid: 27, headSha }],
    })

    const invocations = readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[])
    expect(invocations.map(([operation]) => operation)).toEqual(['api', 'mr', 'api'])
    expect(invocations[1]).toContain('--source-branch')
    expect(invocations[1]).toContain('--target-branch')
    expect(invocations[1]).toContain('--no-editor')
    expect(invocations.flat().some((argument) => argument.includes('force'))).toBe(false)
  })
})
