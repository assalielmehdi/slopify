import { ClickUpClientError, type ClickUpClientOperation } from './errors.js'
import {
  ClickUpCommentsResponseSchema,
  ClickUpCreateCommentResponseSchema,
  ClickUpTaskResponseSchema,
  ClickUpUpdateCommentResponseSchema,
  type ClickUpCommentResponse,
  type ClickUpTaskResponse,
} from './schemas.js'
import {
  normalizeClickUpTaskReference,
  type ClickUpTaskId,
  type ClickUpTaskReference,
} from './task-reference.js'

export interface ClickUpTaskStatus {
  readonly id: string | null
  readonly name: string
  readonly type: string | null
}

export interface ClickUpTaskPriority {
  readonly id: string
  readonly name: string
}

export interface ClickUpTaskComment {
  readonly commentId: string
  readonly text: string
  readonly author: string
  readonly createdAt: string
}

export interface ClickUpResourceLink {
  readonly url: string
  readonly source: 'attachment' | 'comment' | 'description'
}

export interface ClickUpTaskSnapshot {
  readonly taskId: ClickUpTaskId
  readonly customTaskId: string | null
  readonly url: string
  readonly title: string
  readonly description: string
  readonly status: ClickUpTaskStatus
  readonly priority: ClickUpTaskPriority | null
  readonly comments: readonly ClickUpTaskComment[]
  readonly resourceLinks: readonly ClickUpResourceLink[]
}

export interface ClickUpTaskClient {
  getTask(reference: string): Promise<ClickUpTaskSnapshot>
  listComments(taskId: ClickUpTaskId): Promise<readonly ClickUpTaskComment[]>
  createComment(input: CreateClickUpCommentInput): Promise<CreatedClickUpComment>
  updateComment(input: UpdateClickUpCommentInput): Promise<void>
  updateTaskStatus(input: UpdateClickUpTaskStatusInput): Promise<void>
}

export interface CreateClickUpCommentInput {
  readonly taskId: ClickUpTaskId
  readonly content: string
}

export interface CreatedClickUpComment {
  readonly commentId: string
  readonly createdAt: string
}

export interface UpdateClickUpCommentInput {
  readonly commentId: string
  readonly content: string
}

export interface UpdateClickUpTaskStatusInput {
  readonly taskId: ClickUpTaskId
  readonly statusId: string
}

export interface CreateClickUpClientOptions {
  readonly token: string
  readonly workspaceId: string
  readonly baseUrl?: string
  readonly timeoutMs?: number
  readonly maxResponseBytes?: number
  readonly maxCommentPages?: number
}

interface ClientConfiguration {
  readonly token: string
  readonly workspaceId: string
  readonly baseUrl: URL
  readonly timeoutMs: number
  readonly maxResponseBytes: number
  readonly maxCommentPages: number
}

interface MappedTask {
  readonly snapshot: Omit<ClickUpTaskSnapshot, 'comments' | 'resourceLinks'>
  readonly attachmentUrls: readonly string[]
}

interface CommentPageCursor {
  readonly id: string
  readonly date: string
}

const COMMENT_PAGE_SIZE = 25

const configurationError = (): ClickUpClientError =>
  new ClickUpClientError('CLIENT_CONFIGURATION_INVALID', 'CONFIGURE')

const positiveInteger = (value: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw configurationError()
  return value
}

const parseConfiguration = (options: CreateClickUpClientOptions): ClientConfiguration => {
  const token = options.token.trim()
  const workspaceId = options.workspaceId.trim()
  if (token === '' || token.length > 4_096 || workspaceId === '' || workspaceId.length > 256) {
    throw configurationError()
  }

  let baseUrl: URL
  try {
    baseUrl = new URL(options.baseUrl ?? 'https://api.clickup.com/api/v2/')
  } catch {
    throw configurationError()
  }
  const isLoopback = baseUrl.hostname === '127.0.0.1' || baseUrl.hostname === 'localhost'
  if (
    (baseUrl.protocol !== 'https:' && !(baseUrl.protocol === 'http:' && isLoopback)) ||
    baseUrl.username !== '' ||
    baseUrl.password !== '' ||
    baseUrl.search !== '' ||
    baseUrl.hash !== ''
  ) {
    throw configurationError()
  }
  if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/'

  return {
    token,
    workspaceId,
    baseUrl,
    timeoutMs: positiveInteger(options.timeoutMs ?? 10_000, 120_000),
    maxResponseBytes: positiveInteger(options.maxResponseBytes ?? 2_097_152, 16_777_216),
    maxCommentPages: positiveInteger(options.maxCommentPages ?? 40, 200),
  }
}

