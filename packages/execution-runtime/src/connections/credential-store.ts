import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { z } from 'zod'

export const CredentialSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('api_key'), key: z.string().min(1) }).readonly(),
  z
    .strictObject({
      type: z.literal('oauth'),
      access: z.string().min(1),
      refresh: z.string().min(1),
      expires: z.number().int().positive().safe(),
      accountId: z.string().min(1).optional(),
    })
    .readonly(),
])

export type Credential = z.infer<typeof CredentialSchema>

export interface CredentialStore {
  read(connectionId: string): Promise<Credential | undefined>
  modify(
    connectionId: string,
    modify: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined>
  delete(connectionId: string): Promise<void>
}

const createSerializedExecutor = () => {
  let tail = Promise.resolve()
  return async <Value>(operation: () => Promise<Value>): Promise<Value> => {
    const previous = tail
    let release: () => void = () => undefined
    tail = new Promise<void>((resolvePromise) => {
      release = resolvePromise
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

export const createInMemoryCredentialStore = (): CredentialStore => {
  const values = new Map<string, Credential>()
  const serialize = createSerializedExecutor()
  return {
    async read(connectionId) {
      const value = values.get(connectionId)
      return value === undefined ? undefined : CredentialSchema.parse(structuredClone(value))
    },
    modify(connectionId, modify) {
      return serialize(async () => {
        const next = await modify(values.get(connectionId))
        if (next === undefined) values.delete(connectionId)
        else values.set(connectionId, CredentialSchema.parse(next))
        return next
      })
    },
    delete(connectionId) {
      return serialize(async () => {
        values.delete(connectionId)
      })
    },
  }
}

const CredentialFileSchema = z.record(z.string().min(1), CredentialSchema)
const wait = (milliseconds: number) =>
  new Promise<void>((resolvePromise) => setTimeout(resolvePromise, milliseconds))

const acquireLock = async (path: string): Promise<() => Promise<void>> => {
  const lockPath = `${path}.lock`
  const deadline = Date.now() + 5_000
  while (true) {
    try {
      const handle = await open(lockPath, 'wx', 0o600)
      await handle.close()
      return () => rm(lockPath, { force: true })
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST' || Date.now() >= deadline) throw cause
      await wait(10)
    }
  }
}

const readCredentials = async (path: string): Promise<Record<string, Credential>> => {
  try {
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink() || !metadata.isFile() || (metadata.mode & 0o077) !== 0)
      throw new Error('Credential file permissions are unsafe')
    return CredentialFileSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw cause
  }
}

const writeCredentials = async (path: string, values: Readonly<Record<string, Credential>>) => {
  const temporary = `${path}.tmp-${randomUUID()}`
  try {
    await writeFile(temporary, `${JSON.stringify(values, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    await chmod(temporary, 0o600)
    await rename(temporary, path)
    await chmod(path, 0o600)
  } finally {
    await rm(temporary, { force: true })
  }
}

export const createFileCredentialStore = (options: Readonly<{ path: string }>): CredentialStore => {
  const path = resolve(options.path)
  const serialize = createSerializedExecutor()
  const initialize = () => mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const mutate = <Value>(operation: (values: Record<string, Credential>) => Promise<Value>) =>
    serialize(async () => {
      await initialize()
      const release = await acquireLock(path)
      try {
        const values = await readCredentials(path)
        const result = await operation(values)
        await writeCredentials(path, values)
        return result
      } finally {
        await release()
      }
    })

  return {
    async read(connectionId) {
      await initialize()
      const value = (await readCredentials(path))[connectionId]
      return value === undefined ? undefined : CredentialSchema.parse(value)
    },
    modify(connectionId, modify) {
      return mutate(async (values) => {
        const next = await modify(values[connectionId])
        if (next === undefined) Reflect.deleteProperty(values, connectionId)
        else values[connectionId] = CredentialSchema.parse(next)
        return next
      })
    },
    delete(connectionId) {
      return mutate(async (values) => {
        Reflect.deleteProperty(values, connectionId)
      })
    },
  }
}
