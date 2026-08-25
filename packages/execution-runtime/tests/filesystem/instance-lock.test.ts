import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createInstanceLockManager,
  resolveSlopifyPaths,
  type InstanceLockError,
} from '../../src/index.js'

const directories: string[] = []

const createPaths = () => {
  const home = mkdtempSync(join(tmpdir(), 'slopify-instance-lock-'))
  directories.push(home)
  return resolveSlopifyPaths({ environment: { SLOPIFY_HOME: home } })
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Slopify instance lock', () => {
  it('records the owner and prevents a second live writer', async () => {
    const paths = createPaths()
    const ownerAlive = vi.fn(async () => true)
    const firstManager = createInstanceLockManager({
      paths,
      instanceId: 'instance-01',
      pid: 101,
      processStartedAt: '2026-08-25T17:00:00.000Z',
      now: () => '2026-08-25T17:00:10.000Z',
      ownerAlive,
    })
    const first = await firstManager.acquire()

    expect(JSON.parse(readFileSync(first.ownerFile, 'utf8'))).toEqual({
      schemaVersion: 1,
      instanceId: 'instance-01',
      pid: 101,
      processStartedAt: '2026-08-25T17:00:00.000Z',
      acquiredAt: '2026-08-25T17:00:10.000Z',
      heartbeatAt: '2026-08-25T17:00:10.000Z',
    })

    await expect(
      createInstanceLockManager({
        paths,
        instanceId: 'instance-02',
        pid: 202,
        processStartedAt: '2026-08-25T17:00:05.000Z',
        now: () => '2026-08-25T17:00:11.000Z',
        ownerAlive,
      }).acquire(),
    ).rejects.toMatchObject({
      name: 'InstanceLockError',
      code: 'INSTANCE_ALREADY_RUNNING',
      owner: expect.objectContaining({ instanceId: 'instance-01', pid: 101 }),
    } satisfies Partial<InstanceLockError>)
    expect(ownerAlive).not.toHaveBeenCalled()
    await first.release()
  })

  it('updates the heartbeat and releases its lock idempotently', async () => {
    const paths = createPaths()
    let timestamp = '2026-08-25T17:00:10.000Z'
    const lock = await createInstanceLockManager({
      paths,
      instanceId: 'instance-01',
      pid: 101,
      processStartedAt: '2026-08-25T17:00:00.000Z',
      now: () => timestamp,
    }).acquire()
    timestamp = '2026-08-25T17:00:20.000Z'

    await lock.heartbeat()
    expect(JSON.parse(readFileSync(lock.ownerFile, 'utf8'))).toMatchObject({
      acquiredAt: '2026-08-25T17:00:10.000Z',
      heartbeatAt: '2026-08-25T17:00:20.000Z',
    })
    await lock.release()
    await lock.release()
    expect(existsSync(lock.directory)).toBe(false)
  })

  it('recovers a stale dead owner without letting the old handle delete the new lock', async () => {
    const paths = createPaths()
    const oldLock = await createInstanceLockManager({
      paths,
      instanceId: 'instance-old',
      pid: 101,
      processStartedAt: '2026-08-25T16:00:00.000Z',
      now: () => '2026-08-25T17:00:00.000Z',
    }).acquire()
    const newLock = await createInstanceLockManager({
      paths,
      instanceId: 'instance-new',
      pid: 202,
      processStartedAt: '2026-08-25T17:01:00.000Z',
      now: () => '2026-08-25T17:02:00.000Z',
      staleAfterMs: 30_000,
      ownerAlive: vi.fn(async () => false),
    }).acquire()

    await expect(oldLock.release()).rejects.toMatchObject({ code: 'INSTANCE_LOCK_LOST' })
    expect(JSON.parse(readFileSync(newLock.ownerFile, 'utf8'))).toMatchObject({
      instanceId: 'instance-new',
    })
    await newLock.release()
  })

  it('does not steal a stale heartbeat from an owner that is still alive', async () => {
    const paths = createPaths()
    const oldLock = await createInstanceLockManager({
      paths,
      instanceId: 'instance-old',
      pid: 101,
      processStartedAt: '2026-08-25T16:00:00.000Z',
      now: () => '2026-08-25T17:00:00.000Z',
    }).acquire()
    const ownerAlive = vi.fn(async () => true)

    await expect(
      createInstanceLockManager({
        paths,
        instanceId: 'instance-new',
        pid: 202,
        processStartedAt: '2026-08-25T17:01:00.000Z',
        now: () => '2026-08-25T17:02:00.000Z',
        staleAfterMs: 30_000,
        ownerAlive,
      }).acquire(),
    ).rejects.toMatchObject({ code: 'INSTANCE_ALREADY_RUNNING' })
    expect(ownerAlive).toHaveBeenCalledWith(expect.objectContaining({ pid: 101 }))
    await oldLock.release()
  })

  it('recovers an abandoned partial lock only after it becomes stale', async () => {
    const paths = createPaths()
    const directory = join(paths.runtimeDirectory, 'instance.lock')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'owner.json'), '{')
    const staleTime = new Date('2026-08-25T17:00:00.000Z')
    utimesSync(directory, staleTime, staleTime)

    const lock = await createInstanceLockManager({
      paths,
      instanceId: 'instance-recovered',
      pid: 303,
      processStartedAt: '2026-08-25T17:01:00.000Z',
      now: () => '2026-08-25T17:02:00.000Z',
      staleAfterMs: 30_000,
    }).acquire()

    expect(JSON.parse(readFileSync(lock.ownerFile, 'utf8'))).toMatchObject({
      instanceId: 'instance-recovered',
    })
    await lock.release()
  })
})
