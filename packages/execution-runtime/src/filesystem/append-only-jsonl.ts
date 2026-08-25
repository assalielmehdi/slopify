import { constants } from 'node:fs'
import { lstat, mkdir, open } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { FileHandle } from 'node:fs/promises'
import type { z } from 'zod'

const DEFAULT_MAX_FILE_BYTES = 67_108_864
const DEFAULT_MAX_RECORD_BYTES = 1_048_576

export type AppendOnlyJsonlErrorCode =
  | 'JSONL_TOO_LARGE'
  | 'JSONL_RECORD_TOO_LARGE'
  | 'JSONL_RECORD_INVALID'
  | 'JSONL_CORRUPT'
  | 'JSONL_SYMLINK_NOT_ALLOWED'
  | 'JSONL_NOT_FILE'
  | 'JSONL_READ_FAILED'
  | 'JSONL_APPEND_FAILED'

export class AppendOnlyJsonlError extends Error {
  readonly code: AppendOnlyJsonlErrorCode
  readonly path: string
  readonly lineNumber: number | undefined

  constructor(
    code: AppendOnlyJsonlErrorCode,
    message: string,
    input: Readonly<{ path: string; lineNumber?: number; cause?: unknown }>,
  ) {
    super(message, input.cause === undefined ? undefined : { cause: input.cause })
    this.name = 'AppendOnlyJsonlError'
    this.code = code
    this.path = input.path
    this.lineNumber = input.lineNumber
  }
}

export interface JsonlReplay<Record> {
  readonly records: readonly Record[]
  readonly recoveredBytes: number
}

export interface AppendOnlyJsonl<Record extends { readonly sequence: number }> {
  append(record: Omit<Record, 'sequence'>): Promise<Record>
  replay(): Promise<JsonlReplay<Record>>
}

type Flush = (handle: FileHandle) => Promise<void>

const nodeErrorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined

const byteLimit = (name: string, value: number | undefined, fallback: number): number => {
  const limit = value ?? fallback
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > DEFAULT_MAX_FILE_BYTES)
    throw new TypeError(`${name} must be an integer from 1 to ${DEFAULT_MAX_FILE_BYTES}`)
  return limit
}

