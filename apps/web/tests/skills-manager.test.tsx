// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SkillsManager } from '../components/skills/skills-manager'
import { toast } from '../components/ui/toast'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const skill = {
  skillId: 'gitlab-review',
  name: 'gitlab-review',
  description: 'Review GitLab changes.',
  digest: 'a'.repeat(64),
  modifiedAt: '2026-08-20T00:00:00.000Z',
  valid: true,
  kind: 'user',
  issues: [],
  files: [
    {
      path: 'SKILL.md',
      content:
        '---\nname: gitlab-review\ndescription: Review GitLab changes.\n---\n\nOriginal instructions\n',
      size: 92,
    },
  ],
} as const

const createClient = (overrides: Record<string, unknown> = {}) => ({
  listSkills: vi.fn(async () => [skill]),
  createSkill: vi.fn(async () => skill),
  updateSkill: vi.fn(async () => skill),
  deleteSkill: vi.fn(async () => undefined),
  ...overrides,
})

describe('SkillsManager', () => {
  it('shows built-in connector skills as read-only', async () => {
    const builtIn = {
      ...skill,
      displayName: 'gitlab-connector',
      kind: 'connector' as const,
      readOnly: true,
    }
    const client = createClient({ listSkills: vi.fn(async () => [builtIn]) })
    render(<SkillsManager client={client} />)

    const tile = await screen.findByRole('button', { name: /gitlab-connector/i })
    const tileClasses = tile.className.split(/\s+/)
    expect(tileClasses).toContain('h-auto')
    expect(tileClasses).toContain('min-h-[140px]')
    expect(tileClasses).not.toContain('h-[140px]')
    expect(within(tile).getByText('gitlab-connector')).toBeTruthy()
    expect(within(tile).getByText('Built-in')).toBeTruthy()
    expect(within(tile).getByText('Connector')).toBeTruthy()
    const tags = tile.querySelector('[data-slot="catalog-card-tags"]')
    expect(tags?.className).toContain('justify-end')
    expect(tags?.className).toContain('pt-2')
    fireEvent.click(tile)

    expect((screen.getByLabelText('Skill Markdown') as HTMLTextAreaElement).readOnly).toBe(true)
    expect(screen.queryByRole('button', { name: 'Delete skill' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    expect(
      screen.queryByText(/replace or remove this skill directly from the filesystem/i),
    ).toBeNull()
  })

  it('orders built-in skills before custom skills', async () => {
    render(
      <SkillsManager
        client={createClient({
          listSkills: vi.fn(async () => [
            skill,
            {
              ...skill,
              skillId: 'built-in',
              name: 'built-in',
              displayName: 'Built in',
              kind: 'built-in' as const,
              readOnly: true,
            },
          ]),
        })}
      />,
    )

    const tiles = await screen.findAllByRole('button', { name: /Review GitLab changes/i })
    expect(
      tiles.map((tile) => within(tile).getByText(/Built in|gitlab-review/).textContent),
    ).toEqual(['Built in', 'gitlab-review'])
  })

  it('shows only the built-in tag for non-connector built-ins and no tags for user skills', async () => {
    render(
      <SkillsManager
        client={createClient({
          listSkills: vi.fn(async () => [
            skill,
            {
              ...skill,
              skillId: 'utility',
              name: 'utility',
              kind: 'built-in' as const,
              readOnly: true,
            },
          ]),
        })}
      />,
    )

    const utility = await screen.findByRole('button', { name: /utility/i })
    const user = screen.getByRole('button', { name: /gitlab-review/i })
    expect(within(utility).getByText('Built-in')).toBeTruthy()
    expect(within(utility).queryByText('Connector')).toBeNull()
    expect(user.querySelector('[data-slot="catalog-card-tags"]')?.textContent).toBe('')
  })

  it('opens a linked skill after confirming it still exists on the filesystem', async () => {
    render(<SkillsManager initialSkillId="gitlab-review" client={createClient()} />)

    expect(await screen.findByRole('dialog', { name: 'gitlab-review' })).toBeTruthy()
  })

  it('shows card skeletons while filesystem skills are loading', async () => {
    let resolve: ((value: readonly [typeof skill]) => void) | undefined
    const listSkills = vi.fn(
      () =>
        new Promise<readonly [typeof skill]>((next) => {
          resolve = next
        }),
    )
    render(<SkillsManager client={createClient({ listSkills })} />)

    expect(screen.getByRole('status', { name: 'Loading skills' })).toBeTruthy()
    expect(screen.getAllByTestId('catalog-card-skeleton')).toHaveLength(3)
    expect(screen.queryByText('No skills yet')).toBeNull()

    await act(async () => resolve?.([skill]))
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading skills' })).toBeNull())
  })

  it('refreshes filesystem skills and saves a complete digest-guarded update', async () => {
    const addToast = vi.spyOn(toast, 'add')
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

    fireEvent.click(await screen.findByRole('button', { name: /gitlab-review/i }))
    await screen.findByRole('dialog', { name: 'gitlab-review' })
    const saveChanges = screen.getByRole('button', { name: 'Save changes' })
    expect((saveChanges as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Skill Markdown'), {
      target: { value: 'Updated instructions' },
    })
    expect((saveChanges as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(saveChanges)

    await waitFor(() =>
      expect(updateSkill).toHaveBeenCalledWith('gitlab-review', {
        expectedDigest: 'a'.repeat(64),
        files: { 'SKILL.md': 'Updated instructions' },
      }),
    )
    expect(addToast).toHaveBeenCalledWith({
      title: 'Skill saved',
      description: 'gitlab-review was saved to the filesystem.',
      type: 'success',
    })
    await waitFor(() => expect((saveChanges as HTMLButtonElement).disabled).toBe(true))
  })

  it('creates a skill from complete Markdown in the shared floating panel', async () => {
    const markdown =
      '---\nname: source-research\ndescription: Finds primary sources.\n---\n\nSearch before answering.\n'
    const created = {
      ...skill,
      skillId: 'source-research',
      name: 'source-research',
      description: 'Finds primary sources.',
      files: [{ path: 'SKILL.md', content: markdown, size: markdown.length }],
    }
    const createSkill = vi.fn(async () => created)
    render(
      <SkillsManager
        client={{
          listSkills: vi.fn(async () => [skill]),
          createSkill,
          updateSkill: vi.fn(),
          deleteSkill: vi.fn(),
        }}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Add skill' }))
    expect(await screen.findByRole('dialog', { name: 'Add skill' })).toBeTruthy()
    expect(screen.queryByLabelText('Skill ID')).toBeNull()
    expect(screen.queryByLabelText('Description')).toBeNull()
    const markdownEditor = screen.getByLabelText('Skill Markdown')
    expect(markdownEditor.className).toContain('max-h-[28rem]')
    fireEvent.change(markdownEditor, { target: { value: markdown } })
    fireEvent.click(screen.getByRole('button', { name: 'Create skill' }))

    await waitFor(() => expect(createSkill).toHaveBeenCalledWith({ markdown }))
    expect(await screen.findByRole('button', { name: /source-research/i })).toBeTruthy()
  })

  it('uses compact toolbar actions and omits redundant filesystem metadata', async () => {
    render(<SkillsManager client={createClient()} />)

    const refresh = screen.getByRole('button', { name: 'Refresh from filesystem' })
    const search = screen.getByRole('search')
    const add = screen.getByRole('button', { name: 'Add skill' })
    expect(screen.getByRole('region', { name: 'Skills' }).className).toContain('px-6')
    expect(refresh.textContent).toBe('')
    expect(refresh.className).toContain('border-0')
    expect(search.className).toContain('[--resize-dur:var(--duration-very-slow)]')
    expect(add.className).toContain('t-resize')
    expect(add.className).toContain('w-8')
    expect(add.className).toContain('hover:w-max')
    expect(add.className).not.toMatch(/hover:w-\d/)
    expect(add.className).toContain('[--resize-dur:var(--duration-very-slow)]')

    const tile = await screen.findByRole('button', { name: /gitlab-review/i })
    expect(within(tile).queryByText('Available')).toBeNull()
    expect(within(tile).queryByText('1 file')).toBeNull()

    fireEvent.click(tile)
    const panel = within(await screen.findByRole('dialog', { name: 'gitlab-review' }))
    expect(panel.queryByText('Local skill')).toBeNull()
    expect(panel.queryByText('Available')).toBeNull()
    expect(panel.queryByText(skill.digest.slice(0, 12))).toBeNull()
    expect(panel.getByLabelText('Skill Markdown').className).toContain('max-h-[28rem]')
    expect(screen.getByRole('button', { name: 'Delete skill' })).toBeTruthy()
  })

  it('filters skills while typing in the expanding search control', async () => {
    const sourceSkill = {
      ...skill,
      skillId: 'source-research',
      name: 'source-research',
      description: 'Finds primary sources.',
    }
    render(
      <SkillsManager
        client={createClient({ listSkills: vi.fn(async () => [skill, sourceSkill]) })}
      />,
    )

    await screen.findByRole('button', { name: /source-research/i })
    fireEvent.click(screen.getByRole('button', { name: 'Open skill search' }))
    const search = screen.getByRole('searchbox', { name: 'Search skills' })
    expect(document.activeElement).toBe(search)
    fireEvent.change(search, { target: { value: 'source' } })

    expect(screen.queryByRole('button', { name: /gitlab-review/i })).toBeNull()
    expect(screen.getByRole('button', { name: /source-research/i })).toBeTruthy()
  })

  it('requires the exact skill name before deleting and offers undo', async () => {
    const addToast = vi.spyOn(toast, 'add')
    const closeToast = vi.spyOn(toast, 'close')
    const deleteSkill = vi.fn(async () => undefined)
    const createSkill = vi.fn(async () => skill)
    render(<SkillsManager client={createClient({ createSkill, deleteSkill })} />)

    fireEvent.click(await screen.findByRole('button', { name: /gitlab-review/i }))
    await screen.findByRole('dialog', { name: 'gitlab-review' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete skill' }))
    expect(deleteSkill).not.toHaveBeenCalled()
    const confirmationName = screen.getByPlaceholderText('Enter the skill name')
    const confirmation = screen.getByRole('button', { name: 'Confirm' })
    const saveChanges = screen.getByRole('button', { name: 'Save changes' })
    const confirmationSlot = confirmationName.closest('[data-testid="skill-delete-confirmation"]')
    expect(confirmationSlot?.className).toContain('w-56')
    expect(confirmationSlot?.nextElementSibling).toBe(confirmation)
    expect(confirmation.nextElementSibling).toBe(saveChanges)
    expect(document.activeElement).toBe(confirmationName)
    expect((confirmation as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(confirmationName, { target: { value: 'another-skill' } })
    fireEvent.click(confirmation)
    expect(deleteSkill).not.toHaveBeenCalled()

    fireEvent.change(confirmationName, { target: { value: 'gitlab-review' } })
    fireEvent.click(confirmation)

    await waitFor(() => expect(deleteSkill).toHaveBeenCalledWith('gitlab-review', 'a'.repeat(64)))
    expect(screen.queryByRole('button', { name: /gitlab-review/i })).toBeNull()
    const deletionToast = addToast.mock.calls.find(
      ([options]) => options.title === 'Skill deleted',
    )?.[0]
    expect(deletionToast).toMatchObject({
      title: 'Skill deleted',
      description: 'gitlab-review was removed from the filesystem.',
      type: 'info',
      actionProps: { children: 'Undo' },
    })

    await act(async () => {
      await deletionToast?.actionProps?.onClick?.({ preventDefault: vi.fn() } as never)
    })
    deletionToast?.onRemove?.()

    await waitFor(() =>
      expect(createSkill).toHaveBeenCalledWith({ markdown: skill.files[0].content }),
    )
    expect(closeToast).toHaveBeenCalledWith(expect.any(String))
    expect(await screen.findByRole('button', { name: /gitlab-review/i })).toBeTruthy()
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Skill restored', type: 'success' }),
    )
  })
})
