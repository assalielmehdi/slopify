import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  calculateResourceRevision,
  createResourceWatcher,
  type ResourceChangeEvent,
  type WatchDirectory,
} from '../../src/index.js'

const directories: string[] = []

const createFixture = () => {
  const directory = mkdtempSync(join(tmpdir(), 'slopify-resource-watcher-'))
  directories.push(directory)
  const path = join(directory, 'settings.json')
  const listeners: Parameters<WatchDirectory>[1][] = []
  const close = vi.fn()
  const watchDirectory: WatchDirectory = vi.fn((_directory, listener) => {
    listeners.push(listener)
    return { close }
  })
  const events: ResourceChangeEvent[] = []
  const errors: unknown[] = []
  const watcher = createResourceWatcher({
    resources: [{ resourceId: 'settings', path }],
    debounceMs: 10,
    reconcileIntervalMs: 100,
    watchDirectory,
    onError: (error) => errors.push(error),
  })
  return { path, listeners, close, watchDirectory, events, errors, watcher }
}

afterEach(() => {
  vi.useRealTimers()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('editable resource watcher', () => {
  it('normalizes create, change, rename, and delete notifications after debouncing', async () => {
    const fixture = createFixture()
    await fixture.watcher.start((event) => fixture.events.push(event))
    expect(fixture.watchDirectory).toHaveBeenCalledOnce()
    expect(fixture.watchDirectory).toHaveBeenCalledWith(dirname(fixture.path), expect.any(Function))
    const notify = fixture.listeners[0]
    if (notify === undefined) throw new Error('watch listener missing')

    const first = '{"theme":"light"}\n'
    writeFileSync(fixture.path, first)
    notify('rename', 'settings.json')
    await vi.waitFor(() => expect(fixture.events).toHaveLength(1))
    expect(fixture.events).toEqual([
      {
        type: 'CREATED',
        resourceId: 'settings',
        path: fixture.path,
        previousRevision: null,
        revision: calculateResourceRevision(first),
      },
    ])

    const second = '{"theme":"dark"}\n'
    writeFileSync(fixture.path, second)
    notify('change', 'settings.json')
    notify('change', 'settings.json')
    await vi.waitFor(() => expect(fixture.events).toHaveLength(2))
    expect(fixture.events.at(-1)).toEqual({
      type: 'CHANGED',
      resourceId: 'settings',
      path: fixture.path,
      previousRevision: calculateResourceRevision(first),
      revision: calculateResourceRevision(second),
    })
    expect(fixture.events).toHaveLength(2)

    const movedPath = `${fixture.path}.moved`
    renameSync(fixture.path, movedPath)
    notify('rename', 'settings.json')
    await vi.waitFor(() => expect(fixture.events).toHaveLength(3))
    expect(fixture.events.at(-1)).toMatchObject({
      type: 'DELETED',
      previousRevision: calculateResourceRevision(second),
      revision: null,
    })

    renameSync(movedPath, fixture.path)
    notify('rename', 'settings.json')
    await vi.waitFor(() => expect(fixture.events).toHaveLength(4))
    expect(fixture.events.at(-1)).toMatchObject({
      type: 'CREATED',
      previousRevision: null,
      revision: calculateResourceRevision(second),
    })
    expect(fixture.errors).toEqual([])
    await fixture.watcher.stop()
    expect(fixture.close).toHaveBeenCalledOnce()
  })

  it('finds missed changes during periodic reconciliation', async () => {
    const fixture = createFixture()
    writeFileSync(fixture.path, '{"theme":"light"}\n')
    await fixture.watcher.start((event) => fixture.events.push(event))
    writeFileSync(fixture.path, '{"theme":"system"}\n')

    await vi.waitFor(() => expect(fixture.events).toHaveLength(1))

    expect(fixture.events).toEqual([
      expect.objectContaining({
        type: 'CHANGED',
        resourceId: 'settings',
        revision: calculateResourceRevision('{"theme":"system"}\n'),
      }),
    ])
    await fixture.watcher.stop()
  })

  it('deduplicates directory watches and emits resources in declaration order', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'slopify-resource-watcher-'))
    directories.push(directory)
    const watchDirectory: WatchDirectory = vi.fn(() => ({ close: vi.fn() }))
    const watcher = createResourceWatcher({
      resources: [
        { resourceId: 'settings', path: join(directory, 'settings.json') },
        { resourceId: 'repositories', path: join(directory, 'repositories.json') },
      ],
      watchDirectory,
    })

    await watcher.start(() => undefined)

    expect(watchDirectory).toHaveBeenCalledOnce()
    await watcher.stop()
  })
})
