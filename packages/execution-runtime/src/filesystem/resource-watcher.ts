import { watch } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'

import { readResourceRevision, type ResourceRevision } from './resource-revision.js'

export type ResourceChangeType = 'CREATED' | 'CHANGED' | 'DELETED'

export interface WatchedResource {
  readonly resourceId: string
  readonly path: string
  readonly maxBytes?: number
}

export type WatchedResourceInventory =
  | readonly WatchedResource[]
  | (() => readonly WatchedResource[] | Promise<readonly WatchedResource[]>)

export interface ResourceChangeEvent {
  readonly type: ResourceChangeType
  readonly resourceId: string
  readonly path: string
  readonly previousRevision: ResourceRevision | null
  readonly revision: ResourceRevision | null
}

export type WatchDirectory = (
  directory: string,
  listener: (eventType: 'rename' | 'change', filename: string | null) => void,
) => Readonly<{ close(): void }>

export interface ResourceWatcher {
  start(listener: (event: ResourceChangeEvent) => void): Promise<void>
  reconcile(): Promise<void>
  stop(): Promise<void>
}

const defaultWatchDirectory: WatchDirectory = (directory, listener) => {
  const watcher = watch(directory, (eventType, filename) => {
    listener(eventType, filename?.toString() ?? null)
  })
  return { close: () => watcher.close() }
}

const positiveInteger = (name: string, value: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new TypeError(`${name} must be an integer from 1 to ${maximum}`)
  return value
}

export const createResourceWatcher = (
  options: Readonly<{
    resources: WatchedResourceInventory
    directories?: readonly string[]
    debounceMs?: number
    reconcileIntervalMs?: number
    watchDirectory?: WatchDirectory
    onError?: (error: unknown) => void
  }>,
): ResourceWatcher => {
  const configuredDirectories = options.directories ?? []
  for (const directory of configuredDirectories) {
    if (!isAbsolute(directory)) throw new TypeError('Watched directories must be absolute')
  }
  const debounceMs = positiveInteger('debounceMs', options.debounceMs ?? 50, 60_000)
  const reconcileIntervalMs = positiveInteger(
    'reconcileIntervalMs',
    options.reconcileIntervalMs ?? 5_000,
    3_600_000,
  )
  const watchDirectory = options.watchDirectory ?? defaultWatchDirectory
  const onError = options.onError ?? (() => undefined)
  const definitions = new Map<string, WatchedResource>()
  const revisions = new Map<string, ResourceRevision | null>()
  const handles = new Map<string, Readonly<{ close(): void }>>()
  let listener: ((event: ResourceChangeEvent) => void) | undefined
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let reconcileTimer: ReturnType<typeof setInterval> | undefined
  let reconciliation: Promise<void> = Promise.resolve()
  let started = false
  let stopped = false

  const inventory = async (): Promise<readonly WatchedResource[]> => {
    const resources =
      typeof options.resources === 'function' ? await options.resources() : options.resources
    const resourceIds = new Set<string>()
    const paths = new Set<string>()
    for (const resource of resources) {
      if (resource.resourceId.trim() === '') throw new TypeError('resourceId must not be blank')
      if (!isAbsolute(resource.path)) throw new TypeError('Watched resource paths must be absolute')
      if (resourceIds.has(resource.resourceId))
        throw new TypeError('resourceId values must be unique')
      if (paths.has(resource.path)) throw new TypeError('Watched resource paths must be unique')
      resourceIds.add(resource.resourceId)
      paths.add(resource.path)
    }
    return resources
  }

  const syncDirectoryWatches = (resources: readonly WatchedResource[]): void => {
    const directories = new Set([
      ...configuredDirectories,
      ...resources.map(({ path }) => dirname(path)),
    ])
    for (const directory of directories) {
      if (!handles.has(directory))
        handles.set(directory, watchDirectory(directory, scheduleReconciliation))
    }
    for (const [directory, handle] of handles) {
      if (directories.has(directory)) continue
      handle.close()
      handles.delete(directory)
    }
  }

  const reconcileNow = async (): Promise<void> => {
    const resources = await inventory()
    syncDirectoryWatches(resources)
    const currentIds = new Set(resources.map(({ resourceId }) => resourceId))
    for (const [resourceId, resource] of definitions) {
      if (currentIds.has(resourceId)) continue
      const previousRevision = revisions.get(resourceId) ?? null
      definitions.delete(resourceId)
      revisions.delete(resourceId)
      if (previousRevision === null) continue
      listener?.({
        type: 'DELETED',
        resourceId,
        path: resource.path,
        previousRevision,
        revision: null,
      })
    }
    for (const resource of resources) {
      const previousDefinition = definitions.get(resource.resourceId)
      if (previousDefinition !== undefined && previousDefinition.path !== resource.path) {
        throw new TypeError(`Watched resource path changed for ${resource.resourceId}`)
      }
      const revision = await readResourceRevision({
        path: resource.path,
        ...(resource.maxBytes === undefined ? {} : { maxBytes: resource.maxBytes }),
      })
      const previousRevision = revisions.get(resource.resourceId) ?? null
      definitions.set(resource.resourceId, resource)
      if (revision === previousRevision) continue
      revisions.set(resource.resourceId, revision)
      const type: ResourceChangeType =
        previousRevision === null ? 'CREATED' : revision === null ? 'DELETED' : 'CHANGED'
      listener?.({
        type,
        resourceId: resource.resourceId,
        path: resource.path,
        previousRevision,
        revision,
      })
    }
  }

  const reconcile = (): Promise<void> => {
    const result = reconciliation.then(reconcileNow)
    reconciliation = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  const scheduleReconciliation = () => {
    if (stopped) return
    if (debounceTimer !== undefined) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined
      void reconcile().catch(onError)
    }, debounceMs)
  }

  return {
    async start(nextListener) {
      if (started) throw new TypeError('Resource watcher has already started')
      if (stopped) throw new TypeError('Resource watcher has already stopped')
      listener = nextListener
      try {
        const resources = await inventory()
        for (const resource of resources) {
          definitions.set(resource.resourceId, resource)
          revisions.set(
            resource.resourceId,
            await readResourceRevision({
              path: resource.path,
              ...(resource.maxBytes === undefined ? {} : { maxBytes: resource.maxBytes }),
            }),
          )
        }
        syncDirectoryWatches(resources)
        reconcileTimer = setInterval(() => void reconcile().catch(onError), reconcileIntervalMs)
        started = true
      } catch (cause) {
        for (const handle of handles.values()) handle.close()
        handles.clear()
        listener = undefined
        definitions.clear()
        revisions.clear()
        throw cause
      }
    },
    reconcile,
    async stop() {
      if (stopped) return
      stopped = true
      if (debounceTimer !== undefined) clearTimeout(debounceTimer)
      if (reconcileTimer !== undefined) clearInterval(reconcileTimer)
      debounceTimer = undefined
      reconcileTimer = undefined
      for (const handle of handles.values()) handle.close()
      handles.clear()
      await reconciliation
    },
  }
}
