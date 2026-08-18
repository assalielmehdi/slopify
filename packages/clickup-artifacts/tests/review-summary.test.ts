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
} from '../src/index.js'

interface FakeComment {
  readonly id: string
  readonly date: string
  readonly comment: string
  readonly created_by: { readonly username: string }
}

interface RecordedRequest {
  readonly method: string
  readonly url: string
  readonly body: unknown
}

interface ReviewServerOptions {
  readonly comments?: readonly FakeComment[]
  readonly persistUpdate?: boolean
  readonly updateStatus?: number
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

const reviewComment = ({
  runId = 'run-01',
  status = 'changes-requested',
  content = '# Review pass 1\n\nFinding A remains open.',
}: {
  readonly runId?: string
  readonly status?: string
  readonly content?: string
} = {}): string => `[AI-WORKFLOW v1]
run: ${runId}
workflow: delivery-workflow@revision-01
node: aggregate-review-findings
artifact: REVIEW_SUMMARY
producer: aggregate-review-findings
status: ${status}

---

${content}`

const fakeComment = (id: string, comment: string): FakeComment => ({
  id,
  date: '1723000000000',
  comment,
  created_by: { username: 'Workflow Connector' },
})

const startReviewServer = async (options: ReviewServerOptions = {}) => {
  const requests: RecordedRequest[] = []
  const comments = [...(options.comments ?? [])]
  const server = createServer(async (request, response) => {
    const method = request.method ?? ''
    const url = request.url ?? ''
    if (method === 'GET' && url === '/api/v2/task/86abc123/comment') {
      requests.push({ method, url, body: undefined })
      sendJson(response, { comments })
      return
    }
    if (method === 'POST' && url === '/api/v2/task/86abc123/comment') {
      const body = (await readJsonBody(request)) as { comment_text: string }
      requests.push({ method, url, body })
      comments.unshift(fakeComment('review-comment-1', body.comment_text))
      sendJson(response, { id: 'review-comment-1', date: '1723000000000' })
      return
    }
    if (method === 'PUT' && url === '/api/v2/comment/review-comment-1') {
      const body = (await readJsonBody(request)) as { comment_text: string }
      requests.push({ method, url, body })
      if (options.updateStatus !== undefined && options.updateStatus !== 200) {
        sendJson(response, { err: 'provider body pk_test_secret' }, options.updateStatus)
        return
      }
      if (options.persistUpdate !== false) {
        const index = comments.findIndex(({ id }) => id === 'review-comment-1')
        if (index >= 0) comments[index] = fakeComment('review-comment-1', body.comment_text)
      }
      sendJson(response, {})
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
    comments,
  }
}

const producerPolicy: ArtifactProducerPolicy = {
  agentProducer: 'pi-sdk@0.52.0',
  commandProducers: ['aggregate-review-findings', 'finalize-gitlab-delivery'],
}

const createService = (
  server: Awaited<ReturnType<typeof startReviewServer>>,
  options: { readonly maxCommentBytes?: number; readonly sensitiveValues?: readonly string[] } = {},
) =>
  createClickUpArtifactService({
    client: createClickUpClient({
      token: 'pk_test_secret',
      workspaceId: '123456',
      baseUrl: server.baseUrl,
    }),
    producerPolicy,
    ...options,
  })

const firstReview = {
  taskId: '86abc123' as const,
  runId: 'run-01' as const,
  workflowId: 'delivery-workflow' as const,
  revisionId: 'revision-01' as const,
  nodeId: 'aggregate-review-findings' as const,
  artifactType: 'REVIEW_SUMMARY' as const,
  producer: 'aggregate-review-findings',
  status: 'changes-requested' as const,
  content: '# Review pass 1\n\nFinding A remains open.',
}

describe('ClickUp review-summary lifecycle', () => {
  it('publishes once, then updates the exact comment while preserving identity and history', async () => {
    const server = await startReviewServer()
    const service = createService(server)

    const published = await service.publishArtifact(firstReview)
    const resolved = await service.updateReviewSummary({
      taskId: '86abc123',
      runId: 'run-01',
      commentId: published.commentId,
      status: 'resolved',
      appendContent: '# Review pass 2\n\nFinding A resolved by commit abc123.',
    })
    const reopened = await service.updateReviewSummary({
      taskId: '86abc123',
      runId: 'run-01',
      commentId: published.commentId,
      status: 'changes-requested',
      appendContent: '# Review pass 3\n\nFinding B is new.',
    })

    expect(server.requests.map(({ method }) => method)).toEqual([
      'GET',
      'POST',
      'GET',
      'GET',
      'PUT',
      'GET',
      'GET',
      'PUT',
      'GET',
    ])
    expect(server.requests.filter(({ method }) => method === 'POST')).toHaveLength(1)
    expect(server.requests.filter(({ method }) => method === 'PUT')).toHaveLength(2)
    expect(server.requests[4]).toMatchObject({
      url: '/api/v2/comment/review-comment-1',
      body: { comment_text: expect.stringContaining('Finding A remains open.') },
    })
    expect(resolved).toMatchObject({
      taskId: '86abc123',
      commentId: published.commentId,
      envelope: {
        runId: 'run-01',
        workflowId: 'delivery-workflow',
        revisionId: 'revision-01',
        nodeId: 'aggregate-review-findings',
        artifactType: 'REVIEW_SUMMARY',
        producer: 'aggregate-review-findings',
        status: 'resolved',
      },
    })
    expect(reopened.content).toBe(
      '# Review pass 1\n\nFinding A remains open.\n\n---\n\n# Review pass 2\n\nFinding A resolved by commit abc123.\n\n---\n\n# Review pass 3\n\nFinding B is new.',
    )
    expect(reopened.envelope.status).toBe('changes-requested')
    expect(server.comments).toHaveLength(1)
  })

  it.each([
    ['another comment', { commentId: 'wrong-comment' }],
    ['another run', { runId: 'run-02' }],
  ] as const)('rejects %s without issuing a remote mutation', async (_description, override) => {
    const server = await startReviewServer({
      comments: [fakeComment('review-comment-1', reviewComment())],
    })
    const service = createService(server)

    await expect(
      service.updateReviewSummary({
        taskId: '86abc123',
        runId: 'run-01',
        commentId: 'review-comment-1',
        status: 'resolved',
        appendContent: '# Review pass 2\n\nResolved.',
        ...override,
      }),
    ).rejects.toMatchObject({
      code: 'COMMENT_REJECTED',
      operation: 'UPDATE_REVIEW_SUMMARY',
    } satisfies Partial<ClickUpArtifactError>)
    expect(server.requests.map(({ method }) => method)).toEqual(['GET'])
  })

  it('rejects updates to a completed review without issuing a remote mutation', async () => {
    const server = await startReviewServer({
      comments: [
        fakeComment('review-comment-1', reviewComment({ status: 'completed', content: '# Clean' })),
      ],
    })
    const service = createService(server)

    await expect(
      service.updateReviewSummary({
        taskId: '86abc123',
        runId: 'run-01',
        commentId: 'review-comment-1',
        status: 'resolved',
        appendContent: '# Unexpected update',
      }),
    ).rejects.toMatchObject({
      code: 'COMMENT_REJECTED',
      operation: 'UPDATE_REVIEW_SUMMARY',
    } satisfies Partial<ClickUpArtifactError>)
    expect(server.requests.map(({ method }) => method)).toEqual(['GET'])
  })

  it('rejects hidden reasoning before contacting ClickUp', async () => {
    const server = await startReviewServer({
      comments: [fakeComment('review-comment-1', reviewComment())],
    })
    const service = createService(server)

    await expect(
      service.updateReviewSummary({
        taskId: '86abc123',
        runId: 'run-01',
        commentId: 'review-comment-1',
        status: 'resolved',
        appendContent: '<thinking>private reasoning</thinking>',
      }),
    ).rejects.toMatchObject({
      code: 'COMMENT_REJECTED',
      operation: 'UPDATE_REVIEW_SUMMARY',
    } satisfies Partial<ClickUpArtifactError>)
    expect(server.requests).toEqual([])
  })

  it('reports uncertain readback without retrying the update', async () => {
    const server = await startReviewServer({
      comments: [fakeComment('review-comment-1', reviewComment())],
      persistUpdate: false,
    })
    const service = createService(server)

    await expect(
      service.updateReviewSummary({
        taskId: '86abc123',
        runId: 'run-01',
        commentId: 'review-comment-1',
        status: 'resolved',
        appendContent: '# Review pass 2\n\nResolved.',
      }),
    ).rejects.toMatchObject({
      code: 'COMMENT_REJECTED',
      operation: 'UPDATE_REVIEW_SUMMARY',
    } satisfies Partial<ClickUpArtifactError>)
    expect(server.requests.map(({ method }) => method)).toEqual(['GET', 'PUT', 'GET'])
  })

  it('maps provider rejection without leaking response data or retrying', async () => {
    const server = await startReviewServer({
      comments: [fakeComment('review-comment-1', reviewComment())],
      updateStatus: 400,
    })
    const service = createService(server)

    const update = service.updateReviewSummary({
      taskId: '86abc123',
      runId: 'run-01',
      commentId: 'review-comment-1',
      status: 'resolved',
      appendContent: '# Review pass 2\n\nResolved.',
    })

    await expect(update).rejects.toMatchObject({
      code: 'COMMENT_REJECTED',
      operation: 'UPDATE_COMMENT',
    } satisfies Partial<ClickUpClientError>)
    await expect(update).rejects.not.toThrow(/provider body|pk_test_secret/)
    expect(server.requests.map(({ method }) => method)).toEqual(['GET', 'PUT'])
  })
})
