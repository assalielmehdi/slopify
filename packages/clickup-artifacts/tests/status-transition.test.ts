import { once } from 'node:events'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'

import {
  ClickUpArtifactError,
  ClickUpClientError,
  createClickUpArtifactService,
  createClickUpClient,
  type ArtifactProducerPolicy,
  type ClickUpTaskId,
} from '../src/index.js'

interface RecordedRequest {
  readonly method: string
  readonly url: string
  readonly body: unknown
}

interface StatusServerOptions {
  readonly persistStatus?: boolean
  readonly updateStatus?: number
  readonly updateResponse?: unknown
}

const servers: Server[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

const sendJson = (response: ServerResponse, value: unknown, status = 200): void => {
  response.statusCode = status
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(value))
}

const taskResponse = (statusId: string) => ({
  id: '86abc123',
  custom_id: 'PROJ-42',
  name: 'Implement guarded transition',
  description: 'Move only after delivery orchestration authorizes it.',
  status: {
    id: statusId,
    status: statusId === 'status-in-review' ? 'in review' : 'in progress',
    type: 'custom',
  },
  priority: null,
  url: 'https://app.clickup.com/t/86abc123',
  attachments: [],
})

const startStatusServer = async (options: StatusServerOptions = {}) => {
  const requests: RecordedRequest[] = []
  let currentStatusId = 'status-in-progress'
  const server = createServer(async (request, response) => {
    const method = request.method ?? ''
    const url = request.url ?? ''
    if (method === 'PUT' && url === '/api/v2/task/86abc123') {
      const body = await readJsonBody(request)
      requests.push({ method, url, body })
      if (options.updateStatus !== undefined && options.updateStatus !== 200) {
        sendJson(response, { err: 'provider body pk_test_secret' }, options.updateStatus)
        return
      }
      if (options.persistStatus !== false) currentStatusId = 'status-in-review'
      sendJson(response, options.updateResponse ?? taskResponse(currentStatusId))
      return
    }
    if (method === 'GET' && url === '/api/v2/task/86abc123?include_markdown_description=true') {
      requests.push({ method, url, body: undefined })
      sendJson(response, taskResponse(currentStatusId))
      return
    }
    if (method === 'GET' && url === '/api/v2/task/86abc123/comment') {
      requests.push({ method, url, body: undefined })
      sendJson(response, { comments: [] })
      return
    }
    sendJson(response, { err: 'unexpected request' }, 404)
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${address.port}/api/v2`,
    requests,
  }
}

const producerPolicy: ArtifactProducerPolicy = {
  agentProducer: 'pi-sdk@0.52.0',
  commandProducers: ['aggregate-review-findings', 'finalize-gitlab-delivery'],
}

const createService = (
  server: Awaited<ReturnType<typeof startStatusServer>>,
  inReviewStatusId: string | null = 'status-in-review',
) =>
  createClickUpArtifactService({
    client: createClickUpClient({
      token: 'pk_test_secret',
      workspaceId: '123456',
      baseUrl: server.baseUrl,
    }),
    producerPolicy,
    ...(inReviewStatusId === null ? {} : { inReviewStatusId }),
  })

describe('ClickUp In Review status transition', () => {
  it('moves to the configured status once and requires provider readback', async () => {
    const server = await startStatusServer()
    const service = createService(server)

    const snapshot = await service.moveToInReview('86abc123')

    expect(snapshot.status).toEqual({ id: 'status-in-review', name: 'in review', type: 'custom' })
    expect(server.requests).toEqual([
      {
        method: 'PUT',
        url: '/api/v2/task/86abc123',
        body: { status: 'status-in-review' },
      },
      {
        method: 'GET',
        url: '/api/v2/task/86abc123?include_markdown_description=true',
        body: undefined,
      },
      {
        method: 'GET',
        url: '/api/v2/task/86abc123/comment',
        body: undefined,
      },
    ])
  })

  it('fails uncertain readback without retrying the status mutation', async () => {
    const server = await startStatusServer({ persistStatus: false })
    const service = createService(server)

    await expect(service.moveToInReview('86abc123')).rejects.toMatchObject({
      code: 'STATUS_TRANSITION_FAILED',
      operation: 'MOVE_TO_IN_REVIEW',
      context: { taskId: '86abc123' },
    } satisfies Partial<ClickUpArtifactError>)
    expect(server.requests.map(({ method }) => method)).toEqual(['PUT', 'GET', 'GET'])
  })

  it('rejects missing status configuration before contacting ClickUp', async () => {
    const server = await startStatusServer()
    const service = createService(server, null)

    await expect(service.moveToInReview('86abc123')).rejects.toMatchObject({
      code: 'STATUS_TRANSITION_FAILED',
      operation: 'MOVE_TO_IN_REVIEW',
    } satisfies Partial<ClickUpArtifactError>)
    expect(server.requests).toEqual([])
  })

  it('rejects non-canonical task references before contacting ClickUp', async () => {
    const server = await startStatusServer()
    const service = createService(server)

    await expect(
      service.moveToInReview('https://app.clickup.com/t/86abc123' as ClickUpTaskId),
    ).rejects.toMatchObject({
      code: 'ARTIFACT_INPUT_INVALID',
      operation: 'MOVE_TO_IN_REVIEW',
    } satisfies Partial<ClickUpArtifactError>)
    expect(server.requests).toEqual([])
  })

  it('maps provider rejection without leaking response data or retrying', async () => {
    const server = await startStatusServer({ updateStatus: 400 })
    const service = createService(server)

    const transition = service.moveToInReview('86abc123')

    await expect(transition).rejects.toMatchObject({
      code: 'STATUS_TRANSITION_FAILED',
      operation: 'UPDATE_TASK',
    } satisfies Partial<ClickUpClientError>)
    await expect(transition).rejects.not.toThrow(/provider body|pk_test_secret/)
    expect(server.requests.map(({ method }) => method)).toEqual(['PUT'])
  })

  it('rejects a malformed update response without attempting readback', async () => {
    const server = await startStatusServer({ updateResponse: { id: '86abc123' } })
    const service = createService(server)

    await expect(service.moveToInReview('86abc123')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      operation: 'UPDATE_TASK',
    } satisfies Partial<ClickUpClientError>)
    expect(server.requests.map(({ method }) => method)).toEqual(['PUT'])
  })
})
