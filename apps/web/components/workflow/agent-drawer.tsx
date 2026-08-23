'use client'

import Link from 'next/link'
import type { HarnessDescriptor, HarnessThinkingLevel } from '@slopify/contracts'
import type { AgentNode } from '@slopify/workflow-model'
import { BotIcon, BracesIcon, CpuIcon, Trash2Icon, XIcon } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type RefObject,
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
import { createAgentId, type AgentDrawerProps } from '@/lib/agent-drawer'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'

const HARNESS_DEFAULT = '__harness_default__'

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const durationMilliseconds = (value: string): number => {
  const trimmed = value.trim()
  if (trimmed.endsWith('ms')) return Number.parseFloat(trimmed)
  if (trimmed.endsWith('s')) return Number.parseFloat(trimmed) * 1_000
  return 350
}

const effortLabel = (effort: HarnessThinkingLevel): string =>
  effort === 'off' ? 'Off' : `${effort[0]?.toUpperCase()}${effort.slice(1)}`

function AgentPromptFields({
  name,
  onNameChange,
  onPromptChange,
  prompt,
}: Readonly<{
  name: string
  onNameChange: (value: string) => void
  onPromptChange: (value: string) => void
  prompt: string
}>) {
  return (
    <>
      <Field>
        <FieldLabel htmlFor="agent-name">Name</FieldLabel>
        <Input
          autoFocus
          id="agent-name"
          maxLength={128}
          onChange={(event) => onNameChange(event.currentTarget.value)}
          required
          value={name}
        />
      </Field>

      <section className="grid gap-3">
        <div className="flex items-start gap-3">
          <BracesIcon aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground" />
          <div>
            <h3 className="text-sm/5 font-semibold">Prompt</h3>
            <p className="mt-1 text-xs/4 text-muted-foreground">
              Instructions sent to the selected harness.
            </p>
          </div>
        </div>
        <Field>
          <FieldLabel className="sr-only" htmlFor="agent-prompt">
            Prompt
          </FieldLabel>
          <Textarea
            className="min-h-40 resize-y font-mono text-sm/6"
            id="agent-prompt"
            onChange={(event) => onPromptChange(event.currentTarget.value)}
            placeholder="Analyze {{ topic }} and summarize the evidence."
            required
            value={prompt}
          />
          <FieldDescription>
            Only placeholders declared in workflow configuration, such as {'{{ topic }}'}, are
            replaced at run time.
          </FieldDescription>
        </Field>
      </section>
    </>
  )
}

