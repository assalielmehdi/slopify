import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createGondolinAgentSandboxFactory } from '../../src/index.js'

const roots: string[] = []
const glabHostPath = process.env.SLOPIFY_GUEST_GLAB_PATH

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Gondolin real VM integration', () => {
  it.runIf(process.env.SLOPIFY_GONDOLIN_INTEGRATION === '1' && glabHostPath !== undefined)(
    'provides an empty private workspace without host mounts',
    async () => {
      const sandbox = await createGondolinAgentSandboxFactory({ glabHostPath }).create({
        executionId: 'integration-empty-workspace',
        worktrees: [],
        skills: [],
        connectors: [],
      })
      try {
        const bash = sandbox.tools.find(({ name }) => name === 'bash')
        const result = await bash?.execute(
          'empty-workspace-proof',
          { command: 'pwd; test -d /workspace' },
          new AbortController().signal,
          () => undefined,
          {},
        )

        expect(result).toMatchObject({
          content: [{ type: 'text', text: expect.stringContaining('/workspace') }],
        })
      } finally {
        await sandbox.close()
      }
    },
    120_000,
  )

  it.runIf(process.env.SLOPIFY_GONDOLIN_INTEGRATION === '1' && glabHostPath !== undefined)(
    'provides glab with connector-scoped placeholder authentication',
    async () => {
      const sandbox = await createGondolinAgentSandboxFactory({ glabHostPath }).create({
        executionId: 'integration-glab',
        worktrees: [],
        skills: [],
        connectors: [
          {
            connectionId: 'gitlab-default',
            type: 'gitlab',
            authority: 'GitLab API access',
            secret: 'glpat-integration-secret',
            allowedHosts: ['gitlab.com'],
          },
        ],
      })
      try {
        const bash = sandbox.tools.find(({ name }) => name === 'bash')
        const result = await bash?.execute(
          'glab-proof',
          {
            command:
              'glab --version; test "$GITLAB_HOST" = gitlab.com; test -n "$GITLAB_TOKEN"; test "$GITLAB_TOKEN" != glpat-integration-secret',
          },
          new AbortController().signal,
          () => undefined,
          {},
        )

        expect(result).toMatchObject({
          content: [{ type: 'text', text: expect.stringContaining('glab 1.114.0') }],
        })
      } finally {
        await sandbox.close()
      }
    },
    120_000,
  )

  it.runIf(process.env.SLOPIFY_GONDOLIN_INTEGRATION === '1' && glabHostPath !== undefined)(
    'isolates tool execution in a VM with writable worktrees and read-only skills',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'slopify-gondolin-integration-'))
      roots.push(root)
      const worktree = join(root, 'worktree')
      const skill = join(root, 'skill')
      await mkdir(worktree)
      await mkdir(skill)
      await writeFile(join(skill, 'SKILL.md'), 'immutable instructions\n')

      const sandbox = await createGondolinAgentSandboxFactory({ glabHostPath }).create({
        executionId: 'integration-execution',
        worktrees: [{ repositoryId: 'api', hostPath: worktree }],
        skills: [
          {
            skillId: 'proof-skill',
            name: 'proof-skill',
            description: 'Integration test skill',
            hostPath: skill,
          },
        ],
        connectors: [],
      })
      try {
        const tools = new Map(sandbox.tools.map((tool) => [tool.name, tool]))
        const signal = new AbortController().signal
        await tools
          .get('write')
          ?.execute(
            'write-proof',
            { path: '/workspace/api/from-write.txt', content: 'written through Gondolin\n' },
            signal,
          )
        await tools.get('bash')?.execute(
          'bash-proof',
          {
            command:
              "printf 'written by guest\\n' > /workspace/api/from-bash.txt; if printf 'mutated\\n' > /skills/proof-skill/SKILL.md 2>/dev/null; then exit 9; fi",
          },
          signal,
          () => undefined,
          {},
        )

        await expect(readFile(join(worktree, 'from-write.txt'), 'utf8')).resolves.toBe(
          'written through Gondolin\n',
        )
        await expect(readFile(join(worktree, 'from-bash.txt'), 'utf8')).resolves.toBe(
          'written by guest\n',
        )
        await expect(readFile(join(skill, 'SKILL.md'), 'utf8')).resolves.toBe(
          'immutable instructions\n',
        )
      } finally {
        await sandbox.close()
      }
    },
    120_000,
  )
})
