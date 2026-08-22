import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface AgentWorkflowFixture {
  readonly runtimeConfigurationPath: string
}

export const writeAgentWorkflowFixture = async (
  workspaceRoot: string,
): Promise<AgentWorkflowFixture> => {
  const configurationPath = join(workspaceRoot, 'configure-agent-workflow.mjs')
  const runtimeConfigurationPath = '/workspace/configure-agent-workflow.mjs'

  await writeFile(
    configurationPath,
    `import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getBunAgentWorkerScriptPath } from 'file:///app/node_modules/@slopify/agent-runtimes/dist/index.js'
import { createPredefinedV1Workflow } from 'file:///app/node_modules/@slopify/workflow-model/dist/index.js'
import {
  createChatGptSubscriptionConnectionDriver,
  createConnectionCatalogRepository,
  createConnectionRepository,
  createConnectionService,
  createFileCredentialStore,
  createWorkflowRepository,
  openDatabase,
} from 'file:///app/node_modules/@slopify/execution-runtime/dist/index.js'

const secret = process.argv[2]
if (secret === undefined) throw new Error('secret is required')

const database = openDatabase({ path: '/var/lib/workbench/workbench.sqlite' })
try {
  const workflows = createWorkflowRepository(database)
  const workflow = workflows.get('delivery-workflow')
  if (workflow === undefined) throw new Error('predefined workflow is missing')
  const configuredWorkflow = createPredefinedV1Workflow({
    createdAt: workflow.createdAt,
    agentDefaults: {
      provider: 'chatgpt-subscription',
      model: 'gpt-5.4',
      thinkingLevel: 'medium',
    },
  })
  workflows.save({
    ...configuredWorkflow,
    updatedAt: new Date().toISOString(),
    nodes: configuredWorkflow.nodes.map((node) =>
      node.type === 'agent' && node.id === configuredWorkflow.startNodeId
        ? {
            ...node,
            job: { ...node.job, prompt: 'Introduce yourself to {{audience}}.' },
          }
        : node,
    ),
  })

  const connections = createConnectionService({
    connections: createConnectionRepository(database),
    catalog: createConnectionCatalogRepository(database),
    credentials: createFileCredentialStore({
      path: join(homedir(), '.slopify', 'credentials.json'),
    }),
    drivers: [createChatGptSubscriptionConnectionDriver()],
  })
  await connections.connect({
    type: 'chatgpt-subscription',
    configuration: { provider: 'openai-codex' },
    credential: {
      type: 'oauth',
      access: secret,
      refresh: 'refresh-' + secret,
      expires: 4102444800000,
      accountId: 'container-acceptance',
    },
  })

  await writeFile(getBunAgentWorkerScriptPath(), ${JSON.stringify(`let input
const keepAlive = setInterval(() => undefined, 1000)

const send = (value) => process.send?.({ version: 1, ...value })

process.on('message', (incoming) => {
  if (incoming === null || typeof incoming !== 'object') return
  const value = incoming
  if (value.version !== 1 || typeof value.type !== 'string') return

  if (value.type === 'START') {
    input = value.input
    send({
      type: 'CREDENTIAL_READ',
      requestId: 'container-credential-read',
      connectionId: value.context.inferenceConnectionId,
    })
    return
  }

  if (value.type === 'CREDENTIAL_VALUE' && input !== undefined) {
    send({
      type: 'EVENT',
      event: {
        executionId: input.executionId,
        runId: input.runId,
        nodeId: input.nodeId,
        timestamp: new Date().toISOString(),
        type: 'AGENT_FAILED',
        data: {
          code: 'CONTAINER_ACCEPTANCE_FAILURE',
          message: 'Controlled container acceptance failure',
          durationMs: 0,
        },
      },
    })
    send({ type: 'COMPLETE' })
    clearInterval(keepAlive)
    setTimeout(() => process.exit(0), 0)
  }
})
`)})
  console.log(JSON.stringify({ configured: true }))
} finally {
  database.close()
}
`,
  )

  return { runtimeConfigurationPath }
}
