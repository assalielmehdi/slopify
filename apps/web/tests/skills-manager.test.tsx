// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SkillsManager } from '../components/skills/skills-manager'

afterEach(cleanup)

const skill = {
  skillId: 'gitlab-review',
  name: 'gitlab-review',
  description: 'Review GitLab changes.',
  digest: 'a'.repeat(64),
  modifiedAt: '2026-08-20T00:00:00.000Z',
  valid: true,
  issues: [],
  files: [{ path: 'SKILL.md', content: 'Original instructions', size: 21 }],
} as const

describe('SkillsManager', () => {
  it('refreshes filesystem skills and saves a complete digest-guarded update', async () => {
    const updateSkill = vi.fn(async () => ({
      ...skill,
      digest: 'b'.repeat(64),
      files: [{ ...skill.files[0], content: 'Updated instructions' }],
    }))
    render(
      <SkillsManager
        client={{
          listSkills: vi.fn(async () => [skill]),
          createSkill: vi.fn(),
          updateSkill,
          deleteSkill: vi.fn(),
        }}
      />,
    )

    expect((await screen.findAllByText('gitlab-review')).length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('Raw skill file'), {
      target: { value: 'Updated instructions' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save file' }))

    await waitFor(() =>
      expect(updateSkill).toHaveBeenCalledWith('gitlab-review', {
        expectedDigest: 'a'.repeat(64),
        files: { 'SKILL.md': 'Updated instructions' },
      }),
    )
  })
})
