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
  type PublishArtifactInput,
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

interface CommentServerOptions {
  readonly comments?: readonly FakeComment[]
  readonly persistCreatedComment?: boolean
  readonly createStatus?: number
  readonly createResponse?: unknown
}

interface CommentServer {
  readonly baseUrl: string
  readonly requests: RecordedRequest[]
  readonly comments: FakeComment[]
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

const startCommentServer = async (options: CommentServerOptions = {}): Promise<CommentServer> => {
  const requests: RecordedRequest[] = []
  const comments = [...(options.comments ?? [])]
  const server = createServer(async (request, response) => {
    const method = request.method ?? ''
    const url = request.url ?? ''
    if (method === 'GET' && url.startsWith('/api/v2/task/86abc123/comment')) {
      requests.push({ method, url, body: undefined })
      sendJson(response, { comments })
      return
    }
    if (method === 'POST' && url === '/api/v2/task/86abc123/comment') {
      const body = await readJsonBody(request)
      requests.push({ method, url, body })
      if (options.createStatus !== undefined && options.createStatus !== 200) {
        sendJson(
          response,
          options.createResponse ?? { err: 'provider body pk_test_secret' },
          options.createStatus,
        )
        return
      }
      const created = {
        id: 'created-comment-1',
        hist_id: 'history-1',
        date: '1723000000000',
      }
      if (options.persistCreatedComment !== false) {
        const parsedBody = body as { comment_text: string }
        comments.unshift({
          id: created.id,
          date: created.date,
          comment: parsedBody.comment_text,
          created_by: { username: 'Workflow Connector' },
        })
      }
      sendJson(response, options.createResponse ?? created)
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

const artifactComment = ({
  runId = 'run-01',
  artifactType = 'EXECUTION_PLAN',
  nodeId = 'plan',
  producer = 'pi-sdk@0.52.0',
  status = 'completed',
  content = '# Plan',
}: {
  readonly runId?: string
  readonly artifactType?: string
  readonly nodeId?: string
  readonly producer?: string
  readonly status?: string
  readonly content?: string
} = {}): string => `[AI-WORKFLOW v1]
run: ${runId}
workflow: delivery-workflow@revision-01
node: ${nodeId}
artifact: ${artifactType}
producer: ${producer}
status: ${status}

---

${content}`

const fakeComment = (id: string, comment: string, date = '1723000000000'): FakeComment => ({
  id,
  date,
  comment,
  created_by: { username: 'Example User' },
})

const createService = (
  server: CommentServer,
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

const executionPlanInput: PublishArtifactInput = {
  taskId: '86abc123',
  runId: 'run-01',
  workflowId: 'delivery-workflow',
  revisionId: 'revision-01',
  nodeId: 'plan',
  artifactType: 'EXECUTION_PLAN',
  producer: 'pi-sdk@0.52.0',
  status: 'completed',
  content: '# Plan',
}

describe('ClickUp artifact service retrieval', () => {
  it('lists exact-run artifacts in canonical type order and ignores unrelated comments', async () => {
    const server = await startCommentServer({
      comments: [
        fakeComment('human-comment', 'Looks good to me.'),
        fakeComment(
          'other-run',
          artifactComment({
            runId: 'run-02',
            artifactType: 'FINALIZATION',
            nodeId: 'finalize-delivery',
            producer: 'finalize-gitlab-delivery',
          }),
        ),
        fakeComment(
          'implementation-comment',
          artifactComment({
            artifactType: 'IMPLEMENTATION_SUMMARY',
            nodeId: 'implement',
            content: '# Implementation\n\nDone.',
          }),
          '1722999999000',
        ),
        fakeComment('invalid-envelope', '[AI-WORKFLOW v1]\nrun: almost an artifact'),
        fakeComment(
          'plan-comment',
          artifactComment({ content: '# Plan\n\nExact plan.' }),
          '1722999998000',
        ),
      ],
    })
    const service = createService(server)

    const artifacts = await service.listArtifacts('86abc123', 'run-01')

    expect(artifacts.map((artifact) => artifact.envelope.artifactType)).toEqual([
      'EXECUTION_PLAN',
      'IMPLEMENTATION_SUMMARY',
    ])
    expect(artifacts[0]).toEqual({
      taskId: '86abc123',
      commentId: 'plan-comment',
      author: 'Example User',
      createdAt: '2024-08-07T03:06:38.000Z',
      envelope: {
        runId: 'run-01',
        workflowId: 'delivery-workflow',
        revisionId: 'revision-01',
        nodeId: 'plan',
        artifactType: 'EXECUTION_PLAN',
        producer: 'pi-sdk@0.52.0',
        status: 'completed',
      },
      content: '# Plan\n\nExact plan.',
    })
    expect(server.requests).toEqual([
      { method: 'GET', url: '/api/v2/task/86abc123/comment', body: undefined },
    ])
  })

  it('retrieves by exact task, run, and artifact type rather than comment ordering', async () => {
    const server = await startCommentServer({
      comments: [
        fakeComment(
          'newer-other-run',
          artifactComment({ runId: 'run-02', content: '# Wrong run' }),
        ),
        fakeComment('exact-comment', artifactComment({ content: '# Exact plan' }), '1722999999000'),
      ],
    })
    const service = createService(server)

    const artifact = await service.getArtifact({
      taskId: '86abc123',
      runId: 'run-01',
      artifactType: 'EXECUTION_PLAN',
    })

    expect(artifact.commentId).toBe('exact-comment')
    expect(artifact.content).toBe('# Exact plan')
  })

  it('fails explicitly when an exact artifact is missing', async () => {
    const server = await startCommentServer()
    const service = createService(server)

    await expect(
      service.getArtifact({
        taskId: '86abc123',
        runId: 'run-01',
        artifactType: 'EXECUTION_PLAN',
      }),
    ).rejects.toMatchObject({
      code: 'ARTIFACT_NOT_FOUND',
      operation: 'GET_ARTIFACT',
      context: {
        taskId: '86abc123',
        runId: 'run-01',
        artifactType: 'EXECUTION_PLAN',
      },
    } satisfies Partial<ClickUpArtifactError>)
  })

  it('fails explicitly with deterministic comment IDs when exact artifacts are duplicated', async () => {
    const server = await startCommentServer({
      comments: [
        fakeComment('comment-b', artifactComment({ content: '# Second' })),
        fakeComment('comment-a', artifactComment({ content: '# First' })),
      ],
    })
    const service = createService(server)

    await expect(
      service.getArtifact({
        taskId: '86abc123',
        runId: 'run-01',
        artifactType: 'EXECUTION_PLAN',
      }),
    ).rejects.toMatchObject({
      code: 'ARTIFACT_AMBIGUOUS',
      operation: 'GET_ARTIFACT',
      context: {
        taskId: '86abc123',
        runId: 'run-01',
        artifactType: 'EXECUTION_PLAN',
        commentIds: ['comment-a', 'comment-b'],
      },
    } satisfies Partial<ClickUpArtifactError>)
  })
})

describe('ClickUp artifact service publication', () => {
  it('redacts sensitive values, publishes once, and returns exact provider readback', async () => {
    const server = await startCommentServer({
      comments: [fakeComment('other-run', artifactComment({ runId: 'run-02' }))],
    })
    const service = createService(server, {
      sensitiveValues: ['configured-secret'],
      maxCommentBytes: 8_192,
    })

    const artifact = await service.publishArtifact({
      ...executionPlanInput,
      content:
        '# Plan\n\nconfigured-secret\nAuthorization: Bearer live-token\napi_key=inline-key\n\nMarkdown stays.',
    })

    expect(server.requests.map(({ method }) => method)).toEqual(['GET', 'POST', 'GET'])
    expect(server.requests[1]).toMatchObject({
      method: 'POST',
      url: '/api/v2/task/86abc123/comment',
      body: { notify_all: false },
    })
    const postedBody = server.requests[1]?.body as { comment_text: string }
    expect(postedBody.comment_text).toContain('# Plan\n\n[REDACTED]')
    expect(postedBody.comment_text).toContain('Authorization: Bearer [REDACTED]')
    expect(postedBody.comment_text).toContain('api_key=[REDACTED]')
    expect(postedBody.comment_text).toContain('\n\nMarkdown stays.')
    expect(postedBody.comment_text).not.toMatch(/configured-secret|live-token|inline-key/)
    expect(artifact).toMatchObject({
      taskId: '86abc123',
      commentId: 'created-comment-1',
      author: 'Workflow Connector',
      createdAt: '2024-08-07T03:06:40.000Z',
      content:
        '# Plan\n\n[REDACTED]\nAuthorization: Bearer [REDACTED]\napi_key=[REDACTED]\n\nMarkdown stays.',
    })
    expect(artifact.envelope).toMatchObject({
      runId: 'run-01',
      artifactType: 'EXECUTION_PLAN',
      producer: 'pi-sdk@0.52.0',
      status: 'completed',
    })
  })

  it('rejects an existing task/run/type before issuing a mutation', async () => {
    const server = await startCommentServer({
      comments: [fakeComment('existing-comment', artifactComment())],
    })
    const service = createService(server)

    await expect(service.publishArtifact(executionPlanInput)).rejects.toMatchObject({
      code: 'COMMENT_REJECTED',
      operation: 'PUBLISH_ARTIFACT',
    } satisfies Partial<ClickUpArtifactError>)
    expect(server.requests.map(({ method }) => method)).toEqual(['GET'])
  })

  it.each([
    ['oversize content', { content: 'x'.repeat(2_000) }, { maxCommentBytes: 512 }],
    ['hidden reasoning', { content: '# Plan\n\n<thinking>private reasoning</thinking>' }, {}],
    ['unapproved producer', { producer: 'other-agent@1.0.0' }, {}],
    ['missing content', { content: undefined }, {}],
  ] as const)('rejects %s without contacting ClickUp', async (_description, overrides, options) => {
    const server = await startCommentServer()
    const service = createService(server, options)

    await expect(
      service.publishArtifact({ ...executionPlanInput, ...overrides }),
    ).rejects.toBeInstanceOf(ClickUpArtifactError)
    expect(server.requests).toEqual([])
  })

  it('reports uncertain readback without retrying the mutation', async () => {
    const server = await startCommentServer({ persistCreatedComment: false })
    const service = createService(server)

    await expect(service.publishArtifact(executionPlanInput)).rejects.toMatchObject({
      code: 'COMMENT_REJECTED',
      operation: 'PUBLISH_ARTIFACT',
    } satisfies Partial<ClickUpArtifactError>)
    expect(server.requests.map(({ method }) => method)).toEqual(['GET', 'POST', 'GET'])
  })

  it('rejects a malformed create-comment response without retrying', async () => {
    const server = await startCommentServer({ createResponse: { hist_id: 'missing-id-and-date' } })
    const service = createService(server)

    await expect(service.publishArtifact(executionPlanInput)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      operation: 'CREATE_COMMENT',
    } satisfies Partial<ClickUpClientError>)
    expect(server.requests.map(({ method }) => method)).toEqual(['GET', 'POST'])
  })

  it('maps provider rejection without leaking its response or credentials', async () => {
    const server = await startCommentServer({ createStatus: 400 })
    const service = createService(server)

    const publication = service.publishArtifact(executionPlanInput)

    await expect(publication).rejects.toMatchObject({
      code: 'COMMENT_REJECTED',
      operation: 'CREATE_COMMENT',
    } satisfies Partial<ClickUpClientError>)
    await expect(publication).rejects.not.toThrow(/provider body|pk_test_secret/)
    expect(server.requests.map(({ method }) => method)).toEqual(['GET', 'POST'])
  })
})
