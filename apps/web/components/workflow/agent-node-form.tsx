'use client'

import {
  AgentNodeSchema,
  CONFIGURABLE_AGENT_NODE_FIELDS,
  type AgentNode,
  type AgentNodeConfigurationChanges,
} from '@loop/workflow-model'
import { useId, useState, type FormEvent } from 'react'

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
import { ApiClientError } from '@/lib/api-client'

type EditableAgentField = (typeof CONFIGURABLE_AGENT_NODE_FIELDS)[number]
type FieldErrors = Partial<Record<EditableAgentField, string>>

const editableFields = new Set<string>(CONFIGURABLE_AGENT_NODE_FIELDS)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const fieldFromPath = (path: unknown): EditableAgentField | undefined => {
  if (!Array.isArray(path)) return undefined
  const field = path.findLast(
    (segment): segment is string => typeof segment === 'string' && editableFields.has(segment),
  )
  return field as EditableAgentField | undefined
}

const fieldFromError = (error: ApiClientError): EditableAgentField | undefined => {
  if (!isRecord(error.details)) return undefined

  const directField = fieldFromPath(error.details.path)
  if (directField !== undefined) return directField

  if (!Array.isArray(error.details.issues)) return undefined
  for (const issue of error.details.issues) {
    if (!isRecord(issue)) continue
    const issueField = fieldFromPath(issue.path)
    if (issueField !== undefined) return issueField
  }
  return undefined
}

const messageFromError = (error: unknown) =>
  error instanceof Error ? error.message : 'The workflow revision could not be saved'

const changedConfiguration = (
  node: AgentNode,
  candidate: AgentNode,
): AgentNodeConfigurationChanges => ({
  ...(candidate.provider === node.provider ? {} : { provider: candidate.provider }),
  ...(candidate.model === node.model ? {} : { model: candidate.model }),
  ...(candidate.thinkingLevel === node.thinkingLevel
    ? {}
    : { thinkingLevel: candidate.thinkingLevel }),
  ...(candidate.promptTemplate === node.promptTemplate
    ? {}
    : { promptTemplate: candidate.promptTemplate }),
  ...(candidate.workspacePolicy === node.workspacePolicy
    ? {}
    : { workspacePolicy: candidate.workspacePolicy }),
  ...(candidate.permissionProfile === node.permissionProfile
    ? {}
    : { permissionProfile: candidate.permissionProfile }),
  ...(candidate.resourceBundleId === node.resourceBundleId
    ? {}
    : { resourceBundleId: candidate.resourceBundleId }),
  ...(candidate.outputSchemaRef === node.outputSchemaRef
    ? {}
    : { outputSchemaRef: candidate.outputSchemaRef }),
  ...(candidate.timeoutSeconds === node.timeoutSeconds
    ? {}
    : { timeoutSeconds: candidate.timeoutSeconds }),
})

export interface AgentNodeFormProps {
  readonly node: AgentNode
  readonly onSave: (changes: AgentNodeConfigurationChanges) => Promise<void>
}

