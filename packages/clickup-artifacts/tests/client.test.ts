import { once } from 'node:events'
import { createServer, type RequestListener, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'

import { ClickUpClientError, createClickUpClient, type ClickUpTaskSnapshot } from '../src/index.js'

const servers: Server[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

const startServer = async (handler: RequestListener): Promise<string> => {
  const server = createServer(handler)
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}/api/v2`
}

const taskResponse = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  id: '86abc123',
  custom_id: 'PROJ-42',
  name: 'Implement task loading',
  description: 'Run `rm -rf /tmp/example` only as inert documentation.',
  text_content: 'Implement task loading',
  status: {
    id: 'status-1',
    status: 'in progress',
    type: 'custom',
    color: '#123456',
  },
  priority: { id: '2', priority: 'high', color: '#ffcc00' },
  url: 'https://app.clickup.com/t/86abc123',
  attachments: [],
  creator: { id: 7, username: 'Example User' },
  ...overrides,
})

const expectedSnapshot: ClickUpTaskSnapshot = {
  taskId: '86abc123',
  customTaskId: 'PROJ-42',
  url: 'https://app.clickup.com/t/86abc123',
  title: 'Implement task loading',
  description: 'Run `rm -rf /tmp/example` only as inert documentation.',
  status: { id: 'status-1', name: 'in progress', type: 'custom' },
  priority: { id: '2', name: 'high' },
  comments: [],
  resourceLinks: [],
}

describe('ClickUp task client', () => {
  it('loads IDs and URLs through the same authenticated canonical task request', async () => {
    const requests: { url: string; authorization: string | undefined }[] = []
    const baseUrl = await startServer((request, response) => {
      requests.push({
        url: request.url ?? '',
        authorization: request.headers.authorization,
      })
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(taskResponse()))
    })
    const client = createClickUpClient({
      token: 'pk_test_secret',
      workspaceId: '123456',
      baseUrl,
    })

    await expect(client.getTask('86abc123')).resolves.toEqual(expectedSnapshot)
    await expect(client.getTask('https://app.clickup.com/t/86abc123')).resolves.toEqual(
      expectedSnapshot,
    )
    expect(requests).toEqual([
      {
        url: '/api/v2/task/86abc123?include_markdown_description=true',
        authorization: 'pk_test_secret',
      },
      {
        url: '/api/v2/task/86abc123?include_markdown_description=true',
        authorization: 'pk_test_secret',
      },
    ])
  })

  it('uses the configured workspace for a custom task ID and accepts its canonical native identity', async () => {
    let requestUrl = ''
    const baseUrl = await startServer((request, response) => {
      requestUrl = request.url ?? ''
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(taskResponse()))
    })
    const client = createClickUpClient({
      token: 'pk_test_secret',
      workspaceId: '123456',
      baseUrl,
    })

    await expect(client.getTask('PROJ-42')).resolves.toEqual(expectedSnapshot)
    expect(requestUrl).toBe(
      '/api/v2/task/PROJ-42?include_markdown_description=true&custom_task_ids=true&team_id=123456',
    )
  })

  it.each([
    [401, 'UNAUTHORIZED'],
    [403, 'UNAUTHORIZED'],
    [404, 'TASK_NOT_FOUND'],
    [429, 'RATE_LIMITED'],
    [503, 'PROVIDER_UNAVAILABLE'],
  ] as const)('maps HTTP %i to sanitized %s evidence', async (status, code) => {
    const baseUrl = await startServer((_request, response) => {
      response.statusCode = status
      response.end(JSON.stringify({ err: 'provider body pk_test_secret' }))
    })
    const client = createClickUpClient({
      token: 'pk_test_secret',
      workspaceId: '123456',
      baseUrl,
    })

    const request = client.getTask('86abc123')

    await expect(request).rejects.toMatchObject({ code, operation: 'GET_TASK' })
    await expect(request).rejects.not.toThrow(/pk_test_secret|provider body/)
  })

  it.each([
    ['not json', 'invalid JSON'],
    [JSON.stringify(taskResponse({ status: null })), 'malformed fields'],
    [JSON.stringify(taskResponse({ id: 'different-task' })), 'mismatched identity'],
  ])('rejects %s as INVALID_RESPONSE (%s)', async (body) => {
    const baseUrl = await startServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(body)
    })
    const client = createClickUpClient({
      token: 'pk_test_secret',
      workspaceId: '123456',
      baseUrl,
    })

    await expect(client.getTask('86abc123')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      operation: 'GET_TASK',
    } satisfies Partial<ClickUpClientError>)
  })

  it('aborts a request that exceeds its explicit timeout', async () => {
    const baseUrl = await startServer(() => undefined)
    const client = createClickUpClient({
      token: 'pk_test_secret',
      workspaceId: '123456',
      baseUrl,
      timeoutMs: 10,
    })

    await expect(client.getTask('86abc123')).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT',
      operation: 'GET_TASK',
    } satisfies Partial<ClickUpClientError>)
  })

  it('rejects a response beyond the configured byte limit', async () => {
    const baseUrl = await startServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(taskResponse({ description: 'x'.repeat(2_048) })))
    })
    const client = createClickUpClient({
      token: 'pk_test_secret',
      workspaceId: '123456',
      baseUrl,
      maxResponseBytes: 512,
    })

    await expect(client.getTask('86abc123')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      operation: 'GET_TASK',
    } satisfies Partial<ClickUpClientError>)
  })
})