export const createAppendOnlyJsonl = <Record extends { readonly sequence: number }>(
  options: Readonly<{
    path: string
    schema: z.ZodType<Record>
    maxFileBytes?: number
    maxRecordBytes?: number
    flush?: Flush
  }>,
): AppendOnlyJsonl<Record> => {
  const maxFileBytes = byteLimit('maxFileBytes', options.maxFileBytes, DEFAULT_MAX_FILE_BYTES)
  const maxRecordBytes = byteLimit(
    'maxRecordBytes',
    options.maxRecordBytes,
    Math.min(DEFAULT_MAX_RECORD_BYTES, maxFileBytes),
  )
  if (maxRecordBytes > maxFileBytes)
    throw new TypeError('maxRecordBytes must not exceed maxFileBytes')
  const flush = options.flush ?? ((handle: FileHandle) => handle.sync())
  const parentDirectory = dirname(options.path)
  let queue: Promise<void> = Promise.resolve()
  let nextSequence: number | undefined

  const serialize = (record: unknown): string => {
    const parsed = options.schema.safeParse(record)
    if (!parsed.success)
      throw new AppendOnlyJsonlError(
        'JSONL_RECORD_INVALID',
        'JSONL record does not match its schema',
        { path: options.path, cause: parsed.error },
      )
    let json: string | undefined
    try {
      json = JSON.stringify(parsed.data)
    } catch (cause) {
      throw new AppendOnlyJsonlError('JSONL_RECORD_INVALID', 'JSONL record is not serializable', {
        path: options.path,
        cause,
      })
    }
    if (json === undefined)
      throw new AppendOnlyJsonlError('JSONL_RECORD_INVALID', 'JSONL record is not serializable', {
        path: options.path,
      })
    const line = `${json}\n`
    if (Buffer.byteLength(line) > maxRecordBytes)
      throw new AppendOnlyJsonlError(
        'JSONL_RECORD_TOO_LARGE',
        `JSONL record exceeds ${maxRecordBytes} bytes`,
        { path: options.path },
      )
    return line
  }

  const replay = async (): Promise<JsonlReplay<Record>> => {
    let handle: FileHandle | undefined
    try {
      const metadata = await lstat(options.path)
      if (metadata.isSymbolicLink())
        throw new AppendOnlyJsonlError(
          'JSONL_SYMLINK_NOT_ALLOWED',
          'Symbolic links are not allowed for JSONL resources',
          { path: options.path },
        )
      if (!metadata.isFile())
        throw new AppendOnlyJsonlError('JSONL_NOT_FILE', 'JSONL path is not a regular file', {
          path: options.path,
        })
      if (metadata.size > maxFileBytes)
        throw new AppendOnlyJsonlError(
          'JSONL_TOO_LARGE',
          `JSONL resource exceeds ${maxFileBytes} bytes`,
          { path: options.path },
        )
      handle = await open(options.path, constants.O_RDWR | constants.O_NOFOLLOW)
      const contents = await handle.readFile()
      if (contents.byteLength > maxFileBytes)
        throw new AppendOnlyJsonlError(
          'JSONL_TOO_LARGE',
          `JSONL resource exceeds ${maxFileBytes} bytes`,
          { path: options.path },
        )
      const finalNewline = contents.lastIndexOf(0x0a)
      const completeBytes = finalNewline < 0 ? 0 : finalNewline + 1
      const recoveredBytes = contents.byteLength - completeBytes
      const completeSource = contents.subarray(0, completeBytes).toString('utf8')
      const lines = completeSource.split('\n').slice(0, -1)
      const records: Record[] = []
      for (const [index, line] of lines.entries()) {
        let value: unknown
        try {
          value = JSON.parse(line)
        } catch (cause) {
          throw new AppendOnlyJsonlError('JSONL_CORRUPT', 'JSONL record is malformed', {
            path: options.path,
            lineNumber: index + 1,
            cause,
          })
        }
        const parsed = options.schema.safeParse(value)
        if (!parsed.success || parsed.data.sequence !== index + 1)
          throw new AppendOnlyJsonlError(
            'JSONL_CORRUPT',
            'JSONL sequence or record schema is invalid',
            { path: options.path, lineNumber: index + 1, cause: parsed.error },
          )
        records.push(parsed.data)
      }
      if (recoveredBytes > 0) {
        await handle.truncate(completeBytes)
        await flush(handle)
      }
      nextSequence = records.length + 1
      return { records, recoveredBytes }
    } catch (cause) {
      if (cause instanceof AppendOnlyJsonlError) throw cause
      if (nodeErrorCode(cause) === 'ENOENT') {
        nextSequence = 1
        return { records: [], recoveredBytes: 0 }
      }
      if (nodeErrorCode(cause) === 'ELOOP')
        throw new AppendOnlyJsonlError(
          'JSONL_SYMLINK_NOT_ALLOWED',
          'Symbolic links are not allowed for JSONL resources',
          { path: options.path, cause },
        )
      throw new AppendOnlyJsonlError('JSONL_READ_FAILED', 'JSONL resource could not be read', {
        path: options.path,
        cause,
      })
    } finally {
      await handle?.close()
    }
  }

  const enqueue = <Value>(operation: () => Promise<Value>): Promise<Value> => {
    const result = queue.then(operation)
    queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  return {
    append(input) {
      return enqueue(async () => {
        if (nextSequence === undefined) await replay()
        const sequence = nextSequence ?? 1
        const record = options.schema.parse({ ...input, sequence })
        const line = serialize(record)
        await mkdir(parentDirectory, { recursive: true, mode: 0o700 })
        let handle: FileHandle | undefined
        try {
          const size = await lstat(options.path).then(
            ({ size }) => size,
            (cause) => {
              if (nodeErrorCode(cause) === 'ENOENT') return 0
              throw cause
            },
          )
          if (size + Buffer.byteLength(line) > maxFileBytes)
            throw new AppendOnlyJsonlError(
              'JSONL_TOO_LARGE',
              `JSONL resource exceeds ${maxFileBytes} bytes`,
              { path: options.path },
            )
          handle = await open(
            options.path,
            constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
            0o600,
          )
          await handle.writeFile(line, 'utf8')
          await flush(handle)
          const directoryHandle = await open(parentDirectory, constants.O_RDONLY)
          try {
            await directoryHandle.sync()
          } finally {
            await directoryHandle.close()
          }
          nextSequence = sequence + 1
          return record
        } catch (cause) {
          nextSequence = undefined
          if (cause instanceof AppendOnlyJsonlError) throw cause
          if (nodeErrorCode(cause) === 'ELOOP')
            throw new AppendOnlyJsonlError(
              'JSONL_SYMLINK_NOT_ALLOWED',
              'Symbolic links are not allowed for JSONL resources',
              { path: options.path, cause },
            )
          throw new AppendOnlyJsonlError(
            'JSONL_APPEND_FAILED',
            'JSONL record could not be appended',
            { path: options.path, cause },
          )
        } finally {
          await handle?.close()
        }
      })
    },
    replay() {
      return enqueue(replay)
    },
  }
}
