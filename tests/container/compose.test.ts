import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

import { writeAgentWorkflowFixture } from './fixtures/fake-providers.js'

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

const waitFor = async (assertion: () => Promise<void>, timeoutMs = 30_000): Promise<void> => {
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
  it('proves agent-only workflow, terminal cancellation, secrecy, and persistence', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'slopify-container-'))
    const marker = `c${Date.now().toString(36)}`
    const project = `slopify${marker}`
    const appPort = await availablePort()
    const fixture = await writeAgentWorkflowFixture(workspace)
    const origin = `http://127.0.0.1:${appPort}`
    const volumeName = `${project}_workbench-data`
    const secret = `container-secret-${marker}`
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      API_SHUTDOWN_GRACE_MS: '3000',
      APP_HOST: '127.0.0.1',
      APP_PORT: String(appPort),
      COMPOSE_PROJECT_NAME: project,
      DATABASE_PATH: '/var/lib/workbench/workbench.sqlite',
      WORKSPACE_HOST_PATH: workspace,
    }
    const compose = (arguments_: readonly string[], timeout = 30_000) =>
      run('docker', ['compose', '--project-name', project, ...arguments_], {
        env: environment,
        timeout,
      })

    try {
      await compose(['config', '--quiet'])
      const services = await compose(['config', '--services'])
      expect(services.stdout.trim().split(/\s+/).sort()).toEqual(['api', 'web'])

      await compose(['up', '--build', '--wait', '--wait-timeout', '120'], 600_000)

      await expect(requestJson(origin, '/api/healthz')).resolves.toEqual({
        body: { status: 'ok' },
        status: 200,
      })
      const workflows = await requestJson(origin, '/api/workflows')
      expect(workflows).toMatchObject({
        status: 200,
        body: {
          workflows: [
            {
              workflowId: 'delivery-workflow',
              startNodeId: 'identify-agent',
              nodes: [{ id: 'identify-agent', type: 'agent', job: { kind: 'agent' } }],
              edges: [],
            },
          ],
        },
      })

      const apiContainer = (await compose(['ps', '--quiet', 'api'])).stdout.trim()
      const webContainer = (await compose(['ps', '--quiet', 'web'])).stdout.trim()
      expect(
        (
          await run('docker', [
            'inspect',
            apiContainer,
            '--format',
            '{{json .NetworkSettings.Ports}}',
          ])
        ).stdout,
      ).toContain('"3001/tcp":null')
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
      await expect(compose(['exec', '--no-TTY', 'api', 'id', '-u'])).resolves.toMatchObject({
        stdout: '1000\n',
      })
      await expect(compose(['exec', '--no-TTY', 'web', 'id', '-u'])).resolves.toMatchObject({
        stdout: '1000\n',
      })

      const containerEnvironment = JSON.parse(
        (await run('docker', ['inspect', apiContainer, '--format', '{{json .Config.Env}}'])).stdout,
      ) as string[]
      expect(
        containerEnvironment.some((entry) =>
          /^(CLICKUP_API_|GITLAB_(HOST|TOKEN)|MODEL_PROVIDER_API_KEY)=/u.test(entry),
        ),
      ).toBe(false)

      const configured = await compose(
        ['exec', '--no-TTY', 'api', 'node', fixture.runtimeConfigurationPath, secret],
        60_000,
      )
      expect(JSON.parse(configured.stdout.trim())).toEqual({ configured: true })

      const workflow = await requestJson(origin, '/api/workflows/delivery-workflow')
      expect(workflow).toMatchObject({
        status: 200,
        body: {
          workflowId: 'delivery-workflow',
          nodes: [{ type: 'agent', job: { prompt: 'Introduce yourself to {{audience}}.' } }],
        },
      })
      const connections = await requestJson(origin, '/api/connections')
      expect(connections).toMatchObject({
        status: 200,
        body: {
          connections: [
            {
              connectionId: 'chatgpt-subscription-default',
              type: 'chatgpt-subscription',
              status: 'CONNECTED',
            },
          ],
        },
      })
      expect(JSON.stringify(connections.body)).not.toContain(secret)

      const missing = await requestJson(origin, '/api/runs', {
        body: { workflowId: 'delivery-workflow' },
        method: 'POST',
      })
      expect(missing).toEqual({
        status: 409,
        body: {
          error: {
            code: 'RUN_VARIABLES_MISSING',
            message: 'Required workflow variables are missing',
            details: { missingVariables: ['audience'] },
          },
        },
      })
      expect(await requestJson(origin, '/api/runs?page=1&pageSize=20')).toMatchObject({
        status: 200,
        body: { pagination: { totalItems: 0 }, data: [] },
      })

      const created = await requestJson(origin, '/api/runs', {
        body: { workflowId: 'delivery-workflow', confirmMissingVariables: true },
        method: 'POST',
      })
      expect(created).toMatchObject({
        status: 201,
        body: { status: 'RUNNING', variables: {}, missingVariables: ['audience'] },
      })
      const runId = (created.body as { runId: string }).runId
      expect(await firstSseEvent(origin, runId)).toContain('"type":"RUN_STARTED"')

      await waitFor(async () => {
        expect(await requestJson(origin, `/api/runs/${runId}`)).toMatchObject({
          status: 200,
          body: {
            run: { status: 'FAILED' },
            nodeExecutions: [{ nodeId: 'identify-agent', status: 'FAILED' }],
          },
        })
      })
      expect(
        await requestJson(origin, `/api/runs/${runId}/cancel`, { method: 'POST' }),
      ).toMatchObject({
        status: 409,
        body: { error: { code: 'RUN_NOT_CANCELLABLE' } },
      })

      const databaseSizeBefore = Number(
        (
          await compose([
            'exec',
            '--no-TTY',
            'api',
            'node',
            '-e',
            "import('node:fs').then(fs=>console.log(fs.statSync('/var/lib/workbench/workbench.sqlite').size))",
          ])
        ).stdout.trim(),
      )
      expect(databaseSizeBefore).toBeGreaterThan(0)

      const logs = (await compose(['logs', '--no-color'])).stdout
      expect(logs).not.toContain(secret)
      expect(logs).not.toContain(`refresh-${secret}`)
      await run('docker', ['volume', 'inspect', volumeName])

      await compose(
        ['up', '--detach', '--force-recreate', '--wait', '--wait-timeout', '120', 'api'],
        180_000,
      )
      expect(await requestJson(origin, '/api/runs?page=1&pageSize=20')).toMatchObject({
        status: 200,
        body: {
          pagination: { totalItems: 1 },
          data: [{ runId, status: 'FAILED' }],
        },
      })
      expect(await requestJson(origin, `/api/runs/${runId}`)).toMatchObject({
        status: 200,
        body: {
          run: {
            runId,
            status: 'FAILED',
            workflowSnapshot: { workflowId: 'delivery-workflow' },
            missingVariables: ['audience'],
          },
        },
      })
      await compose(['down', '--timeout', '5'], 60_000)
      await run('docker', ['volume', 'inspect', volumeName])
      await compose(['up', '--detach', '--wait', '--wait-timeout', '120'], 180_000)
      expect(await requestJson(origin, '/api/runs?page=1&pageSize=20')).toMatchObject({
        status: 200,
        body: { pagination: { totalItems: 1 }, data: [{ runId, status: 'FAILED' }] },
      })
      const databaseSizeAfter = Number(
        (
          await compose([
            'exec',
            '--no-TTY',
            'api',
            'node',
            '-e',
            "import('node:fs').then(fs=>console.log(fs.statSync('/var/lib/workbench/workbench.sqlite').size))",
          ])
        ).stdout.trim(),
      )
      expect(databaseSizeAfter).toBeGreaterThanOrEqual(databaseSizeBefore)
    } finally {
      await run(
        'docker',
        [
          'compose',
          '--project-name',
          project,
          'down',
          '--timeout',
          '5',
          '--volumes',
          '--remove-orphans',
        ],
        { env: environment, timeout: 60_000 },
      ).catch(() => undefined)
      for (const image of [`${project}-api`, `${project}-web`]) {
        await run('docker', ['image', 'rm', image], { timeout: 60_000 }).catch(() => undefined)
      }
      await rm(workspace, { force: true, recursive: true })
    }
  })
})
