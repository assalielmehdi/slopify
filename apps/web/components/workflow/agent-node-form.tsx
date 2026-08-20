'use client'

import {
  AgentNodeSchema,
  CONFIGURABLE_AGENT_NODE_FIELDS,
  type AgentNode,
} from '@loop/workflow-model'
import { useId, useMemo, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import {
  ApiClientError,
  type ConnectionRecord,
  type SkillRecord,
  type WorkflowAgentConfigurationChanges,
} from '@/lib/api-client'

type EditableAgentField = (typeof CONFIGURABLE_AGENT_NODE_FIELDS)[number] | 'name' | 'skillIds'
type FieldErrors = Partial<Record<EditableAgentField, string>>

const editableFields = new Set<string>([...CONFIGURABLE_AGENT_NODE_FIELDS, 'skillIds'])
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const fieldFromPath = (path: unknown): EditableAgentField | undefined => {
  if (!Array.isArray(path)) return undefined
  return path.findLast(
    (segment): segment is EditableAgentField =>
      typeof segment === 'string' && editableFields.has(segment),
  )
}

const fieldFromError = (error: ApiClientError): EditableAgentField | undefined => {
  if (!isRecord(error.details)) return undefined
  const direct = fieldFromPath(error.details.path)
  if (direct !== undefined) return direct
  if (!Array.isArray(error.details.issues)) return undefined
  for (const issue of error.details.issues) {
    if (!isRecord(issue)) continue
    const field = fieldFromPath(issue.path)
    if (field !== undefined) return field
  }
  return undefined
}

const messageFromError = (error: unknown) =>
  error instanceof Error ? error.message : 'The workflow revision could not be saved'

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

const changedConfiguration = (
  node: AgentNode,
  candidate: AgentNode,
  skillIds: readonly string[],
): WorkflowAgentConfigurationChanges => ({
  ...(candidate.name === node.name ? {} : { name: candidate.name }),
  ...(candidate.job.prompt === node.job.prompt ? {} : { prompt: candidate.job.prompt }),
  ...(same(
    skillIds,
    node.job.skillSnapshotRefs.map(({ skillId }) => skillId),
  )
    ? {}
    : { skillIds }),
  ...(candidate.job.inference.connectionId === node.job.inference.connectionId
    ? {}
    : { connectionId: candidate.job.inference.connectionId }),
  ...(candidate.job.inference.modelId === node.job.inference.modelId
    ? {}
    : { modelId: candidate.job.inference.modelId }),
  ...(candidate.job.inference.thinkingLevel === node.job.inference.thinkingLevel
    ? {}
    : { thinkingLevel: candidate.job.inference.thinkingLevel }),
  ...(same(candidate.job.connectorIds, node.job.connectorIds)
    ? {}
    : { connectorIds: candidate.job.connectorIds }),
  ...(candidate.result.schemaRef === node.result.schemaRef
    ? {}
    : { outputSchemaRef: candidate.result.schemaRef }),
  ...(candidate.timeoutSeconds === node.timeoutSeconds
    ? {}
    : { timeoutSeconds: candidate.timeoutSeconds }),
})

export interface AgentNodeFormProps {
  readonly node: AgentNode
  readonly skills?: readonly SkillRecord[]
  readonly connections?: readonly ConnectionRecord[]
  readonly onSave: (changes: WorkflowAgentConfigurationChanges) => Promise<void>
}

export function AgentNodeForm({ node, skills = [], connections = [], onSave }: AgentNodeFormProps) {
  const formId = useId()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string>()
  const [pending, setPending] = useState(false)
  const [skillQuery, setSkillQuery] = useState('')
  const availableSkills = useMemo(() => {
    const pinned = node.job.skillSnapshotRefs.map((skill) => ({
      skillId: skill.skillId,
      name: skill.name,
      description: skill.description,
    }))
    return [
      ...new Map([...pinned, ...skills].map((skill) => [skill.skillId, skill])).values(),
    ].filter((skill) =>
      `${skill.name} ${skill.description}`.toLowerCase().includes(skillQuery.toLowerCase()),
    )
  }, [node.job.skillSnapshotRefs, skillQuery, skills])
  const connectorConnections = connections.filter(
    ({ category, status }) => category === 'connector' && status === 'CONNECTED',
  )
  const inferenceConnections = connections.filter(
    ({ category, status }) => category === 'inference' && status === 'CONNECTED',
  )

  const controlState = (field: EditableAgentField) => ({
    'aria-describedby': fieldErrors[field] === undefined ? undefined : `${formId}-${field}-error`,
    'aria-invalid': fieldErrors[field] === undefined ? undefined : true,
  })
  const clearFieldError = (field: EditableAgentField) =>
    setFieldErrors((current) => ({ ...current, [field]: undefined }))

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFieldErrors({})
    setFormError(undefined)
    const formData = new FormData(event.currentTarget)
    const connectorIds = formData.getAll('connectorIds').map(String)
    const skillIds = formData.getAll('skillIds').map(String)
    const parsed = AgentNodeSchema.safeParse({
      ...node,
      name: formData.get('name'),
      timeoutSeconds: Number(formData.get('timeoutSeconds')),
      result: { schemaRef: formData.get('outputSchemaRef') },
      job: {
        ...node.job,
        prompt: formData.get('prompt'),
        connectorIds,
        inference: {
          connectionId: formData.get('connectionId'),
          modelId: formData.get('modelId'),
          thinkingLevel: formData.get('thinkingLevel'),
        },
      },
    })
    if (!parsed.success) {
      const errors: FieldErrors = {}
      for (const issue of parsed.error.issues) {
        const field = fieldFromPath(issue.path)
        if (field !== undefined && errors[field] === undefined) errors[field] = issue.message
      }
      setFieldErrors(errors)
      if (Object.keys(errors).length === 0) setFormError('Agent configuration is invalid')
      return
    }
    const changes = changedConfiguration(node, parsed.data, skillIds)
    if (Object.keys(changes).length === 0) {
      setFormError('Change at least one configuration field before saving.')
      return
    }
    setPending(true)
    try {
      await onSave(changes)
    } catch (error) {
      if (error instanceof ApiClientError) {
        const field = fieldFromError(error)
        if (field !== undefined) {
          setFieldErrors({ [field]: error.message })
          return
        }
      }
      setFormError(messageFromError(error))
    } finally {
      setPending(false)
    }
  }

  const input = (field: EditableAgentField, label: string, defaultValue: string) => (
    <Field data-invalid={fieldErrors[field] !== undefined}>
      <FieldLabel htmlFor={`${formId}-${field}`}>{label}</FieldLabel>
      <Input
        {...controlState(field)}
        id={`${formId}-${field}`}
        name={field}
        defaultValue={defaultValue}
        onInput={() => clearFieldError(field)}
        required
      />
      <FieldError id={`${formId}-${field}-error`}>{fieldErrors[field]}</FieldError>
    </Field>
  )

  return (
    <form aria-label="Agent configuration" onSubmit={(event) => void submit(event)}>
      <FieldSet disabled={pending}>
        <FieldLegend>Agent job</FieldLegend>
        <FieldGroup className="gap-3">
          {input('name', 'Name', node.name)}
          <Field data-invalid={fieldErrors.prompt !== undefined}>
            <FieldLabel htmlFor={`${formId}-prompt`}>Prompt</FieldLabel>
            <Textarea
              {...controlState('prompt')}
              id={`${formId}-prompt`}
              name="prompt"
              defaultValue={node.job.prompt}
              onInput={() => clearFieldError('prompt')}
              required
            />
            <FieldError id={`${formId}-prompt-error`}>{fieldErrors.prompt}</FieldError>
          </Field>
          <Field data-invalid={fieldErrors.skillIds !== undefined}>
            <FieldLabel htmlFor={`${formId}-skill-search`}>Skills</FieldLabel>
            <Input
              id={`${formId}-skill-search`}
              aria-label="Search skills"
              placeholder="Search skills"
              value={skillQuery}
              onChange={(event) => setSkillQuery(event.currentTarget.value)}
            />
            <div className="grid max-h-36 gap-2 overflow-auto border p-2">
              {availableSkills.length === 0 ? (
                <p className="text-xs text-muted-foreground">No skills available</p>
              ) : (
                availableSkills.map((skill) => (
                  <label key={skill.skillId} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="skillIds"
                      value={skill.skillId}
                      defaultChecked={node.job.skillSnapshotRefs.some(
                        ({ skillId }) => skillId === skill.skillId,
                      )}
                    />
                    <span>
                      <span className="block font-medium">{skill.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {skill.description}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
            <FieldError id={`${formId}-skillIds-error`}>{fieldErrors.skillIds}</FieldError>
          </Field>
          <Field data-invalid={fieldErrors.connectorIds !== undefined}>
            <FieldLabel id={`${formId}-connectorIds-label`}>Connector grants</FieldLabel>
            <div
              className="grid gap-2 border p-2"
              role="group"
              aria-labelledby={`${formId}-connectorIds-label`}
              aria-invalid={fieldErrors.connectorIds === undefined ? undefined : true}
            >
              {connectorConnections.length === 0 ? (
                <p className="text-xs text-muted-foreground">No connected applications</p>
              ) : (
                connectorConnections.map((connection) => (
                  <label key={connection.connectionId} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="connectorIds"
                      value={connection.connectionId}
                      defaultChecked={node.job.connectorIds.some(
                        (id) => id === connection.connectionId,
                      )}
                    />
                    {connection.label}{' '}
                    <span className="text-xs text-muted-foreground">({connection.type})</span>
                  </label>
                ))
              )}
            </div>
            <FieldError id={`${formId}-connectorIds-error`}>{fieldErrors.connectorIds}</FieldError>
          </Field>
          <details className="grid gap-3 border p-3">
            <summary className="cursor-pointer text-sm/5 font-medium">Advanced</summary>
            <div className="mt-3 grid gap-3">
              <Field data-invalid={fieldErrors.connectionId !== undefined}>
                <FieldLabel htmlFor={`${formId}-connectionId`}>Inference connection</FieldLabel>
                <NativeSelect
                  {...controlState('connectionId')}
                  id={`${formId}-connectionId`}
                  name="connectionId"
                  defaultValue={node.job.inference.connectionId}
                >
                  {!inferenceConnections.some(
                    ({ connectionId }) => connectionId === node.job.inference.connectionId,
                  ) ? (
                    <NativeSelectOption value={node.job.inference.connectionId}>
                      {node.job.inference.connectionId} (unavailable)
                    </NativeSelectOption>
                  ) : null}
                  {inferenceConnections.map((connection) => (
                    <NativeSelectOption
                      key={connection.connectionId}
                      value={connection.connectionId}
                    >
                      {connection.label} · {connection.type}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <FieldError id={`${formId}-connectionId-error`}>
                  {fieldErrors.connectionId}
                </FieldError>
              </Field>
              {input('modelId', 'Model', node.job.inference.modelId)}
              <Field data-invalid={fieldErrors.thinkingLevel !== undefined}>
                <FieldLabel htmlFor={`${formId}-thinkingLevel`}>Thinking level</FieldLabel>
                <NativeSelect
                  {...controlState('thinkingLevel')}
                  id={`${formId}-thinkingLevel`}
                  name="thinkingLevel"
                  defaultValue={node.job.inference.thinkingLevel}
                  onChange={() => clearFieldError('thinkingLevel')}
                >
                  {['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((level) => (
                    <NativeSelectOption key={level} value={level}>
                      {level}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <FieldError id={`${formId}-thinkingLevel-error`}>
                  {fieldErrors.thinkingLevel}
                </FieldError>
              </Field>
              {input('outputSchemaRef', 'Result schema', node.result.schemaRef)}
              <Field data-invalid={fieldErrors.timeoutSeconds !== undefined}>
                <FieldLabel htmlFor={`${formId}-timeoutSeconds`}>Timeout (seconds)</FieldLabel>
                <Input
                  {...controlState('timeoutSeconds')}
                  id={`${formId}-timeoutSeconds`}
                  name="timeoutSeconds"
                  type="number"
                  defaultValue={node.timeoutSeconds}
                  min={1}
                  step={1}
                  onInput={() => clearFieldError('timeoutSeconds')}
                  required
                />
                <FieldError id={`${formId}-timeoutSeconds-error`}>
                  {fieldErrors.timeoutSeconds}
                </FieldError>
              </Field>
            </div>
          </details>
        </FieldGroup>
        {formError === undefined ? null : <FieldError>{formError}</FieldError>}
        <Button type="submit" disabled={pending}>
          {pending ? 'Publishing revision' : 'Publish new revision'}
        </Button>
      </FieldSet>
    </form>
  )
}
