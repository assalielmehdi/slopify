import type { PermissionProfile } from '@loop/workflow-model'
import { describe, expect, it } from 'vitest'

import { AGENT_TOOL_PROFILES, getAgentToolProfile } from '../src/index.js'

describe('Pi tool profiles', () => {
  it('exposes only inspection and completion tools in read-only executions', () => {
    expect(getAgentToolProfile('read-only')).toEqual([
      'read',
      'grep',
      'find',
      'ls',
      'complete_node',
    ])
  })

  it('adds only the approved mutation tools in workspace-write executions', () => {
    expect(getAgentToolProfile('workspace-write')).toEqual([
      'read',
      'bash',
      'edit',
      'write',
      'grep',
      'find',
      'ls',
      'complete_node',
    ])
  })

  it('keeps the profile table and returned allowlists immutable', () => {
    expect(Object.isFrozen(AGENT_TOOL_PROFILES)).toBe(true)
    expect(Object.isFrozen(getAgentToolProfile('read-only'))).toBe(true)
    const tools = getAgentToolProfile('read-only') as string[]
    expect(() => {
      tools.push('bash')
    }).toThrow()
    expect(getAgentToolProfile('read-only')).not.toContain('bash')
  })

  it('rejects an unknown profile instead of falling back to broader tools', () => {
    expect(() => getAgentToolProfile('admin' as PermissionProfile)).toThrow()
  })
})