const invalidResponse = (operation: ClickUpClientOperation): ClickUpClientError =>
  new ClickUpClientError('INVALID_RESPONSE', operation)

const readBoundedJson = async (
  response: Response,
  maximumBytes: number,
  operation: ClickUpClientOperation,
): Promise<unknown> => {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body?.cancel()
    throw invalidResponse(operation)
  }
  if (response.body === null) throw invalidResponse(operation)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let body = ''
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    bytes += chunk.value.byteLength
    if (bytes > maximumBytes) {
      await reader.cancel()
      throw invalidResponse(operation)
    }
    body += decoder.decode(chunk.value, { stream: true })
  }
  body += decoder.decode()

  try {
    return JSON.parse(body) as unknown
  } catch {
    throw invalidResponse(operation)
  }
}

const httpError = (status: number, operation: ClickUpClientOperation): ClickUpClientError => {
  if (status === 401 || status === 403) return new ClickUpClientError('UNAUTHORIZED', operation)
  if (status === 429) return new ClickUpClientError('RATE_LIMITED', operation)
  if (operation === 'UPDATE_COMMENT' && status >= 400 && status < 500) {
    return new ClickUpClientError('COMMENT_REJECTED', operation)
  }
  if (operation === 'UPDATE_TASK' && status >= 400 && status < 500) {
    return new ClickUpClientError('STATUS_TRANSITION_FAILED', operation)
  }
  if (status === 404) return new ClickUpClientError('TASK_NOT_FOUND', operation)
  if (operation === 'CREATE_COMMENT' && status >= 400 && status < 500) {
    return new ClickUpClientError('COMMENT_REJECTED', operation)
  }
  return new ClickUpClientError('PROVIDER_UNAVAILABLE', operation)
}

interface JsonRequestOptions {
  readonly method: 'GET' | 'POST' | 'PUT'
  readonly body?: string
}

const requestJson = async (
  configuration: ClientConfiguration,
  url: URL,
  operation: ClickUpClientOperation,
  options: JsonRequestOptions = { method: 'GET' },
): Promise<unknown> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), configuration.timeoutMs)
  try {
    const response = await fetch(url, {
      method: options.method,
      headers: {
        accept: 'application/json',
        authorization: configuration.token,
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: options.body }),
      redirect: 'error',
      signal: controller.signal,
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw httpError(response.status, operation)
    }
    return await readBoundedJson(response, configuration.maxResponseBytes, operation)
  } catch (cause) {
    if (cause instanceof ClickUpClientError) throw cause
    if (controller.signal.aborted) throw new ClickUpClientError('REQUEST_TIMEOUT', operation)
    throw new ClickUpClientError('PROVIDER_UNAVAILABLE', operation)
  } finally {
    clearTimeout(timeout)
  }
}

const responseIdentity = (
  task: ClickUpTaskResponse,
  reference: ClickUpTaskReference,
  operation: 'GET_TASK' | 'UPDATE_TASK',
): ClickUpTaskId => {
  const identity = normalizeClickUpTaskReference(task.id)
  const responseUrl = normalizeClickUpTaskReference(task.url)
  const requestedIdentityMatches =
    reference.kind === 'native'
      ? reference.taskId === identity.taskId
      : reference.taskId === task.custom_id
  if (
    identity.kind !== 'native' ||
    responseUrl.taskId !== identity.taskId ||
    !requestedIdentityMatches
  ) {
    throw invalidResponse(operation)
  }
  return identity.taskId
}

