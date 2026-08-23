import { describe, expect, it, vi } from 'vitest'

import { createNativeRunProjectResolver, type ProcessRunner } from '../../src/index.js'

const exited = (stdout: string, exitCode = 0) => ({
  status: 'exited' as const,
  exitCode,
  signal: undefined,
  durationMs: 1,
  stdout,
  stderr: '',
  stdoutTruncated: false,
  stderrTruncated: false,
})

describe('native run project resolver', () => {
  it('captures the canonical project identity, exact HEAD, and source branch', async () => {
    const project = {
      projectId: 'project-api',
      name: 'API',
      repositoryPath: '/workspace/api',
      availability: 'AVAILABLE' as const,
      createdAt: '2026-08-23T00:00:00.000Z',
      updatedAt: '2026-08-23T00:00:00.000Z',
    }
    const run = vi
      .fn<ProcessRunner['run']>()
      .mockResolvedValueOnce(exited(`${'a'.repeat(40)}\n`))
      .mockResolvedValueOnce(exited('main\n'))
    const resolveProject = createNativeRunProjectResolver({
      projects: { requireAvailable: vi.fn(async () => project) },
      processRunner: { run },
    })

    await expect(resolveProject('project-api')).resolves.toEqual({
      projectId: 'project-api',
      name: 'API',
      repositoryPath: '/workspace/api',
      baseSha: 'a'.repeat(40),
      sourceBranch: 'main',
    })
    expect(run).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        executable: 'git',
        arguments: ['-C', '/workspace/api', 'rev-parse', '--verify', 'HEAD'],
        cwd: '/workspace/api',
      }),
    )
  })

  it('accepts detached HEAD but rejects a repository whose HEAD cannot be resolved', async () => {
    const project = {
      projectId: 'project-api',
      name: 'API',
      repositoryPath: '/workspace/api',
      availability: 'AVAILABLE' as const,
      createdAt: '2026-08-23T00:00:00.000Z',
      updatedAt: '2026-08-23T00:00:00.000Z',
    }
    const detachedRun = vi
      .fn<ProcessRunner['run']>()
      .mockResolvedValueOnce(exited(`${'b'.repeat(40)}\n`))
      .mockResolvedValueOnce(exited('', 1))
    const detached = createNativeRunProjectResolver({
      projects: { requireAvailable: vi.fn(async () => project) },
      processRunner: { run: detachedRun },
    })
    await expect(detached('project-api')).resolves.toMatchObject({ sourceBranch: null })

    const invalid = createNativeRunProjectResolver({
      projects: { requireAvailable: vi.fn(async () => project) },
      processRunner: { run: vi.fn(async () => exited('', 1)) },
    })
    await expect(invalid('project-api')).rejects.toThrow('Project HEAD could not be resolved')
  })
})
