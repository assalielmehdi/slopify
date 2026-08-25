import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'

import { z } from 'zod'

import { FilesystemResourceError } from './filesystem-errors.js'

const DEFAULT_MAX_BYTES = 1_048_576
const MAX_BYTES = 67_108_864

export const ResourceRevisionSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u)
  .brand<'ResourceRevision'>()

export type ResourceRevision = z.infer<typeof ResourceRevisionSchema>

export const calculateResourceRevision = (source: string | Uint8Array): ResourceRevision =>
  ResourceRevisionSchema.parse(createHash('sha256').update(source).digest('hex'))

const nodeErrorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined

export const readResourceRevision = async (
  input: Readonly<{ path: string; maxBytes?: number }>,
): Promise<ResourceRevision | null> => {
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES)
    throw new TypeError(`maxBytes must be an integer from 1 to ${MAX_BYTES}`)
  let handle
  try {
    const pathMetadata = await lstat(input.path)
    if (pathMetadata.isSymbolicLink())
      throw new FilesystemResourceError(
        'RESOURCE_SYMLINK_NOT_ALLOWED',
        'Symbolic links are not allowed for watched resources',
        { path: input.path },
      )
    if (!pathMetadata.isFile())
      throw new FilesystemResourceError(
        'RESOURCE_NOT_FILE',
        'Watched resource path is not a regular file',
        { path: input.path },
      )
    if (pathMetadata.size > maxBytes)
      throw new FilesystemResourceError(
        'RESOURCE_TOO_LARGE',
        `Watched resource exceeds ${maxBytes} bytes`,
        { path: input.path },
      )
    handle = await open(input.path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const buffer = Buffer.alloc(maxBytes + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset > maxBytes)
      throw new FilesystemResourceError(
        'RESOURCE_TOO_LARGE',
        `Watched resource exceeds ${maxBytes} bytes`,
        { path: input.path },
      )
    return calculateResourceRevision(buffer.subarray(0, offset))
  } catch (cause) {
    if (cause instanceof FilesystemResourceError) throw cause
    if (nodeErrorCode(cause) === 'ENOENT') return null
    if (nodeErrorCode(cause) === 'ELOOP')
      throw new FilesystemResourceError(
        'RESOURCE_SYMLINK_NOT_ALLOWED',
        'Symbolic links are not allowed for watched resources',
        { path: input.path, cause },
      )
    throw new FilesystemResourceError(
      'RESOURCE_READ_FAILED',
      'Watched resource revision could not be read',
      { path: input.path, cause },
    )
  } finally {
    await handle?.close()
  }
}
