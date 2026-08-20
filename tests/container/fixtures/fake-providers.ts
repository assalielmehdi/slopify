import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface FakeProviderFixture {
  readonly providerLogPath: string
  readonly runtimeControlledWorkflowPath: string
  readonly runtimeProviderServerPath: string
  readonly runtimeWorktreePath: string
}

export const writeFakeProviderFixture = async (
  workspaceRoot: string,
  marker: string,
): Promise<FakeProviderFixture> => {
  const providerServerPath = join(workspaceRoot, 'fake-providers.mjs')
  const providerLogPath = join(workspaceRoot, 'fake-provider-requests.jsonl')
  const controlledWorkflowPath = join(workspaceRoot, 'controlled-workflow.mjs')
  const runtimeProviderServerPath = '/workspace/fake-providers.mjs'
  const runtimeProviderLogPath = '/workspace/fake-provider-requests.jsonl'
  const runtimeControlledWorkflowPath = '/workspace/controlled-workflow.mjs'
  const runtimeWorktreePath = `/workspace/worktrees/${marker}`

  await writeFile(
    providerServerPath,
    `import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'

const logPath = ${JSON.stringify(runtimeProviderLogPath)}
if (!existsSync(logPath)) writeFileSync(logPath, '')

const json = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

const server = createServer((request, response) => {
  const url = request.url ?? '/'
  const connector = url.startsWith('/api/v2/')
    ? 'clickup'
    : url.startsWith('/api/v4/')
      ? 'gitlab'
      : url.startsWith('/v1/')
        ? 'model'
        : 'health'
  appendFileSync(logPath, JSON.stringify({ connector, method: request.method, url }) + '\\n')

  if (url === '/healthz') return json(response, 200, { status: 'ok' })
  if (url.includes('/comment')) return json(response, 200, { comments: [] })
  if (url.startsWith('/api/v2/task/')) {
    return json(response, 200, {
      id: '86container43',
      custom_id: 'CNT-43',
      name: 'Run isolated container acceptance',
      description: 'Controlled fake-provider task.',
      status: { id: 'status-progress', status: 'in progress', type: 'custom' },
      priority: { id: '2', priority: 'high' },
      url: 'https://app.clickup.com/t/86container43',
      attachments: [],
    })
  }
  if (url === '/api/v4/version') return json(response, 200, { version: '18.3.0-fake' })
  if (url === '/v1/models') return json(response, 200, { data: [{ id: 'fake-model' }] })
  return json(response, 404, { error: 'not found' })
})

server.listen(4555, '127.0.0.1')
const close = () => server.close(() => process.exit(0))
process.on('SIGINT', close)
process.on('SIGTERM', close)
`,
  )

  await writeFile(
    controlledWorkflowPath,
    `import {
  createExecutorRegistry,
  createLoadClickUpTaskExecutor,
  createProcessRunner,
  createRegisteredCommandExecutors,
  createRunEngine,
  createRunRepository,
  createWorkflowRepository,
  openDatabase,
} from 'file:///app/node_modules/@loop/execution-runtime/dist/index.js'

const [runId, mode = 'success'] = process.argv.slice(2)
if (runId === undefined) throw new Error('runId is required')

const database = openDatabase({ path: '/var/lib/workbench/workbench.sqlite' })
const runs = createRunRepository(database)
const workflows = createWorkflowRepository(database)
const runner = createProcessRunner({
  maxOutputBytes: 65_536,
  redactedValues: [
    process.env.CLICKUP_API_TOKEN,
    process.env.GITLAB_TOKEN,
    process.env.MODEL_PROVIDER_API_KEY,
  ].filter((value) => typeof value === 'string' && value.length > 0),
})
const worktreePath = ${JSON.stringify(runtimeWorktreePath)}
const branch = ${JSON.stringify(`acceptance/${marker}`)}
const hangMarker = ${JSON.stringify(`slopify-container-hang-${marker}`)}
const registered = createRegisteredCommandExecutors({
  runner,
  commands: {
    'prepare-git-worktrees':
      mode === 'hang'
        ? {
            executable: 'bash',
            arguments: [
              '-c',
              'printf "%s" "$BASHPID" > /workspace/hanging.pid; exec -a "' +
                hangMarker +
                '" sleep 300',
            ],
            cwd: '/workspace/repository',
            exitCodeOutcomes: { 0: 'ready' },
          }
        : {
            executable: 'git',
            arguments: [
              '-C',
              '/workspace/repository',
              'worktree',
              'add',
              '-b',
              branch,
              worktreePath,
              'origin/main',
            ],
            cwd: '/workspace/repository',
            exitCodeOutcomes: { 0: 'ready' },
          },
    'verify-selected-repositories': {
      executable: 'git',
      arguments: ['-C', worktreePath, 'status', '--porcelain'],
      cwd: worktreePath,
      exitCodeOutcomes: { 0: 'passed' },
    },
  },
})
const succeed = (outcome) => ({
  async execute() {
    return { status: 'succeeded', outcome, artifactIds: [], output: { boundary: 'fake' } }
  },
})
const agentOutcomes = {
  'select-repositories': 'selected',
  plan: 'ready',
  implement: 'implemented',
  'requirements-review': 'reviewed',
  'security-review': 'reviewed',
  'simplification-review': 'reviewed',
  'fix-findings': 'fixed',
}
const agent = {
  async execute(context) {
    const outcome = agentOutcomes[context.node.id]
    if (outcome === undefined) {
      return { status: 'failed', code: 'FAKE_AGENT_UNMAPPED', message: 'Fake agent is unmapped' }
    }
    return { status: 'succeeded', outcome, artifactIds: [], output: { boundary: 'fake-model' } }
  },
}
const engine = createRunEngine({
  runs,
  workflows,
  executors: createExecutorRegistry({
    agent,
    commands: {
      ...registered,
      'load-clickup-task': createLoadClickUpTaskExecutor(),
      'aggregate-review-findings': succeed('clean'),
      'finalize-gitlab-delivery': succeed('delivered'),
    },
  }),
})

try {
  console.log(JSON.stringify(await engine.execute(runId)))
} finally {
  database.close()
}
`,
  )

  return {
    providerLogPath,
    runtimeControlledWorkflowPath,
    runtimeProviderServerPath,
    runtimeWorktreePath,
  }
}
