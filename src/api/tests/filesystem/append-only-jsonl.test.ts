import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createAppendOnlyJsonl, type AppendOnlyJsonlError } from '../../src/index.js'

const directories: string[] = []
const recordSchema = z.strictObject({
  sequence: z.number().int().positive(),
  type: z.string().min(1),
})

const createPath = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'slopify-jsonl-'))
  directories.push(directory)
  return join(directory, 'events.jsonl')
}

const rejectsWith = async (promise: Promise<unknown>, code: AppendOnlyJsonlError['code']) => {
  await expect(promise).rejects.toMatchObject({ name: 'AppendOnlyJsonlError', code })
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('append-only JSONL', () => {
  it('serializes concurrent appends into contiguous durable sequences', async () => {
    const path = createPath()
    const journal = createAppendOnlyJsonl({ path, schema: recordSchema })

    const appended = await Promise.all(
      Array.from({ length: 25 }, (_, index) => journal.append({ type: `EVENT_${index + 1}` })),
    )

    expect(appended.map(({ sequence }) => sequence)).toEqual(
      Array.from({ length: 25 }, (_, index) => index + 1),
    )
    await expect(journal.replay()).resolves.toEqual({ records: appended, recoveredBytes: 0 })
    expect(readFileSync(path, 'utf8').split('\n').filter(Boolean)).toHaveLength(25)
  })

  it('does not acknowledge an append until its file flush completes', async () => {
    const path = createPath()
    let release: (() => void) | undefined
    let markFlushEntered: (() => void) | undefined
    let settled = false
    const flushEntered = new Promise<void>((resolve) => {
      markFlushEntered = resolve
    })
    const journal = createAppendOnlyJsonl({
      path,
      schema: recordSchema,
      flush: () =>
        new Promise<void>((resolve) => {
          release = resolve
          markFlushEntered?.()
        }),
    })

    const append = journal.append({ type: 'WAIT_FOR_FLUSH' }).then(() => {
      settled = true
    })
    await flushEntered
    expect(settled).toBe(false)
    expect(readFileSync(path, 'utf8')).toContain('WAIT_FOR_FLUSH')

    release?.()
    await append
    expect(settled).toBe(true)
  })

  it('repairs only a trailing partial record and resumes at its sequence', async () => {
    const path = createPath()
    const journal = createAppendOnlyJsonl({ path, schema: recordSchema })
    await journal.append({ type: 'FIRST' })
    await journal.append({ type: 'SECOND' })
    appendFileSync(path, '{"sequence":3,"type":"PARTIAL"')

    await expect(journal.replay()).resolves.toEqual({
      records: [
        { sequence: 1, type: 'FIRST' },
        { sequence: 2, type: 'SECOND' },
      ],
      recoveredBytes: Buffer.byteLength('{"sequence":3,"type":"PARTIAL"'),
    })
    expect(readFileSync(path, 'utf8')).toBe(
      '{"sequence":1,"type":"FIRST"}\n{"sequence":2,"type":"SECOND"}\n',
    )
    await expect(journal.append({ type: 'THIRD' })).resolves.toEqual({
      sequence: 3,
      type: 'THIRD',
    })
  })

  it('surfaces and preserves corruption before the trailing record', async () => {
    const path = createPath()
    const contents = '{"sequence":1,"type":"FIRST"}\n{"sequence":2\n{"sequence":3,"type":"PARTIAL"'
    writeFileSync(path, contents)
    const journal = createAppendOnlyJsonl({ path, schema: recordSchema })

    await expect(journal.replay()).rejects.toMatchObject({
      name: 'AppendOnlyJsonlError',
      code: 'JSONL_CORRUPT',
      lineNumber: 2,
    } satisfies Partial<AppendOnlyJsonlError>)
    expect(readFileSync(path, 'utf8')).toBe(contents)
  })

  it('rejects non-contiguous and schema-invalid complete records', async () => {
    const path = createPath()
    const journal = createAppendOnlyJsonl({ path, schema: recordSchema })
    writeFileSync(path, '{"sequence":2,"type":"GAP"}\n')
    await rejectsWith(journal.replay(), 'JSONL_CORRUPT')

    writeFileSync(path, '{"sequence":1,"unknown":true}\n')
    await rejectsWith(journal.replay(), 'JSONL_CORRUPT')
  })

  it('enforces file and record bounds before allocating or appending', async () => {
    const path = createPath()
    writeFileSync(path, 'x'.repeat(65))
    await rejectsWith(
      createAppendOnlyJsonl({ path, schema: recordSchema, maxFileBytes: 64 }).replay(),
      'JSONL_TOO_LARGE',
    )

    const emptyPath = createPath()
    await rejectsWith(
      createAppendOnlyJsonl({
        path: emptyPath,
        schema: recordSchema,
        maxRecordBytes: 32,
      }).append({ type: 'A value that exceeds the configured record bound' }),
      'JSONL_RECORD_TOO_LARGE',
    )
    expect(existsSync(emptyPath)).toBe(false)
  })

  it('rejects oversized records already present during replay', async () => {
    const path = createPath()
    writeFileSync(path, `${JSON.stringify({ sequence: 1, type: 'x'.repeat(64) })}\n`)

    await rejectsWith(
      createAppendOnlyJsonl({
        path,
        schema: recordSchema,
        maxFileBytes: 256,
        maxRecordBytes: 64,
      }).replay(),
      'JSONL_RECORD_TOO_LARGE',
    )
  })
})
