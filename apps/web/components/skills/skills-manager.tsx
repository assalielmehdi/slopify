'use client'

import { BookOpenIcon, RefreshCwIcon, Trash2Icon, XIcon } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CatalogToolbar } from '@/components/settings/catalog-toolbar'
import { CatalogCardTags } from '@/components/settings/catalog-card-tags'
import { CatalogCardSkeleton } from '@/components/settings/catalog-card-skeleton'
import { createApiClient, type ApiClient, type SkillRecord } from '@/lib/api-client'
import { showUndoDeletionToast } from '@/lib/undo-deletion-toast'
import { cn } from '@/lib/utils'

const defaultClient = createApiClient()
type SkillsClient = Required<
  Pick<ApiClient, 'listSkills' | 'createSkill' | 'updateSkill' | 'deleteSkill'>
>
type PanelSelection = 'add' | string

const skillTemplate = `---
name: skill-name
description: Describe when an agent should use this skill.
---

# Instructions

Write the instructions the agent should follow.
`

function prefersReducedMotion() {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function SkillIcon() {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
      <BookOpenIcon aria-hidden="true" className="size-5" strokeWidth={1.8} />
    </span>
  )
}

function SkillStatus({ skill }: Readonly<{ skill: SkillRecord }>) {
  return (
    <>
      {skill.kind === 'built-in' || skill.kind === 'connector' ? (
        <Badge variant="secondary" className="shrink-0 font-normal">
          Built-in
        </Badge>
      ) : null}
      {skill.kind === 'connector' ? (
        <Badge variant="secondary" className="shrink-0 font-normal">
          Connector
        </Badge>
      ) : null}
      {skill.valid ? null : (
        <Badge variant="destructive" className="shrink-0 font-normal">
          Invalid
        </Badge>
      )}
    </>
  )
}

function SkillTile({ onSelect, skill }: Readonly<{ onSelect: () => void; skill: SkillRecord }>) {
  const description = skill.valid ? skill.description : skill.issues[0] || 'Invalid skill'
  const name = skill.displayName ?? skill.name
  return (
    <Button
      type="button"
      variant="ghost"
      aria-label={`${name}${skill.valid ? '' : ', Invalid'}. ${description}`}
      onClick={onSelect}
      className={cn(
        'h-auto min-h-[140px] w-full flex-col items-stretch justify-start gap-0 overflow-hidden rounded-lg border border-border bg-card p-0 text-left whitespace-normal shadow-[var(--shadow-raised)] transition-[background-color,border-color,box-shadow,opacity] duration-150 hover:border-input hover:bg-accent/45 hover:shadow-[var(--shadow-raised-hover)] focus-visible:border-input',
        !skill.valid && 'bg-muted/20 opacity-70',
      )}
    >
      <span className="flex min-h-0 flex-1 items-start gap-3.5 p-4">
        <SkillIcon />
        <span className="flex min-w-0 flex-1 self-stretch flex-col gap-1">
          <span className="truncate text-[14px]/5 font-semibold tracking-[-0.01em] text-foreground">
            {name}
          </span>
          <span className="line-clamp-2 text-[12px]/4 font-normal text-muted-foreground">
            {description}
          </span>
          <CatalogCardTags>
            <SkillStatus skill={skill} />
          </CatalogCardTags>
        </span>
      </span>
    </Button>
  )
}

