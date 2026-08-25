import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import type { z } from 'zod'

import { FilesystemResourceError } from './filesystem-errors.js'

const DEFAULT_MAX_BYTES = 1_048_576
const MAX_CONFIGURABLE_BYTES = 67_108_864

export interface ReadJsonResourceInput<Output> {
  readonly path: string
  readonly schema: z.ZodType<Output>
  readonly maxBytes?: number
}

export interface WriteJsonResourceInput<Output> extends ReadJsonResourceInput<Output> {
  readonly value: unknown
}

export interface AtomicJsonResourceIO {
  read<Output>(input: ReadJsonResourceInput<Output>): Promise<Output>
  write<Output>(input: WriteJsonResourceInput<Output>): Promise<Output>
}

type Commit = (temporaryPath: string, destinationPath: string) => Promise<void>

const errorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined

const byteLimit = (value: number | undefined): number => {
  const limit = value ?? DEFAULT_MAX_BYTES
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_CONFIGURABLE_BYTES)
    throw new TypeError('maxBytes must be an integer from 1 to 67108864')
  return limit
}

const inspectPath = async (path: string, missingAllowed: boolean): Promise<void> => {
  try {
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink())
      throw new FilesystemResourceError(
        'RESOURCE_SYMLINK_NOT_ALLOWED',
        'Symbolic links are not allowed for JSON resources',
        { path },
      )
    if (!metadata.isFile())
      throw new FilesystemResourceError(
        'RESOURCE_NOT_FILE',
        'JSON resource path is not a regular file',
        { path },
      )
  } catch (cause) {
    if (cause instanceof FilesystemResourceError) throw cause
    if (errorCode(cause) === 'ENOENT' && missingAllowed) return
    if (errorCode(cause) === 'ENOENT')
      throw new FilesystemResourceError('RESOURCE_NOT_FOUND', 'JSON resource was not found', {
        path,
        cause,
      })
    throw cause
  }
}

const readBounded = async (path: string, maxBytes: number): Promise<string> => {
  await inspectPath(path, false)
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const metadata = await handle.stat()
    if (!metadata.isFile())
      throw new FilesystemResourceError(
        'RESOURCE_NOT_FILE',
        'JSON resource path is not a regular file',
        { path },
      )
    if (metadata.size > maxBytes)
      throw new FilesystemResourceError(
        'RESOURCE_TOO_LARGE',
        `JSON resource exceeds ${maxBytes} bytes`,
        { path },
      )
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
        `JSON resource exceeds ${maxBytes} bytes`,
        { path },
      )
    return buffer.subarray(0, offset).toString('utf8')
  } catch (cause) {
    if (cause instanceof FilesystemResourceError) throw cause
    if (errorCode(cause) === 'ENOENT')
      throw new FilesystemResourceError('RESOURCE_NOT_FOUND', 'JSON resource was not found', {
        path,
        cause,
      })
    if (errorCode(cause) === 'ELOOP')
      throw new FilesystemResourceError(
        'RESOURCE_SYMLINK_NOT_ALLOWED',
        'Symbolic links are not allowed for JSON resources',
        { path, cause },
      )
    throw new FilesystemResourceError('RESOURCE_READ_FAILED', 'JSON resource could not be read', {
      path,
      cause,
    })
  } finally {
    await handle?.close()
  }
}

export const createAtomicJsonResourceIO = (
  options: Readonly<{ commit?: Commit }> = {},
): AtomicJsonResourceIO => {
  const commit = options.commit ?? rename
  return {
    async read(input) {
      const source = await readBounded(input.path, byteLimit(input.maxBytes))
      let value: unknown
      try {
        value = JSON.parse(source)
      } catch (cause) {
        throw new FilesystemResourceError('RESOURCE_MALFORMED', 'JSON resource is malformed', {
          path: input.path,
          cause,
        })
      }
      const parsed = input.schema.safeParse(value)
      if (!parsed.success)
        throw new FilesystemResourceError(
          'RESOURCE_VALIDATION_FAILED',
          'JSON resource does not match its schema',
          { path: input.path, cause: parsed.error },
        )
      return parsed.data
    },
    async write(input) {
      const parsed = input.schema.safeParse(input.value)
      if (!parsed.success)
        throw new FilesystemResourceError(
          'RESOURCE_VALIDATION_FAILED',
          'JSON resource does not match its schema',
          { path: input.path, cause: parsed.error },
        )
      let json: string | undefined
      try {
        json = JSON.stringify(parsed.data, null, 2)
      } catch (cause) {
        throw new FilesystemResourceError(
          'RESOURCE_VALIDATION_FAILED',
          'JSON resource value cannot be serialized',
          { path: input.path, cause },
        )
      }
      if (json === undefined)
        throw new FilesystemResourceError(
          'RESOURCE_VALIDATION_FAILED',
          'JSON resource value cannot be serialized',
          { path: input.path },
        )
      const serialized = `${json}\n`
      const maxBytes = byteLimit(input.maxBytes)
      if (Buffer.byteLength(serialized) > maxBytes)
        throw new FilesystemResourceError(
          'RESOURCE_TOO_LARGE',
          `JSON resource exceeds ${maxBytes} bytes`,
          { path: input.path },
        )
      await inspectPath(input.path, true)
      const directory = dirname(input.path)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const temporaryPath = join(
        directory,
        `.${basename(input.path)}.${process.pid}.${crypto.randomUUID()}.tmp`,
      )
      let handle
      try {
        handle = await open(temporaryPath, 'wx', 0o600)
        await handle.writeFile(serialized, 'utf8')
        await handle.sync()
        await handle.close()
        handle = undefined
        await inspectPath(input.path, true)
        await commit(temporaryPath, input.path)
        const directoryHandle = await open(directory, constants.O_RDONLY)
        try {
          await directoryHandle.sync()
        } finally {
          await directoryHandle.close()
        }
        return parsed.data
      } catch (cause) {
        if (cause instanceof FilesystemResourceError) throw cause
        throw new FilesystemResourceError(
          'RESOURCE_WRITE_FAILED',
          'JSON resource could not be written',
          { path: input.path, cause },
        )
      } finally {
        await handle?.close()
        await rm(temporaryPath, { force: true })
      }
    },
  }
}
