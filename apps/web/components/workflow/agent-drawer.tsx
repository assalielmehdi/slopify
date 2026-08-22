'use client'

import type {
  AgentInferenceConfiguration,
  AgentNode,
  SkillSnapshotReference,
} from '@slopify/workflow-model'
import type { ConnectionCatalogEntry, InferenceModelOption } from '@slopify/contracts'
import {
  BookOpenIcon,
  BotIcon,
  BracesIcon,
  PlugIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
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
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import type { ConnectionRecord, SkillRecord } from '@/lib/api-client'

export interface AgentFormValue {
  readonly id: string
  readonly name: string
  readonly prompt: string
  readonly inference: AgentInferenceConfiguration
  readonly connectorIds: readonly string[]
  readonly skillSnapshotRefs: readonly SkillSnapshotReference[]
}

export type AgentDrawerMode =
  Readonly<{ kind: 'create' }> | Readonly<{ kind: 'edit'; agent: AgentNode }>

export interface AgentDrawerProps {
  readonly mode: AgentDrawerMode
  readonly existingNodeIds: ReadonlySet<string>
  readonly catalog: readonly ConnectionCatalogEntry[]
  readonly connections: readonly ConnectionRecord[]
  readonly skills: readonly SkillRecord[]
  readonly catalogError?: string | undefined
  readonly saveError?: string | undefined
  readonly saving?: boolean | undefined
  readonly onDelete: () => Promise<boolean>
  readonly onClose: () => void
  readonly onSubmit: (value: AgentFormValue) => Promise<boolean>
}

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const durationMilliseconds = (value: string): number => {
  const trimmed = value.trim()
  if (trimmed.endsWith('ms')) return Number.parseFloat(trimmed)
  if (trimmed.endsWith('s')) return Number.parseFloat(trimmed) * 1_000
  return 350
}

const slugify = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || 'agent'

export const createAgentId = (name: string, existingNodeIds: ReadonlySet<string>): string => {
  const base = slugify(name)
  if (!existingNodeIds.has(base)) return base
  let suffix = 2
  while (existingNodeIds.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

const toSkillReference = (skill: SkillRecord): SkillSnapshotReference => ({
  skillId: skill.skillId as SkillSnapshotReference['skillId'],
  snapshotId: `sha256:${skill.digest}`,
  digest: skill.digest,
  name: skill.name,
  description: skill.description,
})

function CapabilityChoice({
  checked,
  description,
  disabled,
  name,
  onChange,
}: Readonly<{
  checked: boolean
  description: string
  disabled?: boolean
  name: string
  onChange: (checked: boolean) => void
}>) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 transition-colors duration-[var(--duration-quick)] hover:bg-muted/40 has-[:checked]:border-foreground/25 has-[:checked]:bg-muted/55 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="mt-0.5 size-4 rounded border-input accent-foreground"
      />
      <span className="min-w-0">
        <span className="block text-sm/5 font-medium">{name}</span>
        <span className="block text-xs/4 text-muted-foreground">{description}</span>
      </span>
    </label>
  )
}

export function AgentDrawer({
  mode,
  existingNodeIds,
  catalog,
  connections,
  skills,
  catalogError,
  saveError,
  saving = false,
  onDelete,
  onClose,
  onSubmit,
}: AgentDrawerProps) {
  const shellRef = useRef<HTMLDivElement>(null)
  const openFrameRef = useRef<number | undefined>(undefined)
  const closeTimerRef = useRef<number | undefined>(undefined)
  const closingRef = useRef(false)
  const existing = mode.kind === 'edit' ? mode.agent : undefined
  const inferenceConnections = useMemo(
    () =>
      connections.filter(
        (connection) => connection.category === 'inference' && connection.status === 'CONNECTED',
      ),
    [connections],
  )
  const connectorConnections = useMemo(
    () =>
      connections.filter(
        (connection) => connection.category === 'connector' && connection.status === 'CONNECTED',
      ),
    [connections],
  )
  const initialInferenceId =
    existing?.job.inference.connectionId ?? inferenceConnections[0]?.connectionId ?? ''
  const modelsForConnection = (nextConnectionId: string): readonly InferenceModelOption[] => {
    const connection = inferenceConnections.find(
      (candidate) => candidate.connectionId === nextConnectionId,
    )
    return catalog.find((entry) => entry.type === connection?.type)?.models ?? []
  }
  const initialModels = modelsForConnection(initialInferenceId)
  const initialModelId = existing?.job.inference.modelId ?? initialModels[0]?.id ?? ''
  const initialThinkingLevels =
    initialModels.find((model) => model.id === initialModelId)?.thinkingLevels ?? []
  const [name, setName] = useState(existing?.name ?? '')
  const [prompt, setPrompt] = useState(existing?.job.prompt ?? '')
  const [connectionId, setConnectionId] = useState(initialInferenceId)
  const [modelId, setModelId] = useState(initialModelId)
  const [thinkingLevel, setThinkingLevel] = useState<AgentInferenceConfiguration['thinkingLevel']>(
    existing?.job.inference.thinkingLevel ??
      (initialThinkingLevels.includes('medium') ? 'medium' : (initialThinkingLevels[0] ?? 'off')),
  )
  const [selectedConnectorIds, setSelectedConnectorIds] = useState<Set<string>>(
    () => new Set(existing?.job.connectorIds.map(String) ?? []),
  )
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(
    () => new Set(existing?.job.skillSnapshotRefs.map(({ skillId }) => String(skillId)) ?? []),
  )
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [confirmationName, setConfirmationName] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [open, setOpen] = useState(false)
  const confirmationInputRef = useRef<HTMLInputElement>(null)
  const selectedInferenceConnection = inferenceConnections.find(
    (connection) => connection.connectionId === connectionId,
  )
  const availableModels = modelsForConnection(connectionId)
  const selectedModel = availableModels.find((model) => model.id === modelId)
  const availableThinkingLevels = selectedModel?.thinkingLevels ?? []

  const selectThinkingDefault = (
    levels: readonly AgentInferenceConfiguration['thinkingLevel'][],
  ) => (levels.includes('medium') ? 'medium' : (levels[0] ?? 'off'))

  const changeProvider = (nextConnectionId: string | null) => {
    if (nextConnectionId === null) return
    const nextModels = modelsForConnection(nextConnectionId)
    const nextModel = nextModels[0]
    setConnectionId(nextConnectionId)
    setModelId(nextModel?.id ?? '')
    setThinkingLevel(selectThinkingDefault(nextModel?.thinkingLevels ?? []))
  }

  const changeModel = (nextModelId: string | null) => {
    if (nextModelId === null) return
    const levels = availableModels.find((model) => model.id === nextModelId)?.thinkingLevels ?? []
    setModelId(nextModelId)
    if (!levels.includes(thinkingLevel)) setThinkingLevel(selectThinkingDefault(levels))
  }

  const completeClose = useCallback(() => {
    if (!closingRef.current) return
    closingRef.current = false
    if (closeTimerRef.current !== undefined) window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = undefined
    onClose()
  }, [onClose])

  const requestClose = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setOpen(false)
    if (prefersReducedMotion()) {
      completeClose()
      return
    }
    const duration = durationMilliseconds(
      getComputedStyle(shellRef.current ?? document.documentElement).getPropertyValue(
        '--panel-close-dur',
      ),
    )
    closeTimerRef.current = window.setTimeout(completeClose, duration + 50)
  }, [completeClose])

  useEffect(() => {
    openFrameRef.current = window.requestAnimationFrame(() => {
      openFrameRef.current = window.requestAnimationFrame(() => {
        if (!closingRef.current) setOpen(true)
        openFrameRef.current = undefined
      })
    })
    return () => {
      if (openFrameRef.current !== undefined) window.cancelAnimationFrame(openFrameRef.current)
      if (closeTimerRef.current !== undefined) window.clearTimeout(closeTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (confirmingDelete) confirmationInputRef.current?.focus()
  }, [confirmingDelete])

  const skillChoices = useMemo(() => {
    const liveById = new Map(skills.map((skill) => [skill.skillId, skill]))
    const selectableSkills = skills.filter(({ kind }) => kind !== 'connector')
    const pinned = existing?.job.skillSnapshotRefs ?? []
    return [
      ...selectableSkills.map((skill) => ({
        id: String(skill.skillId),
        name: skill.name,
        description: skill.valid ? skill.description : `Unavailable: ${skill.issues.join(', ')}`,
        disabled: !skill.valid,
        reference:
          pinned.find(({ skillId }) => skillId === skill.skillId) ?? toSkillReference(skill),
      })),
      ...pinned
        .filter(({ skillId }) => !liveById.has(skillId))
        .map((reference) => ({
          id: String(reference.skillId),
          name: reference.name,
          description: `${reference.description} (captured snapshot; live skill unavailable)`,
          disabled: false,
          reference,
        })),
    ]
  }, [existing, skills])

  const sameSelection = (selected: ReadonlySet<string>, expected: readonly string[]) =>
    selected.size === expected.length && expected.every((id) => selected.has(id))
  const isDirty =
    existing === undefined ||
    name !== existing.name ||
    prompt !== existing.job.prompt ||
    connectionId !== existing.job.inference.connectionId ||
    modelId !== existing.job.inference.modelId ||
    thinkingLevel !== existing.job.inference.thinkingLevel ||
    !sameSelection(selectedConnectorIds, existing.job.connectorIds.map(String)) ||
    !sameSelection(
      selectedSkillIds,
      existing.job.skillSnapshotRefs.map(({ skillId }) => String(skillId)),
    )

  const remove = async () => {
    if (existing === undefined) return
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    if (confirmationName !== existing.name) return
    setDeleting(true)
    const deleted = await onDelete()
    setDeleting(false)
    if (deleted) requestClose()
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedName = name.trim()
    const trimmedPrompt = prompt.trim()
    const trimmedModelId = modelId.trim()
    if (trimmedName === '' || trimmedPrompt === '' || connectionId === '' || trimmedModelId === '')
      return
    const saved = await onSubmit({
      id: existing?.id ?? createAgentId(trimmedName, existingNodeIds),
      name: trimmedName,
      prompt: trimmedPrompt,
      inference: { connectionId, modelId: trimmedModelId, thinkingLevel },
      connectorIds: [...selectedConnectorIds],
      skillSnapshotRefs: skillChoices
        .filter(({ id }) => selectedSkillIds.has(id))
        .map(({ reference }) => reference),
    })
    if (!saved) return
    toast.add({
      title: mode.kind === 'create' ? 'Agent added' : 'Agent saved',
      description:
        mode.kind === 'create'
          ? `${trimmedName} was added to the workflow.`
          : `${trimmedName} was updated.`,
      type: 'success',
    })
    requestClose()
  }

  const title = mode.kind === 'create' ? 'Add agent' : 'Edit agent'

  return (
    <div
      ref={shellRef}
      data-open={open}
      className="provider-floating-panel-shell fixed top-[4.25rem] right-3 bottom-3 left-3 z-30 isolate w-auto sm:left-auto sm:w-[min(34rem,calc(100%-1.5rem))]"
      style={
        {
          '--panel-translate-y': '0px',
        } as CSSProperties
      }
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === 'translate' && !open)
          completeClose()
      }}
    >
      <aside
        role="complementary"
        aria-label={title}
        data-open={open}
        className="t-panel-slide flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-[var(--shadow-overlay)]"
      >
        <header className="relative shrink-0 border-b border-border p-6 pr-14">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
              <BotIcon aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[18px]/6 font-semibold tracking-[-0.01em]">{title}</h2>
              <p className="text-xs/4 text-muted-foreground">
                Configure the instructions and capabilities available to this agent.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close agent drawer"
            onClick={requestClose}
            className="absolute top-3 right-3"
          >
            <XIcon aria-hidden="true" />
          </Button>
        </header>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => void submit(event)}>
          <div className="grid min-h-0 flex-1 content-start gap-8 overflow-y-auto p-6">
            {catalogError === undefined ? null : (
              <Alert variant="destructive">
                <AlertTitle>Agent resources unavailable</AlertTitle>
                <AlertDescription>{catalogError}</AlertDescription>
              </Alert>
            )}
            {saveError === undefined ? null : (
              <Alert variant="destructive">
                <AlertTitle>Agent not saved</AlertTitle>
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            )}

            <Field>
              <FieldLabel htmlFor="agent-name">Name</FieldLabel>
              <Input
                id="agent-name"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                maxLength={128}
                autoFocus
                required
              />
            </Field>

            <section className="grid gap-3">
              <div className="flex items-start gap-3">
                <BracesIcon aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground" />
                <div>
                  <h3 className="text-sm/5 font-semibold">Prompt</h3>
                  <p className="mt-1 text-xs/4 text-muted-foreground">
                    The instructions Pi sends to this agent.
                  </p>
                </div>
              </div>
              <Field>
                <FieldLabel htmlFor="agent-prompt" className="sr-only">
                  Prompt
                </FieldLabel>
                <Textarea
                  id="agent-prompt"
                  className="min-h-40 resize-y font-mono text-sm/6"
                  value={prompt}
                  onChange={(event) => setPrompt(event.currentTarget.value)}
                  placeholder="Analyze {{ topic }} and summarize the evidence."
                  required
                />
                <FieldDescription>
                  Use exact placeholders such as {'{{ topic }}'} to interpolate run variables.
                </FieldDescription>
              </Field>
            </section>

            <section className="grid gap-3">
              <div className="flex items-start gap-3">
                <SparklesIcon aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground" />
                <div>
                  <h3 className="text-sm/5 font-semibold">Inference</h3>
                  <p className="mt-1 text-xs/4 text-muted-foreground">
                    Select a connected provider, model, and thinking effort.
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field className="sm:col-span-2">
                  <FieldLabel htmlFor="agent-provider">Provider</FieldLabel>
                  <Select
                    value={connectionId}
                    onValueChange={changeProvider}
                    disabled={inferenceConnections.length === 0}
                  >
                    <SelectTrigger id="agent-provider" className="w-full">
                      <SelectValue placeholder="No connected provider">
                        {selectedInferenceConnection?.label}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start">
                      {inferenceConnections.map((connection) => (
                        <SelectItem key={connection.connectionId} value={connection.connectionId}>
                          {connection.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {inferenceConnections.length === 0 ? (
                    <FieldDescription>
                      No providers are connected yet. Add one from Providers before saving this
                      agent.
                    </FieldDescription>
                  ) : null}
                </Field>
                <Field>
                  <FieldLabel htmlFor="agent-model">Model</FieldLabel>
                  <Select
                    value={modelId}
                    onValueChange={changeModel}
                    disabled={availableModels.length === 0}
                  >
                    <SelectTrigger id="agent-model" className="w-full">
                      <SelectValue placeholder="No models available">
                        {selectedModel?.name}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start">
                      {availableModels.map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="agent-thinking">Thinking effort</FieldLabel>
                  <Select
                    value={thinkingLevel}
                    onValueChange={(value) => {
                      if (value !== null) setThinkingLevel(value)
                    }}
                    disabled={availableThinkingLevels.length === 0}
                  >
                    <SelectTrigger id="agent-thinking" className="w-full">
                      <SelectValue placeholder="No efforts available">
                        {thinkingLevel === 'off'
                          ? 'Off'
                          : thinkingLevel[0]?.toUpperCase() + thinkingLevel.slice(1)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start">
                      {availableThinkingLevels.map((level) => (
                        <SelectItem key={level} value={level}>
                          {level === 'off' ? 'Off' : level[0]?.toUpperCase() + level.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </section>

            <section className="grid gap-3">
              <div className="flex items-start gap-3">
                <PlugIcon aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground" />
                <div>
                  <h3 className="text-sm/5 font-semibold">Connectors</h3>
                  <p className="mt-1 text-xs/4 text-muted-foreground">
                    Grant only the connected services this agent needs.
                  </p>
                </div>
              </div>
              {connectorConnections.length === 0 ? (
                <p className="rounded-md border border-dashed p-3 text-xs/4 text-muted-foreground">
                  No connectors are connected yet.
                </p>
              ) : (
                <div className="grid gap-2">
                  {connectorConnections.map((connection) => (
                    <CapabilityChoice
                      key={connection.connectionId}
                      name={connection.label}
                      description={connection.authority}
                      checked={selectedConnectorIds.has(connection.connectionId)}
                      onChange={(checked) =>
                        setSelectedConnectorIds((current) => {
                          const next = new Set(current)
                          if (checked) next.add(connection.connectionId)
                          else next.delete(connection.connectionId)
                          return next
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="grid gap-3">
              <div className="flex items-start gap-3">
                <BookOpenIcon aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground" />
                <div>
                  <h3 className="text-sm/5 font-semibold">Skills</h3>
                  <p className="mt-1 text-xs/4 text-muted-foreground">
                    Selected skills are captured and mounted read-only for this agent.
                  </p>
                </div>
              </div>
              {skillChoices.length === 0 ? (
                <p className="rounded-md border border-dashed p-3 text-xs/4 text-muted-foreground">
                  No skills are available yet.
                </p>
              ) : (
                <div className="grid gap-2">
                  {skillChoices.map((skill) => (
                    <CapabilityChoice
                      key={skill.id}
                      name={skill.name}
                      description={skill.description}
                      disabled={skill.disabled}
                      checked={selectedSkillIds.has(skill.id)}
                      onChange={(checked) =>
                        setSelectedSkillIds((current) => {
                          const next = new Set(current)
                          if (checked) next.add(skill.id)
                          else next.delete(skill.id)
                          return next
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </section>

            <footer className="flex items-center justify-end gap-2">
              {existing === undefined ? null : (
                <>
                  <div
                    aria-hidden={!confirmingDelete}
                    className={cn(
                      't-resize min-w-0 shrink-0 overflow-hidden',
                      confirmingDelete ? 'w-56' : 'w-0',
                    )}
                  >
                    <Input
                      ref={confirmationInputRef}
                      aria-describedby="agent-delete-confirmation-hint"
                      aria-invalid={
                        confirmationName.length > 0 && confirmationName !== existing.name
                      }
                      autoComplete="off"
                      disabled={!confirmingDelete || deleting}
                      placeholder="Enter the agent name"
                      tabIndex={confirmingDelete ? 0 : -1}
                      value={confirmationName}
                      onChange={(event) => setConfirmationName(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') return
                        event.preventDefault()
                        void remove()
                      }}
                    />
                    <span id="agent-delete-confirmation-hint" className="sr-only">
                      Enter the agent name exactly to enable deletion.
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    className="min-w-32"
                    disabled={deleting || (confirmingDelete && confirmationName !== existing.name)}
                    onClick={() => void remove()}
                  >
                    <Trash2Icon aria-hidden="true" />
                    {deleting ? 'Deleting…' : confirmingDelete ? 'Confirm' : 'Delete agent'}
                  </Button>
                </>
              )}
              <Button
                type="submit"
                disabled={
                  saving ||
                  deleting ||
                  (existing !== undefined && !isDirty) ||
                  inferenceConnections.length === 0 ||
                  availableModels.length === 0
                }
              >
                {saving
                  ? mode.kind === 'create'
                    ? 'Adding agent…'
                    : 'Saving changes…'
                  : mode.kind === 'create'
                    ? 'Add agent'
                    : 'Save changes'}
              </Button>
            </footer>
          </div>
        </form>
      </aside>
    </div>
  )
}