export function SkillsManager({
  client = defaultClient as SkillsClient,
  initialSkillId,
}: Readonly<{ client?: SkillsClient; initialSkillId?: string }>) {
  const [skills, setSkills] = useState<readonly SkillRecord[]>([])
  const [selection, setSelection] = useState<PanelSelection>()
  const [closingSkill, setClosingSkill] = useState<SkillRecord>()
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [createDraft, setCreateDraft] = useState(skillTemplate)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [confirmationName, setConfirmationName] = useState('')
  const [error, setError] = useState<string>()
  const panelRef = useRef<HTMLDivElement>(null)
  const panelOpenFrameRef = useRef<number | undefined>(undefined)
  const confirmationInputRef = useRef<HTMLInputElement>(null)
  const initialSelectionAppliedRef = useRef(false)

  const selected = useMemo(
    () =>
      skills.find(({ skillId }) => skillId === selection) ??
      (closingSkill?.skillId === selection ? closingSkill : undefined),
    [closingSkill, selection, skills],
  )
  const selectedMarkdown =
    selected?.files.find(({ path }) => path === 'SKILL.md')?.content ??
    selected?.files[0]?.content ??
    ''
  const isDirty = selected !== undefined && !selected.readOnly && draft !== selectedMarkdown

  const closePanel = useCallback(() => {
    if (panelOpenFrameRef.current !== undefined) {
      window.cancelAnimationFrame(panelOpenFrameRef.current)
      panelOpenFrameRef.current = undefined
    }
    setIsPanelOpen(false)
    setConfirmingDelete(false)
    setConfirmationName('')
    if (prefersReducedMotion()) {
      setClosingSkill(undefined)
      setSelection(undefined)
    }
  }, [])

  const openPanel = useCallback((nextSelection: PanelSelection) => {
    if (panelOpenFrameRef.current !== undefined)
      window.cancelAnimationFrame(panelOpenFrameRef.current)
    setSelection(nextSelection)
    setError(undefined)
    setConfirmingDelete(false)
    setConfirmationName('')
    setClosingSkill(undefined)
    setIsPanelOpen(false)
    if (nextSelection === 'add') setCreateDraft(skillTemplate)

    if (prefersReducedMotion()) {
      setIsPanelOpen(true)
      panelOpenFrameRef.current = undefined
      return
    }

    panelOpenFrameRef.current = window.requestAnimationFrame(() => {
      panelOpenFrameRef.current = window.requestAnimationFrame(() => {
        setIsPanelOpen(true)
        panelOpenFrameRef.current = undefined
      })
    })
  }, [])

  const refresh = useCallback(
    async (initial = false) => {
      if (!initial) setRefreshing(true)
      setError(undefined)
      try {
        const next = await client.listSkills()
        setSkills(next)
        setSelection((current) => {
          if (
            current !== undefined &&
            current !== 'add' &&
            !next.some(({ skillId }) => skillId === current)
          ) {
            setIsPanelOpen(false)
            return undefined
          }
          return current
        })
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Skills could not be loaded.')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [client],
  )

  useEffect(() => {
    void refresh(true)
  }, [refresh])

  useEffect(() => {
    if (loading || initialSelectionAppliedRef.current) return
    initialSelectionAppliedRef.current = true
    if (initialSkillId !== undefined && skills.some(({ skillId }) => skillId === initialSkillId)) {
      openPanel(initialSkillId)
    }
  }, [initialSkillId, loading, openPanel, skills])

  useEffect(() => {
    return () => {
      if (panelOpenFrameRef.current !== undefined)
        window.cancelAnimationFrame(panelOpenFrameRef.current)
    }
  }, [])

  useEffect(() => {
    if (!isPanelOpen) return
    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (panelRef.current?.contains(event.target as Node)) return
      closePanel()
    }
    document.addEventListener('pointerdown', handleOutsidePointerDown)
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown)
  }, [closePanel, isPanelOpen])

  useEffect(() => {
    if (selected === undefined) return
    const file = selected.files.find(({ path }) => path === 'SKILL.md') ?? selected.files[0]
    if (file !== undefined) setDraft(file.content)
  }, [selected])

  useEffect(() => {
    if (confirmingDelete) confirmationInputRef.current?.focus()
  }, [confirmingDelete])

  const visibleSkills = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase()
    const filtered =
      query === ''
        ? skills
        : skills.filter(
            ({ name, displayName, description }) =>
              (displayName ?? name).toLocaleLowerCase().includes(query) ||
              description.toLocaleLowerCase().includes(query),
          )
    return [...filtered].sort(
      (left, right) =>
        Number(right.kind !== 'user') - Number(left.kind !== 'user') ||
        (left.displayName ?? left.name).localeCompare(right.displayName ?? right.name),
    )
  }, [searchQuery, skills])

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setError(undefined)
    try {
      const created = await client.createSkill({ markdown: createDraft })
      setSkills((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)))
      closePanel()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Skill could not be created.')
    } finally {
      setSaving(false)
    }
  }

  const save = async () => {
    if (selected === undefined || selected.readOnly || !isDirty) return
    setSaving(true)
    setError(undefined)
    try {
      const updated = await client.updateSkill(selected.skillId, {
        expectedDigest: selected.digest,
        files: { 'SKILL.md': draft },
      })
      setSkills((current) =>
        current.map((skill) => (skill.skillId === updated.skillId ? updated : skill)),
      )
      toast.add({
        title: 'Skill saved',
        description: `${updated.name} was saved to the filesystem.`,
        type: 'success',
      })
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `${cause.message} Refresh before retrying; the filesystem may have changed.`
          : 'Skill could not be saved.',
      )
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (selected === undefined || selected.readOnly) return
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    if (confirmationName !== selected.name) return
    setDeleting(true)
    setError(undefined)
    try {
      await client.deleteSkill(selected.skillId, selected.digest)
      setClosingSkill(selected)
      setSkills((current) => current.filter(({ skillId }) => skillId !== selected.skillId))
      closePanel()
      const markdown =
        selected.files.find(({ path }) => path === 'SKILL.md')?.content ??
        selected.files[0]?.content
      if (markdown !== undefined) {
        showUndoDeletionToast({
          receipt: { undoExpiresAt: new Date(Date.now() + 10_000).toISOString() },
          deletedTitle: 'Skill deleted',
          deletedDescription: `${selected.name} was removed from the filesystem.`,
          restoredTitle: 'Skill restored',
          restoredDescription: `${selected.name} is available again.`,
          async onUndo() {
            const restored = await client.createSkill({ markdown })
            setSkills((current) =>
              [...current.filter(({ skillId }) => skillId !== restored.skillId), restored].sort(
                (left, right) => left.name.localeCompare(right.name),
              ),
            )
          },
        })
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Skill could not be deleted.')
    } finally {
      setDeleting(false)
    }
  }

  const panelTitle = selection === 'add' ? 'Add skill' : (selected?.displayName ?? selected?.name)

  return (
    <section aria-label="Skills" className="w-full px-6 pt-6 pb-10 sm:pb-12">
      <CatalogToolbar
        singular="skill"
        plural="skills"
        query={searchQuery}
        onQueryChange={setSearchQuery}
        onAdd={() => openPanel('add')}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Refresh from filesystem"
                className="border-0"
                onClick={() => void refresh()}
                disabled={refreshing}
              />
            }
          >
            <RefreshCwIcon aria-hidden="true" className={cn(refreshing && 'animate-spin')} />
          </TooltipTrigger>
          <TooltipContent>Refresh from filesystem</TooltipContent>
        </Tooltip>
      </CatalogToolbar>

      {error === undefined ? null : (
        <Alert variant="destructive" className="mb-3">
          <AlertTitle>Skill unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <CatalogCardSkeleton label="skills" />
      ) : (
        <div
          data-testid="skill-grid"
          className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]"
        >
          {visibleSkills.map((skill) => (
            <SkillTile
              key={skill.skillId}
              skill={skill}
              onSelect={() => openPanel(skill.skillId)}
            />
          ))}
        </div>
      )}

      {loading ? null : skills.length === 0 && error === undefined ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
          <p className="text-[14px]/5 font-semibold">No skills yet</p>
          <p className="mt-1 text-[13px]/5 text-muted-foreground">
            Add a SKILL.md file to make its instructions available to workflow agents.
          </p>
        </div>
      ) : visibleSkills.length === 0 && error === undefined ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
          <p className="text-[14px]/5 font-semibold">No matching skills</p>
          <p className="mt-1 text-[13px]/5 text-muted-foreground">
            Try a different name or description.
          </p>
        </div>
      ) : null}

      {panelTitle === undefined ? null : (
        <div
          ref={panelRef}
          data-testid="skill-panel-shell"
          data-open={isPanelOpen}
          aria-hidden={!isPanelOpen}
          className="provider-floating-panel-shell fixed inset-y-3 right-3 left-3 z-30 w-auto sm:left-auto sm:w-[min(34rem,calc(100%-1.5rem))]"
          style={
            {
              '--panel-open-dur': '350ms',
              '--panel-close-dur': '350ms',
              '--panel-translate-y': '0px',
            } as CSSProperties
          }
          onTransitionEnd={(event) => {
            if (
              event.target === event.currentTarget &&
              event.propertyName === 'translate' &&
              !isPanelOpen
            ) {
              setClosingSkill(undefined)
              setSelection(undefined)
            }
          }}
        >
          <aside
            role="dialog"
            aria-modal="false"
            aria-labelledby="skill-panel-title"
            data-layout="floating"
            data-open={isPanelOpen}
            className="t-panel-slide flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-[var(--shadow-overlay)]"
          >
            <header className="relative shrink-0 border-b border-border p-6 pr-14">
              <div className="flex items-center gap-3">
                <SkillIcon />
                <div className="min-w-0">
                  <h2
                    id="skill-panel-title"
                    className="truncate text-[18px]/6 font-semibold tracking-[-0.01em]"
                  >
                    {panelTitle}
                  </h2>
                  {selection === 'add' ? (
                    <p className="text-[12px]/4 text-muted-foreground">
                      Create from a complete SKILL.md file
                    </p>
                  ) : null}
                </div>
                {selected === undefined || (selected.valid && !selected.readOnly) ? null : (
                  <div className="ml-auto">
                    <SkillStatus skill={selected} />
                  </div>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Close skill details"
                onClick={closePanel}
                className="absolute top-3 right-3"
              >
                <XIcon aria-hidden="true" />
              </Button>
            </header>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
              {selection === 'add' ? (
                <form className="grid content-start gap-4" onSubmit={(event) => void create(event)}>
                  <Field>
                    <FieldLabel htmlFor="new-skill-markdown">Skill Markdown</FieldLabel>
                    <Textarea
                      id="new-skill-markdown"
                      name="markdown"
                      className="min-h-[28rem] max-h-[28rem] resize-y overflow-y-auto bg-background font-mono text-sm/6"
                      value={createDraft}
                      onChange={(event) => setCreateDraft(event.currentTarget.value)}
                      spellCheck={false}
                      required
                    />
                    <FieldDescription>
                      Paste the complete file. The skill name and description come from its YAML
                      frontmatter.
                    </FieldDescription>
                  </Field>
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Creating…' : 'Create skill'}
                  </Button>
                </form>
              ) : selected === undefined ? null : (
                <>
                  {!selected.valid ? (
                    <Alert variant="destructive">
                      <AlertTitle>Invalid skill</AlertTitle>
                      <AlertDescription>{selected.issues.join(' ')}</AlertDescription>
                    </Alert>
                  ) : null}

                  <Field>
                    <FieldLabel htmlFor="selected-skill-file">Skill Markdown</FieldLabel>
                    <Textarea
                      id="selected-skill-file"
                      className="min-h-[28rem] max-h-[28rem] resize-y overflow-y-auto bg-background font-mono text-sm/6"
                      value={draft}
                      onChange={(event) => setDraft(event.currentTarget.value)}
                      readOnly={selected.readOnly}
                      spellCheck={false}
                    />
                  </Field>

                  {selected.readOnly ? null : (
                    <form
                      className="flex items-center justify-end gap-2"
                      onSubmit={(event) => {
                        event.preventDefault()
                        void remove()
                      }}
                    >
                      <div
                        data-testid="skill-delete-confirmation"
                        aria-hidden={!confirmingDelete}
                        className={cn(
                          't-resize min-w-0 shrink-0 overflow-hidden',
                          confirmingDelete ? 'w-56' : 'w-0',
                        )}
                      >
                        <Input
                          ref={confirmationInputRef}
                          aria-describedby="skill-delete-confirmation-hint"
                          aria-invalid={
                            confirmationName.length > 0 && confirmationName !== selected.name
                          }
                          autoComplete="off"
                          disabled={!confirmingDelete || deleting}
                          placeholder="Enter the skill name"
                          tabIndex={confirmingDelete ? 0 : -1}
                          value={confirmationName}
                          onChange={(event) => setConfirmationName(event.currentTarget.value)}
                        />
                        <span id="skill-delete-confirmation-hint" className="sr-only">
                          Enter the skill name exactly to enable deletion.
                        </span>
                      </div>
                      <Button
                        type="submit"
                        variant="destructive"
                        className="min-w-32"
                        disabled={
                          deleting || (confirmingDelete && confirmationName !== selected.name)
                        }
                      >
                        <Trash2Icon aria-hidden="true" />
                        {deleting ? 'Deleting…' : confirmingDelete ? 'Confirm' : 'Delete skill'}
                      </Button>
                      <Button
                        type="button"
                        onClick={() => void save()}
                        disabled={saving || !isDirty}
                      >
                        {saving ? 'Saving…' : 'Save changes'}
                      </Button>
                    </form>
                  )}
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </section>
  )
}
