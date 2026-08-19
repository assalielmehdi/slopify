import { describe, expect, it } from 'vitest'

import { buildFetchTargetArguments, renderSourceBranch, resolveWorktreePath } from '../src/index.js'

describe('Git workspace command inputs', () => {
  it('builds an explicit remote-tracking refspec without checkout mutation flags', () => {
    expect(buildFetchTargetArguments('/repos/api', 'origin', 'main')).toEqual([
      '-C',
      '/repos/api',
      'fetch',
      '--no-tags',
      'origin',
      '+refs/heads/main:refs/remotes/origin/main',
    ])
  })

  it('normalizes task identity and uses the UUID portion as the run short ID', () => {
    expect(
      renderSourceBranch(
        'ai/{task}-{run}',
        'PROJ 42 / Unsafe',
        'run-12345678-abcd-4000-8000-123456789abc',
      ),
    ).toBe('ai/proj-42-unsafe-12345678')
  })

  it('places every repository beneath its run-scoped worktree root', () => {
    expect(resolveWorktreePath('/worktrees', 'run-01', 'api')).toBe('/worktrees/run-01/api')
  })
})
