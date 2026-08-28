import { useEffect, useState, type FormEvent } from 'react'

import type { HarnessDescriptor, Repository } from '@slopify/contracts'
import {
  MAX_AGENT_TIMEOUT_SECONDS,
  MIN_AGENT_TIMEOUT_SECONDS,
  type AgentNode,
  type Workflow,
} from '@slopify/workflow-model'
import { BotIcon, WorkflowIcon } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { WorkspacePanelHeader } from '@/components/workspace-panel-header'
import { toast } from '@/lib/toast'

function DefinitionItems({ items }: Readonly<{ items: readonly (readonly [string, string])[] }>) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div className="min-w-0" key={label}>
          <dt className="text-xs/4 text-muted-foreground">{label}</dt>
          <dd className="mt-1 break-words text-sm/5 font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function WorkflowOverviewPanel({
  repositories,
  workflow,
}: Readonly<{ repositories: readonly Repository[]; workflow: Workflow }>) {
  const configuredRepositories = workflow.configuration.repositoryIds.map(
    (repositoryId) =>
      repositories.find((repository) => repository.repositoryId === repositoryId)?.name ??
      repositoryId,
  )
  const primaryRepository =
    repositories.find(
      ({ repositoryId }) => repositoryId === workflow.configuration.primaryRepositoryId,
    )?.name ?? workflow.configuration.primaryRepositoryId

  return (
    <aside
      aria-label="Workflow overview"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
      data-layout="workspace"
    >
      <WorkspacePanelHeader
        icon={WorkflowIcon}
        subtitle="Review structure and configuration shared by every agent."
        title="Overview"
      />

      <div className="grid min-h-0 flex-1 content-start gap-8 overflow-y-auto p-6">
        <section aria-labelledby="workflow-description-heading" className="grid gap-3">
          <h3 className="text-sm/5 font-semibold" id="workflow-description-heading">
            Description
          </h3>
          <p className="max-w-3xl text-sm/5 text-muted-foreground">{workflow.description}</p>
        </section>

        <section aria-labelledby="workflow-structure-heading" className="grid gap-3">
          <h3 className="text-sm/5 font-semibold" id="workflow-structure-heading">
            Structure
          </h3>
          <DefinitionItems
            items={[
              ['Agents', String(workflow.nodes.length)],
              ['Transitions', String(workflow.edges.length)],
              ['Maximum transitions', String(workflow.maxTransitions)],
              ['Primary repository', primaryRepository ?? 'None'],
            ]}
          />
        </section>

        <section aria-labelledby="workflow-repositories-heading" className="grid gap-3">
          <h3 className="text-sm/5 font-semibold" id="workflow-repositories-heading">
            Repositories
          </h3>
          <p className="text-sm/5 text-muted-foreground">
            {configuredRepositories.length === 0
              ? 'No repositories configured.'
              : configuredRepositories.join(', ')}
          </p>
        </section>

        <section aria-labelledby="workflow-variables-heading" className="grid gap-3">
          <h3 className="text-sm/5 font-semibold" id="workflow-variables-heading">
            Run variables
          </h3>
          <p className="text-sm/5 text-muted-foreground">
            {workflow.configuration.variables.length === 0
              ? 'No variables configured.'
              : workflow.configuration.variables.join(', ')}
          </p>
        </section>
      </div>
    </aside>
  )
}

