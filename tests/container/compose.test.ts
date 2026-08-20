import { execFile } from 'node:child_process'
import { access, readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

import { writeFakeProviderFixture } from './fixtures/fake-providers.js'
import { createRepositoryFixture } from './fixtures/repository.js'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(import.meta.dirname, '../..')

interface CommandResult {
  readonly stderr: string
  readonly stdout: string
}

const run = async (
  executable: string,
  arguments_: readonly string[],
  options: {
    readonly env?: NodeJS.ProcessEnv
    readonly timeout?: number
  } = {},
): Promise<CommandResult> => {
  const result = await execFileAsync(executable, arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: options.env ?? process.env,
    maxBuffer: 16 * 1_024 * 1_024,
    timeout: options.timeout ?? 30_000,
  })
  return { stderr: result.stderr, stdout: result.stdout }
}

const availablePort = async (): Promise<number> => {
  const server = createServer()
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Port was not allocated')
  await new Promise<void>((resolvePromise, reject) =>
    server.close((error) => (error === undefined ? resolvePromise() : reject(error))),
  )
  return address.port
}

const waitFor = async (assertion: () => Promise<void>, timeoutMs = 15_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      await assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 150))
    }
  }
  throw lastError
}

const requestJson = async (
  origin: string,
  path: string,
  options: { readonly body?: unknown; readonly method?: string } = {},
): Promise<{ readonly body: unknown; readonly status: number }> => {
  const response = await fetch(`${origin}${path}`, {
    headers: {
      accept: 'application/json',
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    method: options.method ?? 'GET',
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(10_000),
  })
  return { body: (await response.json()) as unknown, status: response.status }
}

const firstSseEvent = async (origin: string, runId: string): Promise<string> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(`${origin}/api/runs/${runId}/events?afterSequence=0`, {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    if (response.body === null) throw new Error('SSE response body is missing')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let body = ''
    while (!body.includes('\n\n')) {
      const chunk = await reader.read()
      if (chunk.done) break
      body += decoder.decode(chunk.value, { stream: true })
    }
    await reader.cancel()
    return body
  } finally {
    clearTimeout(timeout)
  }
}

describe('two-service Compose acceptance', () => {
  it('proves isolated readiness, workflow, shutdown, and persistence contracts', async () => {
    const repository = await createRepositoryFixture()
    const marker = `c${Date.now().toString(36)}`
    const project = `slopify${marker}`
    const appPort = await availablePort()
    const fakeProviders = await writeFakeProviderFixture(repository.root, marker)
    const origin = `http://127.0.0.1:${appPort}`
    const volumeName = `${project}_workbench-data`
    const blankEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      API_SHUTDOWN_GRACE_MS: '3000',
      APP_HOST: '127.0.0.1',
      APP_PORT: String(appPort),
      CLICKUP_API_BASE_URL: 'http://127.0.0.1:4555/api/v2/',
      CLICKUP_API_TOKEN: '',
      COMPOSE_PROJECT_NAME: project,
      DATABASE_PATH: '/var/lib/workbench/workbench.sqlite',
      GITLAB_HOST: 'http://127.0.0.1:4555',
      GITLAB_TOKEN: '',
      MODEL_PROVIDER_API_KEY: '',
      WORKSPACE_HOST_PATH: repository.root,
    }
    const configuredEnvironment: NodeJS.ProcessEnv = {
      ...blankEnvironment,
      CLICKUP_API_TOKEN: `fake-clickup-${marker}`,
      GITLAB_TOKEN: `fake-gitlab-${marker}`,
      MODEL_PROVIDER_API_KEY: `fake-model-${marker}`,
    }
    const compose = (
      arguments_: readonly string[],
      environment: NodeJS.ProcessEnv = configuredEnvironment,
      timeout = 30_000,
    ) =>
      run('docker', ['compose', '--project-name', project, ...arguments_], {
        env: environment,
        timeout,
      })
    const startFakeProviders = async (): Promise<void> => {
      await compose([
        'exec',
        '--detach',
        '--no-TTY',
        'api',
        'bun',
        fakeProviders.runtimeProviderServerPath,
      ])
      await waitFor(async () => {
        await compose([
          'exec',
          '--no-TTY',
          'api',
          'bun',
          '-e',
          "fetch('http://127.0.0.1:4555/healthz').then(r=>{if(!r.ok)process.exit(1)})",
        ])
      })
    }
    const profile = {
      profileId: 'container-acceptance',
      displayName: 'Container acceptance',
      clickupWorkspaceId: 'workspace-fake',
      clickupListId: 'list-fake',
      clickupInReviewStatusId: 'status-review',
      repositories: [
        {
          repositoryId: 'fixture',
          displayName: 'Fixture repository',
          purpose: 'Exercise the mounted repository boundary.',
          repositoryPath: '/workspace/repository',
          gitlabProject: '../remote',
          remote: 'origin',
          targetBranch: 'main',
          worktreeParent: '/workspace/worktrees',
          branchTemplate: 'acceptance/{taskId}-{run}',
          executableChecks: [
            {
              executable: 'git',
              arguments: ['--version'],
              expectedOutputIncludes: 'git version',
            },
          ],
          verificationCommands: [{ executable: 'git', arguments: ['status', '--porcelain'] }],
          mergeRequestLabels: [],
        },
      ],
    }
    const runRequest = {
      taskReference: '86container43',
      workflowId: 'delivery-workflow',
      revisionId: 'revision-01',
      profileId: profile.profileId,
    }

    try {
      await compose(['config', '--quiet'], blankEnvironment)
      const services = await compose(['config', '--services'], blankEnvironment)
      expect(services.stdout.trim().split(/\s+/).sort()).toEqual(['api', 'web'])

      await compose(['up', '--build', '--wait', '--wait-timeout', '120'], blankEnvironment, 600_000)

      await expect(requestJson(origin, '/api/healthz')).resolves.toEqual({
        body: { status: 'ok' },
        status: 200,
      })
      await expect(requestJson(origin, '/api/connectors/status')).resolves.toEqual({
        body: { clickup: false, gitlab: false, modelProvider: false },
        status: 200,
      })
      const workflows = await requestJson(origin, '/api/workflows')
      expect(workflows).toMatchObject({
        status: 200,
        body: {
          workflows: [{ workflowId: 'delivery-workflow', latestRevisionId: 'revision-01' }],
        },
      })
      expect(
        await requestJson(origin, '/api/project-profiles', { body: profile, method: 'POST' }),
      ).toMatchObject({ status: 201 })
      expect(await requestJson(origin, '/api/runs', { body: runRequest, method: 'POST' })).toEqual({
        status: 422,
        body: { error: { code: 'PROFILE_NOT_READY', message: 'Project profile is not ready' } },
      })

      const apiContainer = (await compose(['ps', '--quiet', 'api'], blankEnvironment)).stdout.trim()
      const webContainer = (await compose(['ps', '--quiet', 'web'], blankEnvironment)).stdout.trim()
      expect(
        (
          await run('docker', [
            'inspect',
            apiContainer,
            '--format',
            '{{json .NetworkSettings.Ports}}',
          ])
        ).stdout.trim(),
      ).toBe('{"3001/tcp":null}')
      expect(
        JSON.parse(
          (
            await run('docker', [
              'inspect',
              webContainer,
              '--format',
              '{{json .NetworkSettings.Ports}}',
            ])
          ).stdout,
        ) as Record<string, unknown>,
      ).toEqual({
        '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: String(appPort) }],
      })
      await expect(
        compose(['exec', '--no-TTY', 'api', 'id', '-u'], blankEnvironment),
      ).resolves.toMatchObject({ stdout: '1000\n' })
      await expect(
        compose(['exec', '--no-TTY', 'web', 'id', '-u'], blankEnvironment),
      ).resolves.toMatchObject({ stdout: '1000\n' })

      await compose(
        ['up', '--detach', '--force-recreate', '--wait', '--wait-timeout', '120'],
        configuredEnvironment,
        180_000,
      )
      await startFakeProviders()
      await compose([
        'exec',
        '--no-TTY',
        'api',
        'bun',
        '-e',
        "Promise.all([fetch('http://127.0.0.1:4555/api/v4/version'),fetch('http://127.0.0.1:4555/v1/models')]).then(rs=>{if(rs.some(r=>!r.ok))process.exit(1)})",
      ])

      await expect(requestJson(origin, '/api/connectors/status')).resolves.toEqual({
        body: { clickup: true, gitlab: true, modelProvider: true },
        status: 200,
      })
      expect(
        await requestJson(origin, `/api/project-profiles/${profile.profileId}/readiness`),
      ).toMatchObject({
        status: 200,
        body: { profileId: profile.profileId, ready: true, repositories: [{ ready: true }] },
      })
      expect(
        await requestJson(origin, '/api/clickup/tasks/resolve', {
          body: { taskReference: runRequest.taskReference, profileId: profile.profileId },
          method: 'POST',
        }),
      ).toMatchObject({
        status: 200,
        body: { taskId: '86container43', title: 'Run isolated container acceptance' },
      })

      const created = await requestJson(origin, '/api/runs', { body: runRequest, method: 'POST' })
      expect(created).toMatchObject({ status: 201, body: { status: 'PENDING' } })
      const successfulRunId = (created.body as { runId: string }).runId
      expect(await firstSseEvent(origin, successfulRunId)).toContain('"type":"RUN_STARTED"')

      const controlled = await compose(
        [
          'exec',
          '--no-TTY',
          'api',
          'bun',
          fakeProviders.runtimeControlledWorkflowPath,
          successfulRunId,
          'success',
        ],
        configuredEnvironment,
        120_000,
      )
      expect(JSON.parse(controlled.stdout.trim())).toMatchObject({
        status: 'completed',
        run: { status: 'SUCCEEDED' },
      })
      expect(await requestJson(origin, `/api/runs/${successfulRunId}`)).toMatchObject({
        status: 200,
        body: { run: { status: 'SUCCEEDED' } },
      })
      await access(fakeProviders.runtimeWorktreePath.replace('/workspace', repository.root))
      expect((await stat(fakeProviders.providerLogPath)).size).toBeGreaterThan(0)
      const providerCalls = (await readFile(fakeProviders.providerLogPath, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { connector: string })
      expect(new Set(providerCalls.map(({ connector }) => connector))).toEqual(
        new Set(['health', 'clickup', 'gitlab', 'model']),
      )

      const databaseSizeBefore = Number(
        (
          await compose([
            'exec',
            '--no-TTY',
            'api',
            'bun',
            '-e',
            "import('node:fs').then(fs=>console.log(fs.statSync('/var/lib/workbench/workbench.sqlite').size))",
          ])
        ).stdout.trim(),
      )
      expect(databaseSizeBefore).toBeGreaterThan(0)

      await compose(
        ['up', '--detach', '--force-recreate', '--wait', '--wait-timeout', '120', 'api'],
        configuredEnvironment,
        180_000,
      )
      await startFakeProviders()
      expect(await requestJson(origin, '/api/runs?page=1&pageSize=20')).toMatchObject({
        status: 200,
        body: {
          pagination: { totalItems: 1 },
          data: [{ runId: successfulRunId, status: 'SUCCEEDED' }],
        },
      })

      const hanging = await requestJson(origin, '/api/runs', { body: runRequest, method: 'POST' })
      expect(hanging).toMatchObject({ status: 201, body: { status: 'PENDING' } })
      const hangingRunId = (hanging.body as { runId: string }).runId
      await compose([
        'exec',
        '--detach',
        '--no-TTY',
        'api',
        'bun',
        fakeProviders.runtimeControlledWorkflowPath,
        hangingRunId,
        'hang',
      ])
      await waitFor(async () => {
        expect(await requestJson(origin, `/api/runs/${hangingRunId}`)).toMatchObject({
          status: 200,
          body: { run: { status: 'RUNNING', currentNodeId: 'prepare-worktrees' } },
        })
      })
      const runningApiContainer = (await compose(['ps', '--quiet', 'api'])).stdout.trim()
      expect(
        (await run('docker', ['top', runningApiContainer, '-eo', 'pid,args'])).stdout,
      ).toContain(`slopify-container-hang-${marker}`)

      await compose(['stop', '--timeout', '5', 'api'], configuredEnvironment, 30_000)
      await compose(
        ['up', '--detach', '--wait', '--wait-timeout', '120', 'api'],
        configuredEnvironment,
        180_000,
      )
      await startFakeProviders()
      expect(await requestJson(origin, `/api/runs/${hangingRunId}`)).toMatchObject({
        status: 200,
        body: { run: { status: 'INTERRUPTED' } },
      })
      const restartedApiContainer = (await compose(['ps', '--quiet', 'api'])).stdout.trim()
      expect(
        (await run('docker', ['top', restartedApiContainer, '-eo', 'pid,args'])).stdout,
      ).not.toContain(`slopify-container-hang-${marker}`)

      const logs = (await compose(['logs', '--no-color'])).stdout
      expect(logs).not.toContain(configuredEnvironment.CLICKUP_API_TOKEN)
      expect(logs).not.toContain(configuredEnvironment.GITLAB_TOKEN)
      expect(logs).not.toContain(configuredEnvironment.MODEL_PROVIDER_API_KEY)
      await run('docker', ['volume', 'inspect', volumeName])

      await compose(['down', '--timeout', '5'], configuredEnvironment, 60_000)
      await run('docker', ['volume', 'inspect', volumeName])
      await compose(
        ['up', '--detach', '--wait', '--wait-timeout', '120'],
        configuredEnvironment,
        180_000,
      )
      await startFakeProviders()
      expect(await requestJson(origin, '/api/runs?page=1&pageSize=20')).toMatchObject({
        status: 200,
        body: {
          pagination: { totalItems: 2 },
          data: expect.arrayContaining([
            expect.objectContaining({ runId: successfulRunId, status: 'SUCCEEDED' }),
            expect.objectContaining({ runId: hangingRunId, status: 'INTERRUPTED' }),
          ]),
        },
      })
      const databaseSizeAfter = Number(
        (
          await compose([
            'exec',
            '--no-TTY',
            'api',
            'bun',
            '-e',
            "import('node:fs').then(fs=>console.log(fs.statSync('/var/lib/workbench/workbench.sqlite').size))",
          ])
        ).stdout.trim(),
      )
      expect(databaseSizeAfter).toBeGreaterThanOrEqual(databaseSizeBefore)
    } finally {
      await compose(
        ['down', '--timeout', '5', '--volumes', '--remove-orphans'],
        configuredEnvironment,
        60_000,
      ).catch(() => undefined)
      for (const image of [`${project}-api`, `${project}-web`]) {
        await run('docker', ['image', 'rm', image], { timeout: 60_000 }).catch(() => undefined)
      }
      await repository.cleanup()
    }
  })
})
