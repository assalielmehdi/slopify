declare const clickUpTaskIdBrand: unique symbol

export type ClickUpTaskId = string & { readonly [clickUpTaskIdBrand]: true }
export type ClickUpTaskReferenceErrorCode = 'TASK_REFERENCE_INVALID'

export interface ClickUpTaskReference {
  readonly taskId: ClickUpTaskId
  readonly kind: 'custom' | 'native'
  readonly canonicalUrl: string
}

export class ClickUpTaskReferenceError extends Error {
  override readonly name = 'ClickUpTaskReferenceError'

  constructor(readonly code: ClickUpTaskReferenceErrorCode) {
    super('ClickUp task reference is invalid')
  }
}

const NATIVE_TASK_ID = /^[a-z0-9]{1,128}$/i
const CUSTOM_TASK_ID = /^[a-z][a-z0-9_]{0,63}-[1-9][0-9]{0,62}$/i

const parseTaskId = (value: string): ClickUpTaskReference => {
  const kind = NATIVE_TASK_ID.test(value)
    ? 'native'
    : CUSTOM_TASK_ID.test(value)
      ? 'custom'
      : undefined
  if (kind === undefined || value.length > 128) {
    throw new ClickUpTaskReferenceError('TASK_REFERENCE_INVALID')
  }

  const taskId = value as ClickUpTaskId
  return {
    taskId,
    kind,
    canonicalUrl: `https://app.clickup.com/t/${encodeURIComponent(taskId)}`,
  }
}

export const normalizeClickUpTaskReference = (input: string): ClickUpTaskReference => {
  const value = input.trim()
  if (!value.includes('://')) return parseTaskId(value)

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ClickUpTaskReferenceError('TASK_REFERENCE_INVALID')
  }
  const path = /^\/t\/([^/]+)\/?$/.exec(url.pathname)
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'app.clickup.com' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    path?.[1] === undefined
  ) {
    throw new ClickUpTaskReferenceError('TASK_REFERENCE_INVALID')
  }

  try {
    return parseTaskId(decodeURIComponent(path[1]))
  } catch {
    throw new ClickUpTaskReferenceError('TASK_REFERENCE_INVALID')
  }
}