function AgentHarnessFields({
  availableHarnesses,
  harnessSelectionDisabled,
  harnesses,
  harnessId,
  modelId,
  modelSelectionAvailable,
  onHarnessChange,
  onModelChange,
  onThinkingLevelChange,
  selectedHarness,
  selectedHarnessAvailable,
  selectedModel,
  thinkingLevel,
  thinkingLevels,
  thinkingSelectionAvailable,
}: Readonly<{
  availableHarnesses: readonly HarnessDescriptor[]
  harnessSelectionDisabled: boolean
  harnesses: readonly HarnessDescriptor[]
  harnessId: string
  modelId: string
  modelSelectionAvailable: boolean
  onHarnessChange: (value: string | null) => void
  onModelChange: (value: string | null) => void
  onThinkingLevelChange: (value: string) => void
  selectedHarness: HarnessDescriptor | undefined
  selectedHarnessAvailable: boolean
  selectedModel: HarnessDescriptor['models'][number] | undefined
  thinkingLevel: string
  thinkingLevels: readonly HarnessThinkingLevel[]
  thinkingSelectionAvailable: boolean
}>) {
  return (
    <section className="grid gap-3">
      <div className="flex items-start gap-3">
        <CpuIcon aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground" />
        <div>
          <h3 className="text-sm/5 font-semibold">Harness</h3>
          <p className="mt-1 text-xs/4 text-muted-foreground">
            Manage the rest of the harness setup outside Slopify.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="agent-harness">Harness</FieldLabel>
          <Select
            disabled={harnessSelectionDisabled}
            onValueChange={onHarnessChange}
            value={harnessId}
          >
            <SelectTrigger className="w-full" id="agent-harness">
              <SelectValue placeholder="No harness available">{selectedHarness?.name}</SelectValue>
            </SelectTrigger>
            <SelectContent align="start">
              {harnesses.map((harness) => (
                <SelectItem
                  disabled={harness.availability !== 'AVAILABLE'}
                  key={harness.harnessId}
                  value={harness.harnessId}
                >
                  {harness.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedHarness?.availability === 'UNAVAILABLE' ? (
            <FieldDescription>{selectedHarness.unavailableReason}</FieldDescription>
          ) : selectedHarness?.availability === 'AVAILABLE' ? (
            <FieldDescription>
              {selectedHarness.name} {selectedHarness.version} · {selectedHarness.executablePath}
            </FieldDescription>
          ) : null}
        </Field>

        <Field>
          <FieldLabel htmlFor="agent-model">Model</FieldLabel>
          <Select
            disabled={!selectedHarnessAvailable}
            onValueChange={onModelChange}
            value={modelId}
          >
            <SelectTrigger className="w-full" id="agent-model">
              <SelectValue>
                {modelId === HARNESS_DEFAULT
                  ? 'Harness default'
                  : (selectedModel?.name ?? `${modelId} (unavailable)`)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="start">
              <SelectItem value={HARNESS_DEFAULT}>Harness default</SelectItem>
              {selectedHarness?.models.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {modelSelectionAvailable ? null : (
            <FieldDescription>
              This model is no longer available. Choose another model or the harness default.
            </FieldDescription>
          )}
        </Field>

        <Field>
          <FieldLabel htmlFor="agent-thinking">Thinking effort</FieldLabel>
          <Select
            disabled={!selectedHarnessAvailable}
            onValueChange={(value) => {
              if (value !== null) onThinkingLevelChange(value)
            }}
            value={thinkingLevel}
          >
            <SelectTrigger className="w-full" id="agent-thinking">
              <SelectValue>
                {thinkingLevel === HARNESS_DEFAULT
                  ? 'Harness default'
                  : thinkingSelectionAvailable
                    ? effortLabel(thinkingLevel as HarnessThinkingLevel)
                    : `${effortLabel(thinkingLevel as HarnessThinkingLevel)} (unavailable)`}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="start">
              <SelectItem value={HARNESS_DEFAULT}>Harness default</SelectItem>
              {thinkingLevels.map((level) => (
                <SelectItem key={level} value={level}>
                  {effortLabel(level)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {thinkingSelectionAvailable ? null : (
            <FieldDescription>
              This thinking effort is no longer available for the selected model.
            </FieldDescription>
          )}
        </Field>
      </div>

      {availableHarnesses.length === 0 ? (
        <Alert>
          <AlertTitle>No harness is ready</AlertTitle>
          <AlertDescription>
            Install and configure a supported harness before adding an agent.{' '}
            <Link href="/harnesses">Open Harnesses</Link>
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  )
}

function AgentFormActions({
  confirmationInputRef,
  confirmationName,
  confirmingDelete,
  deleting,
  existing,
  isDirty,
  mode,
  modelSelectionAvailable,
  name,
  onConfirmationNameChange,
  onRemove,
  prompt,
  saving,
  selectedHarnessAvailable,
  thinkingSelectionAvailable,
}: Readonly<{
  confirmationInputRef: RefObject<HTMLInputElement | null>
  confirmationName: string
  confirmingDelete: boolean
  deleting: boolean
  existing: AgentNode | undefined
  isDirty: boolean
  mode: AgentDrawerProps['mode']
  modelSelectionAvailable: boolean
  name: string
  onConfirmationNameChange: (value: string) => void
  onRemove: () => Promise<void>
  prompt: string
  saving: boolean
  selectedHarnessAvailable: boolean
  thinkingSelectionAvailable: boolean
}>) {
  return (
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
              aria-invalid={confirmationName.length > 0 && confirmationName !== existing.name}
              autoComplete="off"
              disabled={!confirmingDelete || deleting}
              onChange={(event) => onConfirmationNameChange(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                void onRemove()
              }}
              placeholder="Enter the agent name"
              tabIndex={confirmingDelete ? 0 : -1}
              value={confirmationName}
            />
            <span className="sr-only" id="agent-delete-confirmation-hint">
              Enter the agent name exactly to enable deletion.
            </span>
          </div>
          <Button
            className="min-w-32"
            disabled={deleting || (confirmingDelete && confirmationName !== existing.name)}
            onClick={() => void onRemove()}
            type="button"
            variant="destructive"
          >
            <Trash2Icon aria-hidden="true" />
            {deleting ? 'Deleting…' : confirmingDelete ? 'Confirm' : 'Delete agent'}
          </Button>
        </>
      )}
      <Button
        disabled={
          saving ||
          deleting ||
          !selectedHarnessAvailable ||
          !modelSelectionAvailable ||
          !thinkingSelectionAvailable ||
          name.trim() === '' ||
          prompt.trim() === '' ||
          (existing !== undefined && !isDirty)
        }
        type="submit"
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
  )
}

export function AgentDrawer({
  mode,
  existingNodeIds,
  harnesses,
  harnessError,
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
  const availableHarnesses = harnesses.filter(({ availability }) => availability === 'AVAILABLE')
  const initialHarnessId = String(
    existing?.harness.harnessId ??
      availableHarnesses[0]?.harnessId ??
      harnesses[0]?.harnessId ??
      '',
  )
  const [name, setName] = useState(existing?.name ?? '')
  const [prompt, setPrompt] = useState(existing?.prompt ?? '')
  const [harnessId, setHarnessId] = useState(initialHarnessId)
  const [modelId, setModelId] = useState(existing?.harness.modelId ?? HARNESS_DEFAULT)
  const [thinkingLevel, setThinkingLevel] = useState<string>(
    existing?.harness.thinkingLevel ?? HARNESS_DEFAULT,
  )
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [confirmationName, setConfirmationName] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [open, setOpen] = useState(false)
  const confirmationInputRef = useRef<HTMLInputElement>(null)
  const selectedHarness = harnesses.find((harness) => harness.harnessId === harnessId)
  const selectedHarnessAvailable = selectedHarness?.availability === 'AVAILABLE'
  const selectedModel = selectedHarness?.models.find(({ id }) => id === modelId)
  const thinkingLevels = [
    ...new Set(
      (selectedModel === undefined
        ? (selectedHarness?.models.flatMap(({ thinkingLevels: levels }) => levels) ?? [])
        : selectedModel.thinkingLevels
      ).map(String),
    ),
  ] as HarnessThinkingLevel[]
  const modelSelectionAvailable = modelId === HARNESS_DEFAULT || selectedModel !== undefined
  const thinkingSelectionAvailable =
    thinkingLevel === HARNESS_DEFAULT ||
    thinkingLevels.includes(thinkingLevel as HarnessThinkingLevel)

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

  const normalizedModelId = modelId === HARNESS_DEFAULT ? undefined : modelId
  const normalizedThinkingLevel =
    thinkingLevel === HARNESS_DEFAULT ? undefined : (thinkingLevel as HarnessThinkingLevel)
  const isDirty =
    existing === undefined ||
    name !== existing.name ||
    prompt !== existing.prompt ||
    harnessId !== existing.harness.harnessId ||
    normalizedModelId !== existing.harness.modelId ||
    normalizedThinkingLevel !== existing.harness.thinkingLevel

  const changeHarness = (nextHarnessId: string | null) => {
    if (nextHarnessId === null) return
    setHarnessId(nextHarnessId)
    setModelId(HARNESS_DEFAULT)
    setThinkingLevel(HARNESS_DEFAULT)
  }

  const changeModel = (nextModelId: string | null) => {
    if (nextModelId === null) return
    setModelId(nextModelId)
    if (nextModelId === HARNESS_DEFAULT) return
    const nextLevels = selectedHarness?.models.find(({ id }) => id === nextModelId)?.thinkingLevels
    if (
      thinkingLevel !== HARNESS_DEFAULT &&
      !nextLevels?.includes(thinkingLevel as HarnessThinkingLevel)
    ) {
      setThinkingLevel(HARNESS_DEFAULT)
    }
  }

  const remove = async () => {
    if (existing === undefined) return
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    if (confirmationName !== existing.name) return
    setDeleting(true)
    try {
      if (await onDelete()) requestClose()
    } finally {
      setDeleting(false)
    }
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedName = name.trim()
    const trimmedPrompt = prompt.trim()
    if (
      trimmedName === '' ||
      trimmedPrompt === '' ||
      harnessId === '' ||
      !selectedHarnessAvailable ||
      !modelSelectionAvailable ||
      !thinkingSelectionAvailable
    )
      return
    const saved = await onSubmit({
      id: existing?.id ?? createAgentId(trimmedName, existingNodeIds),
      name: trimmedName,
      prompt: trimmedPrompt,
      harness: {
        harnessId: selectedHarness.harnessId,
        ...(normalizedModelId === undefined ? {} : { modelId: normalizedModelId }),
        ...(normalizedThinkingLevel === undefined
          ? {}
          : { thinkingLevel: normalizedThinkingLevel }),
      },
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
      className="floating-panel-shell fixed top-[4.25rem] right-3 bottom-3 left-3 z-30 isolate w-auto sm:left-auto sm:w-[min(34rem,calc(100%-1.5rem))]"
      style={{ '--panel-translate-y': '0px' } as CSSProperties}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === 'translate' && !open)
          completeClose()
      }}
    >
      <aside
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
                Configure this workflow agent and the harness that runs it.
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
            {harnessError === undefined ? null : (
              <Alert variant="destructive">
                <AlertTitle>Harnesses unavailable</AlertTitle>
                <AlertDescription>{harnessError}</AlertDescription>
              </Alert>
            )}
            {saveError === undefined ? null : (
              <Alert variant="destructive">
                <AlertTitle>Agent not saved</AlertTitle>
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            )}

            <AgentPromptFields
              name={name}
              onNameChange={setName}
              onPromptChange={setPrompt}
              prompt={prompt}
            />
            <AgentHarnessFields
              availableHarnesses={availableHarnesses}
              harnessSelectionDisabled={availableHarnesses.length === 0 && existing === undefined}
              harnesses={harnesses}
              harnessId={harnessId}
              modelId={modelId}
              modelSelectionAvailable={modelSelectionAvailable}
              onHarnessChange={changeHarness}
              onModelChange={changeModel}
              onThinkingLevelChange={setThinkingLevel}
              selectedHarness={selectedHarness}
              selectedHarnessAvailable={selectedHarnessAvailable}
              selectedModel={selectedModel}
              thinkingLevel={thinkingLevel}
              thinkingLevels={thinkingLevels}
              thinkingSelectionAvailable={thinkingSelectionAvailable}
            />
            <AgentFormActions
              confirmationInputRef={confirmationInputRef}
              confirmationName={confirmationName}
              confirmingDelete={confirmingDelete}
              deleting={deleting}
              existing={existing}
              isDirty={isDirty}
              mode={mode}
              modelSelectionAvailable={modelSelectionAvailable}
              name={name}
              onConfirmationNameChange={setConfirmationName}
              onRemove={remove}
              prompt={prompt}
              saving={saving}
              selectedHarnessAvailable={selectedHarnessAvailable}
              thinkingSelectionAvailable={thinkingSelectionAvailable}
            />
          </div>
        </form>
      </aside>
    </div>
  )
}