const mapTask = (
  value: unknown,
  reference: ClickUpTaskReference,
  operation: 'GET_TASK' | 'UPDATE_TASK' = 'GET_TASK',
): MappedTask => {
  const parsed = ClickUpTaskResponseSchema.safeParse(value)
  if (!parsed.success) throw invalidResponse(operation)
  const task = parsed.data
  let taskId: ClickUpTaskId
  try {
    taskId = responseIdentity(task, reference, operation)
  } catch (cause) {
    if (cause instanceof ClickUpClientError) throw cause
    throw invalidResponse(operation)
  }
  const statusName = task.status.status ?? task.status.status_name
  const priorityName = task.priority?.priority ?? task.priority?.name
  if (statusName === undefined || (task.priority !== null && priorityName === undefined)) {
    throw invalidResponse(operation)
  }
  const priority =
    task.priority === null || priorityName === undefined
      ? null
      : { id: task.priority.id, name: priorityName }

  return {
    snapshot: {
      taskId,
      customTaskId: task.custom_id ?? null,
      url: task.url,
      title: task.name,
      description: task.description ?? task.text_content ?? '',
      status: {
        id: task.status.id ?? null,
        name: statusName,
        type: task.status.type ?? task.status.status_type ?? null,
      },
      priority,
    },
    attachmentUrls: (task.attachments ?? []).flatMap((attachment) =>
      attachment.url === undefined ? [] : [attachment.url],
    ),
  }
}

const applyCustomTaskParameters = (
  url: URL,
  reference: ClickUpTaskReference,
  workspaceId: string,
): void => {
  if (reference.kind !== 'custom') return
  url.searchParams.set('custom_task_ids', 'true')
  url.searchParams.set('team_id', workspaceId)
}

const commentText = (comment: ClickUpCommentResponse): string => {
  if (typeof comment.comment === 'string') return comment.comment
  if (Array.isArray(comment.comment)) return comment.comment.map((segment) => segment.text).join('')
  if (comment.comment_text !== undefined) return comment.comment_text
  throw invalidResponse('LIST_COMMENTS')
}

const mapComment = (comment: ClickUpCommentResponse): ClickUpTaskComment => {
  const author = comment.created_by ?? comment.user
  const authorName = author?.username ?? author?.name
  const createdAt = new Date(Number(comment.date))
  if (authorName === undefined || Number.isNaN(createdAt.valueOf()))
    throw invalidResponse('LIST_COMMENTS')
  return {
    commentId: comment.id,
    text: commentText(comment),
    author: authorName,
    createdAt: createdAt.toISOString(),
  }
}

const listComments = async (
  configuration: ClientConfiguration,
  reference: ClickUpTaskReference,
): Promise<readonly ClickUpTaskComment[]> => {
  const comments: ClickUpTaskComment[] = []
  let cursor: CommentPageCursor | undefined

  for (let page = 0; page < configuration.maxCommentPages; page += 1) {
    const url = new URL(
      `task/${encodeURIComponent(reference.taskId)}/comment`,
      configuration.baseUrl,
    )
    applyCustomTaskParameters(url, reference, configuration.workspaceId)
    if (cursor !== undefined) {
      url.searchParams.set('start', cursor.date)
      url.searchParams.set('start_id', cursor.id)
    }

    const parsed = ClickUpCommentsResponseSchema.safeParse(
      await requestJson(configuration, url, 'LIST_COMMENTS'),
    )
    if (!parsed.success) throw invalidResponse('LIST_COMMENTS')
    comments.push(...parsed.data.comments.map(mapComment))
    if (parsed.data.comments.length < COMMENT_PAGE_SIZE) return comments

    const lastComment = parsed.data.comments.at(-1)
    if (lastComment === undefined) throw invalidResponse('LIST_COMMENTS')
    const nextCursor = { id: lastComment.id, date: lastComment.date }
    if (cursor?.id === nextCursor.id && cursor.date === nextCursor.date) {
      throw invalidResponse('LIST_COMMENTS')
    }
    if (page + 1 === configuration.maxCommentPages) {
      throw new ClickUpClientError('PAGINATION_LIMIT_REACHED', 'LIST_COMMENTS')
    }
    cursor = nextCursor
  }

  throw new ClickUpClientError('PAGINATION_LIMIT_REACHED', 'LIST_COMMENTS')
}