export function WorkflowAgentConfigurationPanel({
  conflict,
  error,
  harnesses,
  node,
  onClose,
  onDirtyChange,
  onSubmit,
  saving = false,
}: Readonly<{
  conflict?: string | undefined
  error?: string | undefined
  harnesses: readonly HarnessDescriptor[]
  node: AgentNode
  onClose: () => void
  onDirtyChange?: ((dirty: boolean) => void) | undefined
  onSubmit: (node: AgentNode) => Promise<boolean>
  saving?: boolean | undefined
}>) {
  const [prompt, setPrompt] = useState(node.prompt)
  const [harnessId, setHarnessId] = useState(node.harness.harnessId)
  const [modelId, setModelId] = useState(node.harness.modelId)
  const [thinkingLevel, setThinkingLevel] = useState(node.harness.thinkingLevel)
  const [timeoutMinutes, setTimeoutMinutes] = useState(String(node.timeoutSeconds / 60))
  const selectedHarness = harnesses.find((harness) => harness.harnessId === harnessId)
  const selectedModel = selectedHarness?.models.find((model) => model.id === modelId)
  const timeout = Number(timeoutMinutes)
  const timeoutValid =
    Number.isInteger(timeout) &&
    timeout >= MIN_AGENT_TIMEOUT_SECONDS / 60 &&
    timeout <= MAX_AGENT_TIMEOUT_SECONDS / 60
  const promptValid = prompt.trim().length > 0
  const isDirty =
    prompt !== node.prompt ||
    harnessId !== node.harness.harnessId ||
    modelId !== node.harness.modelId ||
    thinkingLevel !== node.harness.thinkingLevel ||
    timeoutMinutes !== String(node.timeoutSeconds / 60)

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  const requestClose = () => {
    if (!saving) onClose()
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isDirty || !promptValid || !timeoutValid || conflict !== undefined) return
    const saved = await onSubmit({
      ...node,
      prompt,
      harness: {
        harnessId,
        ...(modelId === undefined ? {} : { modelId }),
        ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
      },
      timeoutSeconds: timeout * 60,
    })
    if (!saved) return
    toast.add({
      title: 'Agent saved',
      description: `${node.name} configuration was saved.`,
      type: 'success',
    })
    requestClose()
  }

  const modelOptions = [...(selectedHarness?.models ?? [])]
  if (modelId !== undefined && !modelOptions.some((model) => model.id === modelId)) {
    modelOptions.push({ id: modelId, name: modelId, thinkingLevels: [] })
  }
  const thinkingOptions = [...(selectedModel?.thinkingLevels ?? [])]
  if (thinkingLevel !== undefined && !thinkingOptions.includes(thinkingLevel)) {
    thinkingOptions.push(thinkingLevel)
  }

  return (
    <aside
      aria-label={`Agent configuration: ${node.name}`}
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
      data-layout="workspace"
    >
      <WorkspacePanelHeader
        icon={BotIcon}
        subtitle="Update this agent's prompt and runtime configuration."
        title="Edit agent"
      />

      <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => void submit(event)}>
        <div className="grid min-h-0 flex-1 content-start gap-8 overflow-y-auto p-6">
          {conflict === undefined ? null : (
            <Alert variant="destructive">
              <AlertTitle>External change detected</AlertTitle>
              <AlertDescription>{conflict}</AlertDescription>
            </Alert>
          )}
          {error === undefined ? null : (
            <Alert variant="destructive">
              <AlertTitle>Agent update failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Field>
            <FieldLabel htmlFor={`agent-name-${node.id}`}>Name</FieldLabel>
            <Input
              className="cursor-default bg-muted/40 text-muted-foreground"
              id={`agent-name-${node.id}`}
              readOnly
              value={node.name}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor={`agent-prompt-${node.id}`}>Prompt</FieldLabel>
            <Textarea
              className="min-h-48 resize-y font-mono text-xs/5"
              id={`agent-prompt-${node.id}`}
              onChange={(event) => setPrompt(event.currentTarget.value)}
              value={prompt}
            />
          </Field>

          <section aria-labelledby="agent-runtime-heading" className="grid gap-3">
            <h3 className="text-sm/5 font-semibold" id="agent-runtime-heading">
              Runtime
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`agent-harness-${node.id}`}>Harness</FieldLabel>
                <Select
                  onValueChange={(value) => {
                    if (value === null) return
                    setHarnessId(value)
                    setModelId(undefined)
                    setThinkingLevel(undefined)
                  }}
                  value={harnessId}
                >
                  <SelectTrigger className="w-full" id={`agent-harness-${node.id}`}>
                    <SelectValue>{selectedHarness?.name ?? harnessId}</SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start">
                    {harnesses.map((harness) => (
                      <SelectItem
                        disabled={
                          harness.availability !== 'AVAILABLE' && harness.harnessId !== harnessId
                        }
                        key={harness.harnessId}
                        value={harness.harnessId}
                      >
                        {harness.name}
                      </SelectItem>
                    ))}
                    {selectedHarness === undefined ? (
                      <SelectItem value={harnessId}>{harnessId}</SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor={`agent-model-${node.id}`}>Model</FieldLabel>
                <Select
                  onValueChange={(value) => {
                    if (value === null) return
                    setModelId(value === '__harness_default__' ? undefined : value)
                    setThinkingLevel(undefined)
                  }}
                  value={modelId ?? '__harness_default__'}
                >
                  <SelectTrigger className="w-full" id={`agent-model-${node.id}`}>
                    <SelectValue>
                      {modelId === undefined ? 'Harness default' : (selectedModel?.name ?? modelId)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectItem value="__harness_default__">Harness default</SelectItem>
                    {modelOptions.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor={`agent-thinking-${node.id}`}>Thinking</FieldLabel>
                <Select
                  onValueChange={(value) => {
                    if (value === null) return
                    setThinkingLevel(
                      value === '__harness_default__'
                        ? undefined
                        : (value as NonNullable<AgentNode['harness']['thinkingLevel']>),
                    )
                  }}
                  value={thinkingLevel ?? '__harness_default__'}
                >
                  <SelectTrigger className="w-full" id={`agent-thinking-${node.id}`}>
                    <SelectValue>{thinkingLevel ?? 'Harness default'}</SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectItem value="__harness_default__">Harness default</SelectItem>
                    {thinkingOptions.map((level) => (
                      <SelectItem key={level} value={level}>
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor={`agent-timeout-${node.id}`}>Timeout (minutes)</FieldLabel>
                <Input
                  id={`agent-timeout-${node.id}`}
                  max={MAX_AGENT_TIMEOUT_SECONDS / 60}
                  min={MIN_AGENT_TIMEOUT_SECONDS / 60}
                  onChange={(event) => setTimeoutMinutes(event.currentTarget.value)}
                  step={1}
                  type="number"
                  value={timeoutMinutes}
                />
              </Field>
            </div>
          </section>

          <footer className="flex justify-end">
            <Button
              disabled={
                saving || !isDirty || !promptValid || !timeoutValid || conflict !== undefined
              }
              type="submit"
            >
              {saving ? 'Saving changes…' : 'Save changes'}
            </Button>
          </footer>
        </div>
      </form>
    </aside>
  )
}
