import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createFilesystemRunArtifactDirectory, resolveSlopifyPaths } from '../../src/index.js'

const directories: string[] = []

const fixture = () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'slopify-run-artifacts-')))
  directories.push(home)
  const paths = resolveSlopifyPaths({ environment: { SLOPIFY_HOME: home } })
  const runPaths = paths.run('release-review', 'run-01')
  mkdirSync(runPaths.artifactsDirectory, { recursive: true })
  return {
    artifacts: createFilesystemRunArtifactDirectory({ paths }),
    runPaths,
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('filesystem run artifact directory', () => {
  it('returns the canonical shared artifact directory for a run', async () => {
    const { artifacts, runPaths } = fixture()

    await expect(artifacts.ensure({ workflowId: 'release-review', runId: 'run-01' })).resolves.toBe(
      runPaths.artifactsDirectory,
    )
  })

  it('rejects a symbolic-link substitution', async () => {
    const { artifacts, runPaths } = fixture()
    const outside = mkdtempSync(join(tmpdir(), 'slopify-run-artifacts-outside-'))
    directories.push(outside)
    rmSync(runPaths.artifactsDirectory, { recursive: true })
    symlinkSync(outside, runPaths.artifactsDirectory)

    await expect(
      artifacts.ensure({ workflowId: 'release-review', runId: 'run-01' }),
    ).rejects.toThrow('Run artifacts directory must not be a symbolic link')
  })

  it('rejects a missing artifact directory instead of recreating it at launch', async () => {
    const { artifacts, runPaths } = fixture()
    rmSync(runPaths.artifactsDirectory, { recursive: true })

    await expect(
      artifacts.ensure({ workflowId: 'release-review', runId: 'run-01' }),
    ).rejects.toThrow()
  })
})