export function AgentNodeForm({ node, onSave }: AgentNodeFormProps) {
  const formId = useId()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string>()
  const [pending, setPending] = useState(false)

  const controlState = (field: EditableAgentField) => ({
    'aria-describedby': fieldErrors[field] === undefined ? undefined : `${formId}-${field}-error`,
    'aria-invalid': fieldErrors[field] === undefined ? undefined : true,
  })

  const clearFieldError = (field: EditableAgentField) => {
    if (fieldErrors[field] === undefined) return
    setFieldErrors((current) => ({ ...current, [field]: undefined }))
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFieldErrors({})
    setFormError(undefined)

    const formData = new FormData(event.currentTarget)
    const parsed = AgentNodeSchema.safeParse({
      ...node,
      provider: formData.get('provider'),
      model: formData.get('model'),
      thinkingLevel: formData.get('thinkingLevel'),
      promptTemplate: formData.get('promptTemplate'),
      workspacePolicy: formData.get('workspacePolicy'),
      permissionProfile: formData.get('permissionProfile'),
      resourceBundleId: formData.get('resourceBundleId'),
      outputSchemaRef: formData.get('outputSchemaRef'),
      timeoutSeconds: Number(formData.get('timeoutSeconds')),
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

    const changes = changedConfiguration(node, parsed.data)
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

  return (
    <form aria-label="Agent configuration" onSubmit={(event) => void submit(event)}>
      <FieldSet disabled={pending}>
        <FieldLegend>Editable configuration</FieldLegend>
        <FieldGroup className="gap-3">
          <Field data-invalid={fieldErrors.provider !== undefined}>
            <FieldLabel htmlFor={`${formId}-provider`}>Provider</FieldLabel>
            <Input
              {...controlState('provider')}
              id={`${formId}-provider`}
              name="provider"
              defaultValue={node.provider}
              onInput={() => clearFieldError('provider')}
              required
            />
            <FieldError id={`${formId}-provider-error`}>{fieldErrors.provider}</FieldError>
          </Field>

          <Field data-invalid={fieldErrors.model !== undefined}>
            <FieldLabel htmlFor={`${formId}-model`}>Model</FieldLabel>
            <Input
              {...controlState('model')}
              id={`${formId}-model`}
              name="model"
              defaultValue={node.model}
              onInput={() => clearFieldError('model')}
              required
            />
            <FieldError id={`${formId}-model-error`}>{fieldErrors.model}</FieldError>
          </Field>

          <Field data-invalid={fieldErrors.thinkingLevel !== undefined}>
            <FieldLabel htmlFor={`${formId}-thinkingLevel`}>Thinking level</FieldLabel>
            <Input
              {...controlState('thinkingLevel')}
              id={`${formId}-thinkingLevel`}
              name="thinkingLevel"
              defaultValue={node.thinkingLevel}
              onInput={() => clearFieldError('thinkingLevel')}
              required
            />
            <FieldError id={`${formId}-thinkingLevel-error`}>
              {fieldErrors.thinkingLevel}
            </FieldError>
          </Field>

          <Field data-invalid={fieldErrors.promptTemplate !== undefined}>
            <FieldLabel htmlFor={`${formId}-promptTemplate`}>Prompt template</FieldLabel>
            <Textarea
              {...controlState('promptTemplate')}
              id={`${formId}-promptTemplate`}
              name="promptTemplate"
              defaultValue={node.promptTemplate}
              onInput={() => clearFieldError('promptTemplate')}
              required
            />
            <FieldError id={`${formId}-promptTemplate-error`}>
              {fieldErrors.promptTemplate}
            </FieldError>
          </Field>

          <Field data-invalid={fieldErrors.workspacePolicy !== undefined}>
            <FieldLabel htmlFor={`${formId}-workspacePolicy`}>Workspace policy</FieldLabel>
            <NativeSelect
              {...controlState('workspacePolicy')}
              className="w-full"
              id={`${formId}-workspacePolicy`}
              name="workspacePolicy"
              defaultValue={node.workspacePolicy}
              onChange={() => clearFieldError('workspacePolicy')}
            >
              <NativeSelectOption value="candidate-repositories">
                Candidate repositories
              </NativeSelectOption>
              <NativeSelectOption value="selected-worktrees">Selected worktrees</NativeSelectOption>
            </NativeSelect>
            <FieldError id={`${formId}-workspacePolicy-error`}>
              {fieldErrors.workspacePolicy}
            </FieldError>
          </Field>

          <Field data-invalid={fieldErrors.permissionProfile !== undefined}>
            <FieldLabel htmlFor={`${formId}-permissionProfile`}>Permission profile</FieldLabel>
            <NativeSelect
              {...controlState('permissionProfile')}
              className="w-full"
              id={`${formId}-permissionProfile`}
              name="permissionProfile"
              defaultValue={node.permissionProfile}
              onChange={() => clearFieldError('permissionProfile')}
            >
              <NativeSelectOption value="read-only">Read only</NativeSelectOption>
              <NativeSelectOption value="workspace-write">Workspace write</NativeSelectOption>
            </NativeSelect>
            <FieldError id={`${formId}-permissionProfile-error`}>
              {fieldErrors.permissionProfile}
            </FieldError>
          </Field>

          <Field data-invalid={fieldErrors.resourceBundleId !== undefined}>
            <FieldLabel htmlFor={`${formId}-resourceBundleId`}>Resource bundle</FieldLabel>
            <Input
              {...controlState('resourceBundleId')}
              id={`${formId}-resourceBundleId`}
              name="resourceBundleId"
              defaultValue={node.resourceBundleId}
              onInput={() => clearFieldError('resourceBundleId')}
              required
            />
            <FieldError id={`${formId}-resourceBundleId-error`}>
              {fieldErrors.resourceBundleId}
            </FieldError>
          </Field>

          <Field data-invalid={fieldErrors.outputSchemaRef !== undefined}>
            <FieldLabel htmlFor={`${formId}-outputSchemaRef`}>Output schema</FieldLabel>
            <Input
              {...controlState('outputSchemaRef')}
              id={`${formId}-outputSchemaRef`}
              name="outputSchemaRef"
              defaultValue={node.outputSchemaRef}
              onInput={() => clearFieldError('outputSchemaRef')}
              required
            />
            <FieldError id={`${formId}-outputSchemaRef-error`}>
              {fieldErrors.outputSchemaRef}
            </FieldError>
          </Field>

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
        </FieldGroup>

        {formError === undefined ? null : <FieldError>{formError}</FieldError>}
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving revision' : 'Save as new revision'}
        </Button>
      </FieldSet>
    </form>
  )
}