const trailingUrlPunctuation = /[),.;:!?\]}]+$/u
const resourceUrl = /https?:\/\/[^\s<>"'`]+/giu

const collectResourceLinks = (
  description: string,
  comments: readonly ClickUpTaskComment[],
  attachmentUrls: readonly string[],
): readonly ClickUpResourceLink[] => {
  const resources: ClickUpResourceLink[] = []
  const seen = new Set<string>()
  const add = (candidate: string, source: ClickUpResourceLink['source']): void => {
    const trimmed = candidate.replace(trailingUrlPunctuation, '')
    if (trimmed.length > 4_096 || seen.has(trimmed)) return
    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      return
    }
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username !== '' ||
      parsed.password !== ''
    ) {
      return
    }
    seen.add(trimmed)
    resources.push({ url: trimmed, source })
  }
  const addFromText = (text: string, source: ClickUpResourceLink['source']): void => {
    for (const candidate of text.match(resourceUrl) ?? []) add(candidate, source)
  }

  addFromText(description, 'description')
  for (const comment of comments) addFromText(comment.text, 'comment')
  for (const attachmentUrl of attachmentUrls) add(attachmentUrl, 'attachment')
  return resources
}

export const createClickUpClient = (options: CreateClickUpClientOptions): ClickUpTaskClient => {
  const configuration = parseConfiguration(options)

  return {
    async getTask(referenceInput) {
      const reference = normalizeClickUpTaskReference(referenceInput)
      const url = new URL(`task/${encodeURIComponent(reference.taskId)}`, configuration.baseUrl)
      url.searchParams.set('include_markdown_description', 'true')
      applyCustomTaskParameters(url, reference, configuration.workspaceId)
      const task = mapTask(await requestJson(configuration, url, 'GET_TASK'), reference)
      const comments = await listComments(configuration, reference)
      return {
        ...task.snapshot,
        comments,
        resourceLinks: collectResourceLinks(
          task.snapshot.description,
          comments,
          task.attachmentUrls,
        ),
      }
    },

    async listComments(taskId) {
      return listComments(configuration, normalizeClickUpTaskReference(taskId))
    },

    async createComment(input) {
      if (input.content.trim() === '' || input.content.length > 1_000_000) {
        throw new ClickUpClientError('COMMENT_REJECTED', 'CREATE_COMMENT')
      }
      const reference = normalizeClickUpTaskReference(input.taskId)
      const url = new URL(
        `task/${encodeURIComponent(reference.taskId)}/comment`,
        configuration.baseUrl,
      )
      applyCustomTaskParameters(url, reference, configuration.workspaceId)
      const parsed = ClickUpCreateCommentResponseSchema.safeParse(
        await requestJson(configuration, url, 'CREATE_COMMENT', {
          method: 'POST',
          body: JSON.stringify({ comment_text: input.content, notify_all: false }),
        }),
      )
      if (!parsed.success) throw invalidResponse('CREATE_COMMENT')
      const createdAt = new Date(Number(parsed.data.date))
      if (Number.isNaN(createdAt.valueOf())) throw invalidResponse('CREATE_COMMENT')
      return { commentId: parsed.data.id, createdAt: createdAt.toISOString() }
    },

    async updateComment(input) {
      if (
        input.commentId.trim() !== input.commentId ||
        input.commentId === '' ||
        input.commentId.length > 128 ||
        input.content.trim() === '' ||
        input.content.length > 1_000_000
      ) {
        throw new ClickUpClientError('COMMENT_REJECTED', 'UPDATE_COMMENT')
      }
      const url = new URL(
        `comment/${encodeURIComponent(input.commentId)}`,
        configuration.baseUrl,
      )
      const parsed = ClickUpUpdateCommentResponseSchema.safeParse(
        await requestJson(configuration, url, 'UPDATE_COMMENT', {
          method: 'PUT',
          body: JSON.stringify({ comment_text: input.content }),
        }),
      )
      if (!parsed.success) throw invalidResponse('UPDATE_COMMENT')
    },

    async updateTaskStatus(input) {
      if (
        input.statusId.trim() !== input.statusId ||
        input.statusId === '' ||
        input.statusId.length > 256
      ) {
        throw new ClickUpClientError('STATUS_TRANSITION_FAILED', 'UPDATE_TASK')
      }
      const reference = normalizeClickUpTaskReference(input.taskId)
      if (reference.kind !== 'native') {
        throw new ClickUpClientError('STATUS_TRANSITION_FAILED', 'UPDATE_TASK')
      }
      const url = new URL(`task/${encodeURIComponent(reference.taskId)}`, configuration.baseUrl)
      mapTask(
        await requestJson(configuration, url, 'UPDATE_TASK', {
          method: 'PUT',
          body: JSON.stringify({ status: input.statusId }),
        }),
        reference,
        'UPDATE_TASK',
      )
    },
  }
}
