import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface RepositoryFixture {
  readonly root: string
  cleanup(): Promise<void>
}

const git = async (cwd: string, arguments_: readonly string[]): Promise<void> => {
  await execFileAsync('git', arguments_, { cwd })
}

const makeWritable = async (path: string): Promise<void> => {
  const metadata = await stat(path)
  await chmod(path, metadata.isDirectory() ? 0o777 : 0o666)
  if (!metadata.isDirectory()) return

  for (const entry of await readdir(path)) await makeWritable(join(path, entry))
}

export const createRepositoryFixture = async (): Promise<RepositoryFixture> => {
  const root = await mkdtemp(join(tmpdir(), 'slopify-container-'))
  const remotePath = join(root, 'remote.git')
  const repositoryPath = join(root, 'repository')
  const worktreeParent = join(root, 'worktrees')

  await mkdir(remotePath)
  await mkdir(repositoryPath)
  await mkdir(worktreeParent)
  await git(remotePath, ['init', '--bare', '--initial-branch=main'])
  await git(repositoryPath, ['init', '--initial-branch=main'])
  await git(repositoryPath, ['config', 'user.email', 'container-acceptance@example.invalid'])
  await git(repositoryPath, ['config', 'user.name', 'Container Acceptance'])
  await writeFile(join(repositoryPath, 'README.md'), '# Container acceptance fixture\n')
  await git(repositoryPath, ['add', 'README.md'])
  await git(repositoryPath, ['commit', '-m', 'fixture: initialize repository'])
  await git(repositoryPath, ['remote', 'add', 'origin', '../remote.git'])
  await git(repositoryPath, ['push', '--set-upstream', 'origin', 'main'])
  await makeWritable(root)

  return {
    root,
    async cleanup() {
      await rm(root, { force: true, recursive: true })
    },
  }
}
