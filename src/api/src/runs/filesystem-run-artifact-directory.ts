import { lstat, realpath } from 'node:fs/promises'
import { join } from 'node:path'

import type { SlopifyPaths } from '../filesystem/slopify-home.js'

export interface RunArtifactLocator {
  readonly workflowId: string
  readonly runId: string
}

export interface FilesystemRunArtifactDirectory {
  ensure(locator: RunArtifactLocator): Promise<string>
}

const requireCanonicalDirectory = async (path: string, label: string): Promise<string> => {
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link`)
  if (!metadata.isDirectory()) throw new Error(`${label} must be a directory`)
  const canonicalPath = await realpath(path)
  if (canonicalPath !== path) throw new Error(`${label} path contains a symbolic link`)
  return canonicalPath
}

export const createFilesystemRunArtifactDirectory = (
  options: Readonly<{ paths: Pick<SlopifyPaths, 'run'> }>,
): FilesystemRunArtifactDirectory => ({
  async ensure(locator) {
    const paths = options.paths.run(locator.workflowId, locator.runId)
    const runDirectory = await requireCanonicalDirectory(paths.directory, 'Run directory')
    const artifactsDirectory = await requireCanonicalDirectory(
      paths.artifactsDirectory,
      'Run artifacts directory',
    )
    if (artifactsDirectory !== join(runDirectory, 'artifacts')) {
      throw new Error('Run artifacts directory is not deterministic')
    }
    return artifactsDirectory
  },
})
