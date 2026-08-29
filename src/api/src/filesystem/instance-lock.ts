import { lstat, mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import { createAtomicJsonResourceIO } from './atomic-json-resource.js'
import { FilesystemResourceError } from './filesystem-errors.js'
import type { SlopifyPaths } from './slopify-home.js'

export const InstanceLockOwnerSchema = z.strictObject({
  schemaVersion: z.literal(1),
  instanceId: z.string().min(1).max(128),
  pid: z.number().int().positive().safe(),
  processStartedAt: z.iso.datetime({ offset: true }),
  acquiredAt: z.iso.datetime({ offset: true }),
  heartbeatAt: z.iso.datetime({ offset: true }),
})

export type InstanceLockOwner = z.infer<typeof InstanceLockOwnerSchema>
export type InstanceLockErrorCode =
  'INSTANCE_ALREADY_RUNNING' | 'INSTANCE_LOCK_LOST' | 'INSTANCE_LOCK_ACQUIRE_FAILED'

export class InstanceLockError extends Error {
  readonly code: InstanceLockErrorCode
  readonly owner: InstanceLockOwner | undefined

  constructor(
    code: InstanceLockErrorCode,
    message: string,
    input: Readonly<{ owner?: InstanceLockOwner; cause?: unknown }> = {},
  ) {
    super(message, input.cause === undefined ? undefined : { cause: input.cause })
    this.name = 'InstanceLockError'
    this.code = code
    this.owner = input.owner
  }
}

export interface InstanceLockHandle {
  readonly directory: string
  readonly ownerFile: string
  readonly owner: InstanceLockOwner
  heartbeat(): Promise<void>
  release(): Promise<void>
}

export interface InstanceLockManager {
  acquire(): Promise<InstanceLockHandle>
}

type OwnerAlive = (owner: InstanceLockOwner) => Promise<boolean>

const systemOwnerAlive: OwnerAlive = async (owner) => {
  try {
    process.kill(owner.pid, 0)
    return true
  } catch (cause) {
    return !(
      typeof cause === 'object' &&
      cause !== null &&
      'code' in cause &&
      (cause as { code: unknown }).code === 'ESRCH'
    )
  }
}

const nodeErrorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined

export const createInstanceLockManager = (
  options: Readonly<{
    paths: Pick<SlopifyPaths, 'runtimeDirectory'>
    instanceId?: string
    pid?: number
    processStartedAt?: string
    staleAfterMs?: number
    now?: () => string
    ownerAlive?: OwnerAlive
  }>,
): InstanceLockManager => {
  const resources = createAtomicJsonResourceIO()
  const now = options.now ?? (() => new Date().toISOString())
  const instanceId = options.instanceId ?? crypto.randomUUID()
  const pid = options.pid ?? process.pid
  const processStartedAt =
    options.processStartedAt ?? new Date(Date.now() - process.uptime() * 1_000).toISOString()
  const staleAfterMs = options.staleAfterMs ?? 30_000
  if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs < 1)
    throw new TypeError('staleAfterMs must be a positive integer')
  const ownerAlive = options.ownerAlive ?? systemOwnerAlive
  const directory = join(options.paths.runtimeDirectory, 'instance.lock')
  const ownerFile = join(directory, 'owner.json')

  const readOwner = (): Promise<InstanceLockOwner> =>
    resources.read({ path: ownerFile, schema: InstanceLockOwnerSchema, maxBytes: 16_384 })

  const alreadyRunning = (owner?: InstanceLockOwner, cause?: unknown): InstanceLockError =>
    new InstanceLockError(
      'INSTANCE_ALREADY_RUNNING',
      'Another Slopify instance owns this home',
      owner === undefined ? { cause } : { owner, cause },
    )

  const retireDirectory = async (suffix: string): Promise<boolean> => {
    const retired = join(
      options.paths.runtimeDirectory,
      `instance.lock.${suffix}.${instanceId}.${crypto.randomUUID()}`,
    )
    try {
      await rename(directory, retired)
    } catch (cause) {
      if (nodeErrorCode(cause) === 'ENOENT') return false
      throw cause
    }
    await rm(retired, { recursive: true, force: true })
    return true
  }

  const recoverIfStale = async (): Promise<boolean> => {
    let owner: InstanceLockOwner | undefined
    try {
      owner = await readOwner()
    } catch (cause) {
      if (!(cause instanceof FilesystemResourceError)) throw cause
      const metadata = await lstat(directory)
      if (Date.parse(now()) - metadata.mtimeMs <= staleAfterMs)
        throw alreadyRunning(undefined, cause)
      return retireDirectory('stale')
    }
    const heartbeatAge = Date.parse(now()) - Date.parse(owner.heartbeatAt)
    if (heartbeatAge <= staleAfterMs || (await ownerAlive(owner))) throw alreadyRunning(owner)
    return retireDirectory('stale')
  }

  return {
    async acquire() {
      await mkdir(options.paths.runtimeDirectory, { recursive: true, mode: 0o700 })
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await mkdir(directory, { mode: 0o700 })
        } catch (cause) {
          if (nodeErrorCode(cause) !== 'EEXIST')
            throw new InstanceLockError(
              'INSTANCE_LOCK_ACQUIRE_FAILED',
              'Slopify instance lock could not be acquired',
              { cause },
            )
          if (await recoverIfStale()) continue
          continue
        }

        const acquiredAt = now()
        const owner = InstanceLockOwnerSchema.parse({
          schemaVersion: 1,
          instanceId,
          pid,
          processStartedAt,
          acquiredAt,
          heartbeatAt: acquiredAt,
        })
        try {
          await resources.write({
            path: ownerFile,
            schema: InstanceLockOwnerSchema,
            value: owner,
            maxBytes: 16_384,
          })
        } catch (cause) {
          await rm(directory, { recursive: true, force: true })
          throw new InstanceLockError(
            'INSTANCE_LOCK_ACQUIRE_FAILED',
            'Slopify instance lock owner could not be recorded',
            { cause },
          )
        }
        let released = false
        const requireOwnership = async (): Promise<InstanceLockOwner> => {
          let current: InstanceLockOwner
          try {
            current = await readOwner()
          } catch (cause) {
            throw new InstanceLockError('INSTANCE_LOCK_LOST', 'Slopify instance lock was lost', {
              cause,
            })
          }
          if (current.instanceId !== instanceId)
            throw new InstanceLockError(
              'INSTANCE_LOCK_LOST',
              'Slopify instance lock has a different owner',
              { owner: current },
            )
          return current
        }
        return {
          directory,
          ownerFile,
          owner,
          async heartbeat() {
            if (released)
              throw new InstanceLockError(
                'INSTANCE_LOCK_LOST',
                'Slopify instance lock was released',
              )
            const current = await requireOwnership()
            await resources.write({
              path: ownerFile,
              schema: InstanceLockOwnerSchema,
              value: { ...current, heartbeatAt: now() },
              maxBytes: 16_384,
            })
          },
          async release() {
            if (released) return
            await requireOwnership()
            if (!(await retireDirectory('released')))
              throw new InstanceLockError('INSTANCE_LOCK_LOST', 'Slopify instance lock was lost')
            released = true
          },
        }
      }
      throw alreadyRunning()
    },
  }
}
