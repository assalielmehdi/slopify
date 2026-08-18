import { ClickUpClientError, type ClickUpClientOperation } from './errors.js'
import { ClickUpTaskResponseSchema, type ClickUpTaskResponse } from './schemas.js'
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
  if (status === 404) return new ClickUpClientError('TASK_NOT_FOUND', operation)
  if (status === 429) return new ClickUpClientError('RATE_LIMITED', operation)
  return new ClickUpClientError('PROVIDER_UNAVAILABLE', operation)
}

const requestJson = async (
  configuration: ClientConfiguration,
  url: URL,
  operation: ClickUpClientOperation,
): Promise<unknown> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), configuration.timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: configuration.token,
      },
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
    throw invalidResponse('GET_TASK')
  }
  return identity.taskId
}

const mapTask = (value: unknown, reference: ClickUpTaskReference): ClickUpTaskSnapshot => {
  const parsed = ClickUpTaskResponseSchema.safeParse(value)
  if (!parsed.success) throw invalidResponse('GET_TASK')
  const task = parsed.data
  let taskId: ClickUpTaskId
  try {
    taskId = responseIdentity(task, reference)
  } catch (cause) {
    if (cause instanceof ClickUpClientError) throw cause
    throw invalidResponse('GET_TASK')
  }
  const statusName = task.status.status ?? task.status.status_name
  const priorityName = task.priority?.priority ?? task.priority?.name
  if (statusName === undefined || (task.priority !== null && priorityName === undefined)) {
    throw invalidResponse('GET_TASK')
  }

  return {
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
    priority:
      task.priority === null ? null : { id: task.priority.id, name: priorityName as string },
    comments: [],
    resourceLinks: [],
  }
}

export const createClickUpClient = (options: CreateClickUpClientOptions): ClickUpTaskClient => {
  const configuration = parseConfiguration(options)

  return {
    async getTask(referenceInput) {
      const reference = normalizeClickUpTaskReference(referenceInput)
      const url = new URL(`task/${encodeURIComponent(reference.taskId)}`, configuration.baseUrl)
      url.searchParams.set('include_markdown_description', 'true')
      if (reference.kind === 'custom') {
        url.searchParams.set('custom_task_ids', 'true')
        url.searchParams.set('team_id', configuration.workspaceId)
      }
      return mapTask(await requestJson(configuration, url, 'GET_TASK'), reference)
    },
  }
}
