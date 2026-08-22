import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createGondolinAgentSandboxFactory, type AgentSandboxVm } from '../src/index.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const createHostTree = async () => {
  const root = await mkdtemp(join(tmpdir(), 'slopify-sandbox-'))
  roots.push(root)
  const worktree = join(root, 'worktree')
  const skill = join(root, 'skill')
  const tools = join(root, 'tools')
  await mkdir(worktree)
  await mkdir(skill)
  await mkdir(tools)
  await writeFile(join(skill, 'SKILL.md'), 'instructions')
  const glab = join(tools, 'glab')
  await writeFile(glab, '#!/bin/sh\necho glab\n')
  await chmod(glab, 0o555)
  return { root, worktree, skill, tools, glab }
}

const vmFixture = () => {
  const fs = {
    access: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    readFile: vi.fn(async () => Buffer.from('guest file')),
    writeFile: vi.fn(async () => undefined),
  }
  const output = async function* () {
    yield { stream: 'stdout' as const, data: Buffer.from('ok'), text: 'ok' }
  }
  const exec = vi.fn(() => ({
    output,
    then: (resolve: (value: { exitCode: number }) => unknown) =>
      Promise.resolve(resolve({ exitCode: 0 })),
  }))
  const vm: AgentSandboxVm = {
    id: crypto.randomUUID(),
    fs,
    exec,
    close: vi.fn(async () => undefined),
  }
  return { fs, exec, vm }
}

describe('Gondolin agent sandbox', () => {
  it('creates an isolated VM without host mounts for a repository-free agent', async () => {
    const host = await createHostTree()
    const fixture = vmFixture()
    const createVm = vi.fn(async () => fixture.vm)

    const sandbox = await createGondolinAgentSandboxFactory({
      createVm,
      glabHostPath: host.glab,
    }).create({
      executionId: 'execution-01',
      worktrees: [],
      skills: [],
      connectors: [],
    })

    expect(Object.keys(createVm.mock.calls[0]?.[0].vfs?.mounts ?? {})).toEqual([
      '/workspace',
      '/opt/slopify/bin',
    ])
    expect(createVm.mock.calls[0]?.[0].env).not.toHaveProperty('GITLAB_TOKEN')
    await sandbox.close()
  })

  it('mounts only this execution worktrees and skills with connector-scoped policy', async () => {
    const host = await createHostTree()
    const fixture = vmFixture()
    const createVm = vi.fn(async () => fixture.vm)
    const factory = createGondolinAgentSandboxFactory({ createVm, glabHostPath: host.glab })

    const sandbox = await factory.create({
      executionId: 'execution-01',
      worktrees: [{ repositoryId: 'api', hostPath: host.worktree }],
      skills: [
        {
          skillId: 'gitlab-delivery',
          name: 'gitlab-delivery',
          description: 'Use GitLab safely',
          hostPath: host.skill,
        },
      ],
      connectors: [
        {
          connectionId: 'gitlab-primary',
          type: 'gitlab',
          authority: 'GitLab read/write',
          secret: 'glpat-secret',
          allowedHosts: ['gitlab.com'],
        },
      ],
    })

    const options = createVm.mock.calls[0]?.[0]
    expect(Object.keys(options?.vfs?.mounts ?? {})).toEqual([
      '/workspace/api',
      '/skills/gitlab-delivery',
      '/opt/slopify/bin',
    ])
    expect(options?.vfs?.mounts?.['/workspace/api']?.readonly).toBe(false)
    expect(options?.vfs?.mounts?.['/skills/gitlab-delivery']?.readonly).toBe(true)
    expect(options?.env).toEqual(
      expect.objectContaining({
        GITLAB_HOST: 'gitlab.com',
        GITLAB_TOKEN: expect.any(String),
        PATH: expect.stringContaining('/opt/slopify/bin'),
      }),
    )
    expect(options?.env).not.toHaveProperty('SLOPIFY_GITLAB')
    expect(JSON.stringify(options)).not.toContain('glpat-secret')
    expect(sandbox.skills).toEqual([
      expect.objectContaining({
        name: 'gitlab-delivery',
        filePath: '/skills/gitlab-delivery/SKILL.md',
      }),
    ])
    await sandbox.close()
    expect(fixture.vm.close).toHaveBeenCalledOnce()
  })

  it('does not synthesize a hidden skill for a granted connector', async () => {
    const host = await createHostTree()
    const fixture = vmFixture()
    const createVm = vi.fn(async () => fixture.vm)

    const sandbox = await createGondolinAgentSandboxFactory({
      createVm,
      glabHostPath: host.glab,
    }).create({
      executionId: 'execution-01',
      worktrees: [],
      skills: [],
      connectors: [
        {
          connectionId: 'clickup-default',
          type: 'clickup',
          authority: 'ClickUp API access',
          secret: 'clickup-secret',
          allowedHosts: ['api.clickup.com'],
        },
      ],
    })

    const options = createVm.mock.calls[0]?.[0]
    expect(Object.keys(options?.vfs?.mounts ?? {})).toEqual(['/workspace', '/opt/slopify/bin'])
    expect(JSON.stringify(options)).not.toContain('clickup-secret')
    expect(sandbox.skills).toEqual([])
  })

  it('routes read, write, edit, and bash through guest operations', async () => {
    const host = await createHostTree()
    const fixture = vmFixture()
    const sandbox = await createGondolinAgentSandboxFactory({
      createVm: async () => fixture.vm,
      glabHostPath: host.glab,
    }).create({
      executionId: 'execution-01',
      worktrees: [{ repositoryId: 'api', hostPath: host.worktree }],
      skills: [],
      connectors: [],
    })
    const tools = new Map(sandbox.tools.map((tool) => [tool.name, tool]))

    await tools
      .get('read')
      ?.execute('read-01', { path: '/workspace/api/README.md' }, new AbortController().signal)
    await tools
      .get('write')
      ?.execute(
        'write-01',
        { path: '/workspace/api/new.txt', content: 'new' },
        new AbortController().signal,
      )
    await tools
      .get('bash')
      ?.execute(
        'bash-01',
        { command: 'git status --short' },
        new AbortController().signal,
        () => undefined,
        {},
      )

    expect(fixture.fs.readFile).toHaveBeenCalledWith('/workspace/api/README.md')
    expect(fixture.fs.mkdir).toHaveBeenCalledWith('/workspace/api', { recursive: true })
    expect(fixture.fs.writeFile).toHaveBeenCalledWith('/workspace/api/new.txt', 'new')
    expect(fixture.exec).toHaveBeenCalledWith(
      'export PATH=/opt/slopify/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\ngit status --short',
      expect.not.objectContaining({ env: expect.anything() }),
    )
  })

  it('creates independently revocable VM instances for concurrent executions', async () => {
    const host = await createHostTree()
    const first = vmFixture()
    const second = vmFixture()
    const createVm = vi.fn().mockResolvedValueOnce(first.vm).mockResolvedValueOnce(second.vm)
    const factory = createGondolinAgentSandboxFactory({ createVm, glabHostPath: host.glab })
    const input = {
      worktrees: [{ repositoryId: 'api', hostPath: host.worktree }],
      skills: [],
      connectors: [],
    }
    const [left, right] = await Promise.all([
      factory.create({ ...input, executionId: 'execution-01' }),
      factory.create({ ...input, executionId: 'execution-02' }),
    ])

    expect(left.sandboxId).not.toBe(right.sandboxId)
    await left.close()
    expect(first.vm.close).toHaveBeenCalledOnce()
    expect(second.vm.close).not.toHaveBeenCalled()
    await right.close()
  })
})
