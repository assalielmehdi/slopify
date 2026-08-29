import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { createProcessRunner } from '../../src/platform/processes/process-runner.js'

const fixturePath = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))

const temporaryDirectories: string[] = []

const createTemporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'slopify-process-runner-'))
  temporaryDirectories.push(directory)
  return directory
}

const waitForFile = async (path: string): Promise<void> => {
  const deadline = Date.now() + 2_000
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('bounded process runner', () => {
  it('uses a literal argument array without a shell or TTY and keeps streams separate', async () => {
    const directory = createTemporaryDirectory()
    const marker = join(directory, 'shell-was-used')
    const shellLikeArgument = `value; touch ${marker}`
    const runner = createProcessRunner({ maxOutputBytes: 1_024 })

    const result = await runner.run({
      executable: process.execPath,
      arguments: [fixturePath('emit-output.mjs'), shellLikeArgument, 'safe', '0'],
      cwd: directory,
      timeoutMs: 1_000,
    })

    expect(result).toMatchObject({
      status: 'exited',
      exitCode: 0,
      stdout: `stdout:${shellLikeArgument}:safe:`,
      stderr: 'stderr:safe:',
      stdoutTruncated: false,
      stderrTruncated: false,
    })
    expect(existsSync(marker)).toBe(false)
  })

  it('redacts configured secrets before retaining bounded stream evidence', async () => {
    const secret = 'private-host-value'
    const runner = createProcessRunner({
      maxOutputBytes: 64,
      redactedValues: [secret],
    })

    const result = await runner.run({
      executable: process.execPath,
      arguments: [fixturePath('emit-output.mjs'), 'argument', secret, '256'],
      cwd: createTemporaryDirectory(),
      timeoutMs: 1_000,
    })

    expect(result).toMatchObject({
      status: 'exited',
      exitCode: 0,
      stdoutTruncated: true,
      stderrTruncated: true,
    })
    expect(result.stdout).not.toContain(secret)
    expect(result.stderr).not.toContain(secret)
    expect(result.stdout).toContain('[REDACTED]')
    expect(result.stderr).toContain('[REDACTED]')
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(64)
    expect(Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(64)
  })

  it('times out only after a resistant process has been forcefully terminated', async () => {
    const runner = createProcessRunner({
      maxOutputBytes: 1_024,
      forceKillAfterMs: 20,
      terminationConfirmationTimeoutMs: 1_000,
    })

    const result = await runner.run({
      executable: process.execPath,
      arguments: [fixturePath('ignore-termination.mjs')],
      cwd: createTemporaryDirectory(),
      timeoutMs: 200,
    })

    expect(result).toMatchObject({ status: 'timed-out', signal: 'SIGKILL' })
  })

  it.skipIf(process.platform === 'win32')(
    'confirms cancellation only after the whole process group exits',
    async () => {
      const directory = createTemporaryDirectory()
      const childPidFile = join(directory, 'child.pid')
      const controller = new AbortController()
      const runner = createProcessRunner({
        maxOutputBytes: 1_024,
        forceKillAfterMs: 20,
        terminationConfirmationTimeoutMs: 1_000,
      })

      const execution = runner.run({
        executable: process.execPath,
        arguments: [fixturePath('spawn-child.mjs'), childPidFile],
        cwd: directory,
        timeoutMs: 5_000,
        signal: controller.signal,
      })
      await waitForFile(childPidFile)
      const childPid = Number.parseInt(readFileSync(childPidFile, 'utf8'), 10)

      controller.abort()
      const result = await execution

      expect(result).toMatchObject({ status: 'cancelled', signal: 'SIGKILL' })
      expect(isProcessAlive(childPid)).toBe(false)
    },
  )

  it('maps spawn errors to a stable result without exposing library details', async () => {
    const runner = createProcessRunner({ maxOutputBytes: 1_024 })

    const result = await runner.run({
      executable: join(createTemporaryDirectory(), 'missing-executable'),
      arguments: [],
      cwd: createTemporaryDirectory(),
      timeoutMs: 1_000,
    })

    expect(result).toMatchObject({
      status: 'failed-to-start',
      code: 'ENOENT',
      message: 'Process could not be started',
      stdout: '',
      stderr: '',
    })
  })
})
