import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const GUEST_GLAB_VERSION = '1.114.0'

const releases = Object.freeze({
  arm64: {
    archiveArchitecture: 'arm64',
    sha256: 'd34d7ddb96ce5e5f3423d7e8053cb14c36bd93984e4b96320f7e20a341b83498',
  },
  x64: {
    archiveArchitecture: 'amd64',
    sha256: '00e892a80d586a1e8b8fdc035321923db99dce0caa3b0c4fd72c5337ffdb1c48',
  },
})

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export const ensureGuestGlabBinary = async (input: {
  readonly root: string
  readonly sourcePath?: string
  readonly architecture?: string
  readonly fetch?: typeof globalThis.fetch
}): Promise<string> => {
  const architecture = input.architecture ?? process.arch
  const release = releases[architecture as keyof typeof releases]
  if (release === undefined) throw new Error(`Unsupported glab guest architecture: ${architecture}`)

  const target = join(input.root, `glab-${GUEST_GLAB_VERSION}-${architecture}`, 'glab')
  if (await exists(target)) return target

  const staging = join(input.root, `.glab-${randomUUID()}`)
  await mkdir(staging, { recursive: true })
  try {
    const stagedBinary = join(staging, 'glab')
    if (input.sourcePath !== undefined) {
      await copyFile(input.sourcePath, stagedBinary)
    } else {
      const archive = `glab_${GUEST_GLAB_VERSION}_linux_${release.archiveArchitecture}.tar.gz`
      const response = await (input.fetch ?? globalThis.fetch)(
        `https://gitlab.com/gitlab-org/cli/-/releases/v${GUEST_GLAB_VERSION}/downloads/${archive}`,
        { signal: AbortSignal.timeout(120_000) },
      )
      if (!response.ok) throw new Error(`Unable to download glab: HTTP ${response.status}`)
      const archivePath = join(staging, archive)
      await writeFile(archivePath, Buffer.from(await response.arrayBuffer()))
      const digest = createHash('sha256')
        .update(await readFile(archivePath))
        .digest('hex')
      if (digest !== release.sha256) throw new Error('Downloaded glab checksum does not match')
      await execFileAsync('tar', [
        '--extract',
        '--gzip',
        '--file',
        archivePath,
        '--directory',
        staging,
      ])
      await rename(join(staging, 'bin', 'glab'), stagedBinary)
    }
    await chmod(stagedBinary, 0o555)
    await mkdir(dirname(target), { recursive: true })
    try {
      await rename(stagedBinary, target)
    } catch (cause) {
      if (!(await exists(target))) throw cause
    }
    return target
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
